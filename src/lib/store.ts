"use client";
import { create } from "zustand";
import { supabase, db } from "./supabase";
import { saveSnapshot, loadSnapshot, clearSnapshot } from "./offline-cache";
import { enqueueWrite, flushQueue, applyPending, pendingCount, clearQueue, getPending, isFlushing } from "./offline-queue";
import { needsServerCheck, serverVerdict, isLocalClockOut, isCloseWrite } from "./clock-sync";
import { t } from "./i18n";
import { flushUploads, pendingUploadCount, clearUploads } from "./offline-uploads";
import type {
  Organization,
  Profile,
  Customer,
  Address,
  Job,
  TimeEntry,
  Review,
  Referral,
  ScheduleEntry,
  PayHistory,
  Receipt,
  QuestPayout,
  TimeOffRequest,
  RecurringJob,
  MembershipPlan,
  CustomerMembership,
  Equipment,
  ReviewRequest,
  AppNotification,
} from "./types";

// Tracks the currently-running loadAll() promise so overlapping callers
// share one batch of queries instead of each spawning their own 14-table
// fetch. Module-level (not store state) so the in-flight tracking doesn't
// trigger re-renders. Cleared in the finally() after the batch resolves.
let loadAllInFlight: Promise<void> | null = null;

// Throttle offline-snapshot writes. loadAll runs every 15s; persisting the
// full data set that often is wasteful, so we write at most once per 30s.
// Starts at 0 so the first successful load always snapshots immediately.
let lastSnapshotAt = 0;

// reconcileClock bookkeeping: one check at a time; a row merely missing from
// the org list is re-asked at most once a minute.
let reconcileBusy = false;
let lastClockCheck = { id: "", at: 0 };

/** "17:12:00" / "05:12 PM" → "5:12 PM" for the clocked-out-by-the-office toast. */
function clockLabel(v?: string | null): string {
  const m = String(v || "").match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
  if (!m) return String(v || "").trim();
  let h = parseInt(m[1], 10);
  const ap = m[3]?.toUpperCase();
  if (!ap) { const pm = h >= 12; h = h % 12 || 12; return `${h}:${m[2]} ${pm ? "PM" : "AM"}`; }
  return `${h}:${m[2]} ${ap}`;
}

/** An onlyIfOpen clock write found the shift already closed elsewhere — say so
 *  (the server kept the existing times; the next load shows them). */
function noteQueueConflicts(n: number): void {
  if (n > 0) useStore.getState().showToast(t("timer.shiftAlreadyClosed"), "warning");
}

/* ── localStorage helpers ── */
function ld<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem("c_" + key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function sv(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem("c_" + key, JSON.stringify(value));
}

/* ── Toast timing (module-level so a re-render never resets them) ── */
// The ONE pending auto-hide. Cleared before every new toast so an earlier
// toast's timer can never hide a later one mid-read.
let toastTimer: ReturnType<typeof setTimeout> | null = null;
// When the last error toast went up — a success toast fired right after an
// ignored failed write must not paper over the error.
let lastErrorAt = 0;

/** Optional wording/colour for a confirm. Omitted = ConfirmModal guesses
 *  danger from the title and uses Cancel / Confirm (or the title) labels. */
export type ConfirmOpts = { confirmLabel?: string; cancelLabel?: string; danger?: boolean };

/* ── Store type ── */
interface AppState {
  // auth
  user: Profile | null;
  login: (email: string, password: string) => Promise<string | null>;
  signup: (email: string, password: string, name: string) => Promise<string | null>;
  logout: () => void;
  setUser: (u: Profile | null) => void;
  initAuth: () => Promise<void>;

  // org
  org: Organization | null;
  setOrg: (o: Organization | null) => void;

  // ui preferences
  darkMode: boolean;
  navLeft: boolean;
  navBottom: boolean;
  toggleDark: () => void;
  toggleNavSide: () => void;
  toggleNavBottom: () => void;

  // toast + confirm
  toast: { message: string; type: "success" | "error" | "info" | "warning"; visible: boolean };
  showToast: (message: string, type?: "success" | "error" | "info" | "warning") => void;
  hideToast: () => void;
  confirmState: { title: string; message: string; visible: boolean; resolve: ((v: boolean) => void) | null; opts?: ConfirmOpts };
  showConfirm: (title: string, message: string, opts?: ConfirmOpts) => Promise<boolean>;
  resolveConfirm: (v: boolean) => void;

  // data
  customers: Customer[];
  addresses: Address[];
  profiles: Profile[];
  /** Join requests (status "pending") — kept OUT of `profiles` so they never
   *  show up in payroll, scheduling, crew lists etc. until approved. Only
   *  owners/managers can see them (RLS). */
  pendingMembers: Profile[];
  jobs: Job[];
  timeEntries: TimeEntry[];
  reviews: Review[];
  referrals: Referral[];
  schedule: ScheduleEntry[];
  payHistory: PayHistory[];
  receipts: Receipt[];
  questPayouts: QuestPayout[];
  timeOffRequests: TimeOffRequest[];
  recurringJobs: RecurringJob[];
  reviewRequests: ReviewRequest[];
  membershipPlans: MembershipPlan[];
  customerMemberships: CustomerMembership[];
  equipment: Equipment[];
  notifications: AppNotification[];
  loading: boolean;
  /** True when the UI is showing the last cached snapshot because the network
   *  is unreachable (drives the offline banner). Cleared on the next
   *  successful online load. */
  usingOfflineData: boolean;
  /** Epoch ms of the last successful online load, or the snapshot's own
   *  timestamp when hydrated offline — powers the "last synced" label. */
  lastSyncedAt: number | null;
  /** Epoch ms of the last load where EVERY table fetched (or the snapshot's
   *  time offline). A partly-failed first load leaves it null — calm states
   *  ("all caught up", "everyone's paid up") wait for this, so an empty store
   *  can never read as "nothing to do". */
  fullSyncAt: number | null;
  /** Count of offline writes waiting to sync (the offline-queue). Surfaced in
   *  the banner so a tech knows their offline clock-out isn't lost. */
  pendingWrites: number;
  /** Count of offline photo/receipt uploads waiting to sync (offline-uploads,
   *  IndexedDB). Folded into the banner's "will sync" count. */
  pendingUploads: number;
  /** Bump the pending-upload counter after a screen queues an offline image
   *  (the count lives in IndexedDB; this keeps the banner instant). */
  bumpPendingUploads: () => void;
  loadAll: () => Promise<void>;

  /** Offline-durable time-entry writes. ALL clock in/out/manual/edit/delete
   *  goes through these so a write survives no-signal (queued + replayed on
   *  reconnect) and updates the store optimistically. `mode` is "post" for a
   *  new row (caller supplies a stable id via newRowId) or "patch" to update. */
  saveTimeEntry: (rowId: string, patch: Record<string, unknown>, mode: "post" | "patch", opts?: { onlyIfOpen?: boolean; earlierWins?: boolean }) => Promise<boolean>;
  dropTimeEntry: (rowId: string, opts?: { onlyIfOpen?: boolean }) => Promise<boolean>;
  /** Set when the server shows THIS phone's running shift was closed or removed
   *  elsewhere (manager force clock-out, another phone). Timer / WorkVision
   *  reset their clock when `id` is their active row. See lib/clock-sync.ts. */
  clockReset: { at: number; id: string; reason: "closed" | "deleted" } | null;
  /** Check this phone's "on the clock" state against the server (runs after
   *  each online load). Only acts on a CONFIRMED close/removal. */
  reconcileClock: () => Promise<void>;

  /** Notifications — the dashboard-bell feed. Rows are written server-side;
   *  the client only reads (in loadAll, scoped to the current user) and
   *  marks read. Both helpers patch local state in place so the badge
   *  updates without waiting for the next loadAll. */
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;

  /** Upsert helpers — write to Supabase, then patch the local state in
   *  place so the UI updates immediately without a full loadAll().
   *  Pass an `id` to update; omit it to insert. Returns the persisted
   *  row, or null on failure. */
  upsertCustomer: (
    row: Partial<Customer> & { name: string }
  ) => Promise<Customer | null>;
  deleteCustomer: (id: string) => Promise<boolean>;
  upsertAddress: (
    row: Partial<Address> & { customer_id: string }
  ) => Promise<Address | null>;
  deleteAddress: (id: string) => Promise<boolean>;
  upsertEquipment: (
    row: Partial<Equipment> & { kind: string }
  ) => Promise<Equipment | null>;
  deleteEquipment: (id: string) => Promise<boolean>;

  // auto-refresh
  _interval: ReturnType<typeof setInterval> | null;
  startAutoRefresh: () => void;
  stopAutoRefresh: () => void;
}

// Every per-account collection, emptied. Spread on logout AND login so a
// shared device never carries one user's in-memory data into the next
// account's session (the offline fast-path in loadAll serves whatever is in
// memory, so stale collections here would leak across users).
const EMPTY_COLLECTIONS = {
  fullSyncAt: null,
  customers: [], addresses: [], profiles: [], pendingMembers: [], jobs: [], timeEntries: [],
  reviews: [], referrals: [], schedule: [], payHistory: [], receipts: [],
  questPayouts: [], timeOffRequests: [], recurringJobs: [], reviewRequests: [],
  membershipPlans: [], customerMemberships: [], equipment: [], notifications: [],
};

/** Placeholder user for a signed-in account that has no profile row yet.
 *  org_id "" sends the root page to onboarding, which inserts the real row. */
function stubProfile(id: string, email: string, meta?: { name?: string } | null): Profile {
  return {
    id,
    email,
    name: (meta?.name || "").trim() || (email.split("@")[0] || "Owner"),
    role: "tech",
    rate: 35,
    start_date: new Date().toISOString().split("T")[0],
    emp_num: "",
    org_id: "",
  } as Profile;
}

export const useStore = create<AppState>((set, get) => ({
  /* ── Auth ── */
  user: ld<Profile | null>("user", null),

  login: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    // Fetch profile by auth user ID
    let profiles: Profile[];
    try {
      profiles = await db.get<Profile>("profiles", { id: data.user.id }, { strict: true });
    } catch {
      return "Couldn't reach the server — check your connection and try again.";
    }
    const profile = profiles[0];
    // Signed up but never finished setup (e.g. confirmed their email, then
    // closed the tab) → straight into onboarding (Create / Join), not an error.
    if (!profile) {
      const stub = stubProfile(data.user.id, data.user.email || email, data.user.user_metadata);
      set({ user: stub, ...EMPTY_COLLECTIONS });
      sv("user", stub);
      return null;
    }

    // Clear any prior account's in-memory data BEFORE this user's loadAll, so a
    // session switch on a shared device can't surface the previous user's rows
    // (loadAll's offline fast-path returns whatever is already in memory).
    set({ user: profile, ...EMPTY_COLLECTIONS });
    sv("user", profile);

    // Load org
    if (profile.org_id) {
      const orgs = await db.get<Organization>("organizations", { id: profile.org_id });
      if (orgs.length) { set({ org: orgs[0] }); sv("org", orgs[0]); }
    }
    return null;
  },

  signup: async (email, password, name) => {
    if (!email || !password || !name) return "Fill all fields";
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
        // Land the confirmation link on the app root: initAuth sees a session
        // with no profile and opens the ONE onboarding flow (Create a business
        // / Join a team). Without this it falls back to Supabase's Site URL
        // and the link can dead-end. The redirect host must be in Supabase's
        // allow-list.
        emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/` : undefined,
      },
    });
    if (error) return error.message;
    if (!data.user) return "Signup failed";

    if (data.user.identities?.length === 0) return "Email already registered";

    // If email confirmation is required in Supabase, session will be null
    if (!data.session) return "CHECK_EMAIL";

    // Auto-proceed to onboarding — no invite or authorization needed
    set({ user: stubProfile(data.user.id, email, { name }) });
    return "ONBOARD";
  },

  logout: () => {
    supabase.auth.signOut();
    set({ user: null, org: null, ...EMPTY_COLLECTIONS, usingOfflineData: false, lastSyncedAt: null, clockReset: null });
    sv("user", null);
    sv("org", null);
    // Drop the cached offline snapshot + any queued writes so the next account
    // on this device starts clean (the owner guard already refuses cross-user
    // reads; the queue is unconditionally wiped).
    void clearSnapshot();
    clearQueue();
    void clearUploads();
    set({ pendingWrites: 0, pendingUploads: 0 });
    get().stopAutoRefresh();
  },

  setUser: (u) => {
    set({ user: u });
    sv("user", u);
  },

  initAuth: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        let profiles: Profile[];
        try {
          profiles = await db.get<Profile>("profiles", { id: session.user.id }, { strict: true });
        } catch {
          // Transient failure (blip while onLine still read true), NOT a
          // deleted account — keep the cached user; it self-heals next init.
          return;
        }
        if (profiles.length) {
          const profile = profiles[0];
          set({ user: profile });
          sv("user", profile);
          if (profile.org_id) {
            const orgs = await db.get<Organization>("organizations", { id: profile.org_id });
            if (orgs.length) { set({ org: orgs[0] }); sv("org", orgs[0]); }
          }
          return;
        }
        // Valid session, fetch SUCCEEDED, no profile: signed up (e.g. via the
        // email-confirm link) but never created/joined a business. A stub user
        // with no org_id routes the root page into onboarding. (A cached real
        // profile wins — an empty read there is more likely a blip.)
        const cachedUser = get().user;
        // (Not for a pending join request: an empty read there means the owner
        // declined — the profile was deleted — so fall through to onboarding.)
        if (cachedUser?.id === session.user.id && cachedUser.org_id && cachedUser.status !== "pending") return;
        const stub = stubProfile(session.user.id, session.user.email || "", session.user.user_metadata);
        set({ user: stub });
        sv("user", stub);
        return;
      }
      const cached = ld<Profile | null>("user", null);
      if (cached) { set({ user: null }); sv("user", null); }
    } catch { /* keep cached state */ }
  },

  /* ── Org ── */
  org: ld<Organization | null>("org", null),

  setOrg: (o) => {
    set({ org: o });
    sv("org", o);
  },

  /* ── UI Preferences ── */
  darkMode: ld("dk", true),
  navLeft: ld("navl", false),
  navBottom: ld("navb", true),

  toggleDark: () => {
    const next = !get().darkMode;
    set({ darkMode: next });
    sv("dk", next);
  },

  toggleNavBottom: () => {
    const next = !get().navBottom;
    set({ navBottom: next, navLeft: false });
    sv("navb", next);
    if (next) sv("navl", false);
  },

  toggleNavSide: () => {
    const next = !get().navLeft;
    set({ navLeft: next });
    sv("navl", next);
  },

  /* ── Toast + Confirm ── */
  toast: { message: "", type: "info" as const, visible: false },
  showToast: (message, type = "success") => {
    const cur = get().toast;
    // Background chatter ("Syncing data…") must not bury a real problem.
    if (type === "info" && message.startsWith("Syncing") && cur.visible && (cur.type === "error" || cur.type === "warning")) return;
    // A success fired right after an ignored failed write can't hide the error.
    if (type === "success" && cur.visible && cur.type === "error" && Date.now() - lastErrorAt < 1500) return;
    if (type === "error") lastErrorAt = Date.now();
    set({ toast: { message, type, visible: true } });
    // Errors get a longer window — they often carry diagnostic detail
    // (Postgres code/hint) that a 3s flash doesn't give time to read. Long
    // messages get reading time on top (capped at 10s).
    const base = type === "error" ? 8000 : type === "warning" ? 6000 : 3000;
    const ms = Math.min(10000, Math.max(base, 1500 + message.length * 55));
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastTimer = null; get().hideToast(); }, ms);
  },
  hideToast: () => set({ toast: { ...get().toast, visible: false } }),
  confirmState: { title: "", message: "", visible: false, resolve: null },
  showConfirm: (title, message, opts) => {
    return new Promise<boolean>((resolve) => {
      set({ confirmState: { title, message, visible: true, resolve, opts } });
    });
  },
  resolveConfirm: (v) => {
    const { confirmState } = get();
    if (confirmState.resolve) confirmState.resolve(v);
    set({ confirmState: { title: "", message: "", visible: false, resolve: null, opts: undefined } });
  },

  /* ── Data ── */
  customers: [],
  addresses: [],
  profiles: [],
  pendingMembers: [],
  jobs: [],
  timeEntries: [],
  reviews: [],
  referrals: [],
  schedule: [],
  payHistory: [],
  receipts: [],
  questPayouts: [],
  timeOffRequests: [],
  recurringJobs: [],
  reviewRequests: [],
  membershipPlans: [],
  customerMemberships: [],
  equipment: [],
  notifications: [],
  loading: true,
  usingOfflineData: false,
  lastSyncedAt: null,
  fullSyncAt: null,
  pendingWrites: pendingCount(),
  pendingUploads: 0, // hydrated from IndexedDB in startAutoRefresh
  clockReset: null,
  bumpPendingUploads: () => set({ pendingUploads: get().pendingUploads + 1 }),

  loadAll: async () => {
    // Concurrency guard. Many event handlers (Jobs, Quests, Branding,
    // HR, Stripe redirect, the 15s auto-refresh interval, the
    // startAutoRefresh trigger in page.tsx) all call loadAll and can
    // overlap — e.g. user lands on a page that just toggled a job
    // status milliseconds before the auto-refresh interval fires.
    // Without this guard each caller spawns its own batch of 14
    // queries. With it, overlapping callers share the in-flight
    // promise and we run the batch exactly once. Module-level (vs
    // store state) so the guard doesn't trigger re-renders.
    if (loadAllInFlight) return loadAllInFlight;
    loadAllInFlight = (async () => {
    const orgId = get().user?.org_id;
    const userId = get().user?.id;

    // Show the last cached snapshot instead of wiping the store to empty.
    // Used by the offline fast-path below AND the failed-batch guard further
    // down. db.get swallows network errors and resolves to [], so without this
    // a single offline loadAll would set every collection to [] — that was the
    // "all my data disappeared in airplane mode" bug.
    const applyOffline = async () => {
      // Already have data in memory → just raise the banner; don't re-read IDB
      // on every 15s poll while the network stays down. (In-memory timeEntries
      // already reflect optimistic offline writes.)
      if (get().profiles.length > 0 || get().jobs.length > 0) {
        set({ loading: false, usingOfflineData: true, pendingWrites: pendingCount() });
        return;
      }
      const snap = await loadSnapshot(userId, orgId);
      if (snap) {
        const data = snap.data as unknown as Partial<AppState>;
        set({
          ...data,
          // Materialize queued offline writes on top of the snapshot so a
          // reload mid-airplane-mode still shows the clock-out that hasn't
          // synced yet.
          timeEntries: applyPending("time_entries", (data.timeEntries as TimeEntry[]) || []),
          loading: false,
          usingOfflineData: true,
          lastSyncedAt: snap.at,
          fullSyncAt: snap.at,
          pendingWrites: pendingCount(),
        });
      } else {
        set({ loading: false }); // nothing cached — stop the spinner, leave as-is
      }
    };

    // Fast offline path: skip the 18 doomed fetches (each would resolve to []
    // and wipe the store) and show the snapshot instead.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      await applyOffline();
      return;
    }

    const orgFilter = orgId ? { org_id: orgId } : undefined;
    // db.get already catches and resolves to [] on per-table failures,
    // but use allSettled as a belt-and-suspenders so a thrown exception
    // anywhere in the batch can never take out the rest of the load.
    // If a table is missing (e.g. time_off_requests before the migration
    // runs), the per-fetch toast fires inside db.get and this settles to
    // []. The downstream selectors all default-to-empty.
    // A strict db.get failure (dropped connection / server blip) surfaces here
    // as null — so a single table's blip KEEPS its prior value instead of
    // blanking that collection. A genuinely empty table still resolves to [].
    const settle = <T,>(p: Promise<T[]>): Promise<T[] | null> =>
      p.catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[store] loadAll fetch failed for a table:", err);
        return null;
      });
    const results = await Promise.all([
      settle(db.get<Customer>("customers", orgFilter, { strict: true })),
      settle(db.get<Address>("addresses", orgFilter, { strict: true })),
      settle(db.get<Profile>("profiles", orgFilter, { strict: true })),
      settle(db.get<Job>("jobs", orgFilter, { strict: true })),
      settle(db.get<TimeEntry>("time_entries", orgFilter, { strict: true })),
      settle(db.get<Review>("reviews", orgFilter, { strict: true })),
      settle(db.get<Referral>("referrals", orgFilter, { strict: true })),
      settle(db.get<ScheduleEntry>("schedule", orgFilter, { strict: true })),
      settle(db.get<PayHistory>("pay_history", orgFilter, { limit: 500, strict: true })),
      settle(db.get<Receipt>("receipts", orgFilter, { strict: true })),
      settle(db.get<QuestPayout>("quest_payouts", orgFilter, { strict: true })),
      settle(db.get<TimeOffRequest>("time_off_requests", orgFilter, { strict: true })),
      settle(db.get<RecurringJob>("recurring_jobs", orgFilter, { strict: true })),
      settle(db.get<ReviewRequest>("review_requests", orgFilter, { strict: true })),
      settle(db.get<MembershipPlan>("membership_plans", orgFilter, { strict: true })),
      settle(db.get<CustomerMembership>("customer_memberships", orgFilter, { strict: true })),
      settle(db.get<Equipment>("equipment", orgFilter, { strict: true })),
      // Notifications are per-user, not per-org — scope to the current
      // user and cap so the feed query stays light on every 15s refresh.
      settle(userId ? db.get<AppNotification>("notifications", { user_id: userId }, { limit: 50, strict: true }) : Promise.resolve([])),
    ]);
    const [
      customers, addresses, profiles, jobs, timeEntries,
      reviews, referrals, schedule, payHistory, receipts, questPayouts, timeOffRequests, recurringJobs, reviewRequests,
      membershipPlans, customerMemberships, equipment,
      notifications,
    ] = results as [
      Customer[] | null, Address[] | null, Profile[] | null, Job[] | null, TimeEntry[] | null,
      Review[] | null, Referral[] | null, ScheduleEntry[] | null, PayHistory[] | null, Receipt[] | null, QuestPayout[] | null, TimeOffRequest[] | null, RecurringJob[] | null, ReviewRequest[] | null,
      MembershipPlan[] | null, CustomerMembership[] | null, Equipment[] | null,
      AppNotification[] | null,
    ];
    // Failed-batch guard: a real logged-in org ALWAYS has ≥1 profile (the user
    // themselves). A null (fetch failed) or empty profiles means the load
    // failed — don't wipe good data; keep the snapshot up instead.
    if ((profiles === null || profiles.length === 0) && orgId) {
      await applyOffline();
      return;
    }

    // Keep the prior in-memory value for any collection whose fetch FAILED
    // (null), so one table's blip can't blank it; a genuine empty ([]) updates.
    const cur = get();
    const customersF = customers ?? cur.customers;
    const addressesF = addresses ?? cur.addresses;
    const allProfilesF = profiles ?? [...cur.profiles, ...cur.pendingMembers];
    const profilesF = allProfilesF.filter((p) => p.status !== "pending");
    const pendingMembersF = allProfilesF.filter((p) => p.status === "pending");
    const jobsF = jobs ?? cur.jobs;
    const timeEntriesF = timeEntries ?? cur.timeEntries;
    const reviewsF = reviews ?? cur.reviews;
    const referralsF = referrals ?? cur.referrals;
    const scheduleF = schedule ?? cur.schedule;
    const payHistoryF = payHistory ?? cur.payHistory;
    const receiptsF = receipts ?? cur.receipts;
    const questPayoutsF = questPayouts ?? cur.questPayouts;
    const timeOffRequestsF = timeOffRequests ?? cur.timeOffRequests;
    const recurringJobsF = recurringJobs ?? cur.recurringJobs;
    const reviewRequestsF = reviewRequests ?? cur.reviewRequests;
    const membershipPlansF = membershipPlans ?? cur.membershipPlans;
    const customerMembershipsF = customerMemberships ?? cur.customerMemberships;
    const equipmentF = equipment ?? cur.equipment;
    const notificationsF = notifications ?? cur.notifications;

    set({
      customers: customersF, addresses: addressesF, profiles: profilesF, pendingMembers: pendingMembersF, jobs: jobsF,
      // Materialize any not-yet-synced offline writes on top of server truth so
      // an optimistic clock-out isn't clobbered by a poll that lands before the
      // queue flushes. Once flushed, the queue is empty and this is a no-op.
      timeEntries: applyPending("time_entries", timeEntriesF),
      reviews: reviewsF, referrals: referralsF, schedule: scheduleF, payHistory: payHistoryF, receipts: receiptsF, questPayouts: questPayoutsF, timeOffRequests: timeOffRequestsF, recurringJobs: recurringJobsF, reviewRequests: reviewRequestsF,
      membershipPlans: membershipPlansF, customerMemberships: customerMembershipsF, equipment: equipmentF,
      notifications: notificationsF,
      loading: false,
      usingOfflineData: false,
      lastSyncedAt: Date.now(),
      // A table that failed kept its prior value — only a complete load counts.
      fullSyncAt: results.some((r) => r === null) ? cur.fullSyncAt : Date.now(),
      pendingWrites: pendingCount(),
    });

    // Is this phone still really on the clock? (A manager's force clock-out
    // or another phone may have closed the shift.) Only after a load whose
    // time entries actually came from the server.
    if (timeEntries !== null) void get().reconcileClock();

    // Persist a fresh snapshot so the next offline load has real data to show.
    // Throttled (loadAll runs every 15s) to avoid churning IndexedDB. Only a
    // COMPLETE load is snapshotted — the offline path trusts the snapshot as a
    // full sync (fullSyncAt), so a partial one would read as "nothing to do".
    if (!results.some((r) => r === null) && Date.now() - lastSnapshotAt > 30000) {
      lastSnapshotAt = Date.now();
      void saveSnapshot(userId, orgId, {
        customers: customersF, addresses: addressesF, profiles: profilesF, jobs: jobsF, timeEntries: timeEntriesF,
        reviews: reviewsF, referrals: referralsF, schedule: scheduleF, payHistory: payHistoryF, receipts: receiptsF, questPayouts: questPayoutsF, timeOffRequests: timeOffRequestsF, recurringJobs: recurringJobsF, reviewRequests: reviewRequestsF,
        membershipPlans: membershipPlansF, customerMemberships: customerMembershipsF, equipment: equipmentF, notifications: notificationsF,
      });
    }
    // Also refresh org data (picks up Stripe changes, site updates, etc.).
    // Query by the user's org_id (authoritative) — querying by the currently
    // cached org.id meant that if the cached org was null/stale, the refetch
    // silently returned nothing and the UI never updated after Stripe connect.
    if (orgId) {
      const orgs = await db.get<Organization>("organizations", { id: orgId });
      if (orgs.length) { set({ org: orgs[0] }); sv("org", orgs[0]); }
    }
    })().finally(() => { loadAllInFlight = null; });
    return loadAllInFlight;
  },

  /* ── Offline-durable time-entry writes ───────────────────────────
     Route every clock in/out/manual/edit through these so a write
     survives no-signal: enqueue → optimistic store update → (if
     online) flush + reconcile. Offline, the queue persists in
     localStorage and replays on the next reconnect. */
  saveTimeEntry: async (rowId, patch, mode, opts) => {
    // Insert needs org_id like db.post would auto-inject (the queue's raw
    // upsert doesn't run that logic).
    const orgId = get().user?.org_id;
    const payload = mode === "post" && orgId ? { org_id: orgId, ...patch } : patch;
    enqueueWrite({
      table: "time_entries", op: mode, rowId, payload,
      onlyIfOpen: mode === "patch" && !!opts?.onlyIfOpen,
      earlierWins: mode === "patch" && !!opts?.onlyIfOpen && !!opts?.earlierWins,
    });
    // Optimistic local update so Crew Activity / My Log reflect it immediately.
    // Use `payload` (not `patch`) so the in-store row matches what gets
    // persisted — e.g. the injected org_id on an insert.
    const cur = get().timeEntries;
    const idx = cur.findIndex((e) => e.id === rowId);
    const next = idx >= 0
      ? cur.map((e) => (e.id === rowId ? ({ ...e, ...payload, id: rowId } as unknown as TimeEntry) : e))
      : [({ id: rowId, ...payload } as unknown as TimeEntry), ...cur];
    set({ timeEntries: next, pendingWrites: pendingCount() });
    // Try to sync now when online, then reconcile against server truth.
    if (typeof navigator === "undefined" || navigator.onLine !== false) {
      const res = await flushQueue();
      set({ pendingWrites: res.remaining });
      noteQueueConflicts(res.conflictRows.length);
      if (res.flushed > 0) await get().loadAll();
      // false = THIS close found the shift already closed elsewhere.
      return !res.conflictRows.includes(rowId);
    }
    return true; // queued offline — replays later
  },

  dropTimeEntry: async (rowId, opts) => {
    enqueueWrite({ table: "time_entries", op: "del", rowId, onlyIfOpen: !!opts?.onlyIfOpen });
    set({ timeEntries: get().timeEntries.filter((e) => e.id !== rowId), pendingWrites: pendingCount() });
    if (typeof navigator === "undefined" || navigator.onLine !== false) {
      const res = await flushQueue();
      set({ pendingWrites: res.remaining });
      noteQueueConflicts(res.conflictRows.length);
      if (res.flushed > 0) await get().loadAll();
      // false = THIS close found the shift already closed elsewhere.
      return !res.conflictRows.includes(rowId);
    }
    return true; // queued offline — replays later
  },

  reconcileClock: async () => {
    if (reconcileBusy) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (get().usingOfflineData) return; // a snapshot can't confirm anything
    const local = { on: ld<boolean>("t_on", false) === true, activeId: ld<string | null>("t_active_id", null), st: ld<number | null>("t_st", null) };
    const id = local.activeId;
    if (!local.on || !id || isLocalClockOut(id)) return;
    // Only an unsynced open/close/remove of the row holds the check off — a
    // stuck GPS stamp must not keep a force-closed shift running all day.
    const pendingIds = getPending("time_entries").filter(isCloseWrite).map((w) => w.rowId);
    const storeRow = get().timeEntries.find((e) => e.id === id);
    if (!needsServerCheck(local, pendingIds, storeRow, Date.now())) return;
    // A row merely missing from the org list re-asks at most once a minute.
    if (!storeRow && lastClockCheck.id === id && Date.now() - lastClockCheck.at < 60000) return;
    reconcileBusy = true;
    lastClockCheck = { id, at: Date.now() };
    try {
      // With no session supabase-js falls back to the anon key and RLS returns
      // [] — that would read as "deleted". Only trust a signed-in read.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
      } catch { return; }
      // Confirm by id — act only on a successful read, never on a guess.
      let rows: TimeEntry[];
      try { rows = await db.get<TimeEntry>("time_entries", { id }, { strict: true }); }
      catch { return; }
      const verdict = serverVerdict(rows);
      if (verdict === "keep") return;
      // The user may have clocked out, or queued a write, while we were reading.
      if (ld<boolean>("t_on", false) !== true || ld<string | null>("t_active_id", null) !== id) return;
      if (isLocalClockOut(id) || getPending("time_entries").some((w) => w.rowId === id && isCloseWrite(w))) return;
      sv("t_on", false);
      sv("t_st", null);
      sv("t_sj", "");
      sv("t_active_id", null);
      sv("t_active_job_id", null);
      set({ clockReset: { at: Date.now(), id, reason: verdict } });
      get().showToast(
        verdict === "closed"
          ? t("timer.closedByOffice").replace("{time}", clockLabel(rows[0]?.end_time))
          : t("timer.removedByOffice"),
        "warning",
      );
    } finally {
      reconcileBusy = false;
    }
  },

  /* ── Customer + Address helpers ──────────────────────────────────
     Upsert / delete keep local state in sync without a full loadAll
     so detail screens can edit-and-see-results without a round-trip.
     db.post/patch/del already toast errors via the __dbToast hook. */
  upsertCustomer: async (row) => {
    const isUpdate = !!row.id;
    if (isUpdate) {
      const updates = { ...row, updated_at: new Date().toISOString() };
      delete (updates as { id?: string }).id;
      await db.patch("customers", row.id!, updates);
      const updated = { ...get().customers.find((c) => c.id === row.id), ...updates, id: row.id! } as Customer;
      set({ customers: get().customers.map((c) => (c.id === row.id ? updated : c)) });
      return updated;
    }
    // Pass org_id explicitly as belt-and-suspenders alongside db.post's
    // auto-inject — guards against the rare case where localStorage is
    // out of sync with the in-memory user (e.g. mid-onboarding).
    const orgId = get().user?.org_id;
    const payload = { ...row, ...(orgId ? { org_id: orgId } : {}) };
    const inserted = await db.post<Customer>("customers", payload as Record<string, unknown>);
    if (inserted === null) return null; // db.post already toasted the real error
    if (inserted.length > 0) {
      const created = inserted[0];
      set({ customers: [created, ...get().customers] });
      return created;
    }
    // Insert succeeded but the trailing .select() returned no rows (likely
    // an RLS policy gap on the anon role). Refresh so the UI catches up.
    await get().loadAll();
    if (orgId && row.name) {
      const found = get().customers
        .filter((c) => c.org_id === orgId && c.name === row.name)
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
      if (found) return found;
    }
    return null;
  },

  deleteCustomer: async (id) => {
    await db.del("customers", id);
    set({
      customers: get().customers.filter((c) => c.id !== id),
      // Address rows cascade-delete in Postgres; mirror that locally.
      addresses: get().addresses.filter((a) => a.customer_id !== id),
    });
    return true;
  },

  upsertAddress: async (row) => {
    const isUpdate = !!row.id;
    if (isUpdate) {
      const updates = { ...row, updated_at: new Date().toISOString() };
      delete (updates as { id?: string }).id;
      await db.patch("addresses", row.id!, updates);
      const updated = { ...get().addresses.find((a) => a.id === row.id), ...updates, id: row.id! } as Address;
      set({ addresses: get().addresses.map((a) => (a.id === row.id ? updated : a)) });
      return updated;
    }
    const orgId = get().user?.org_id;
    const payload = { ...row, ...(orgId ? { org_id: orgId } : {}) };
    const inserted = await db.post<Address>("addresses", payload as Record<string, unknown>);
    if (inserted === null) return null;
    if (inserted.length > 0) {
      const created = inserted[0];
      set({ addresses: [created, ...get().addresses] });
      return created;
    }
    // Same RLS-empty-select fallback as upsertCustomer.
    await get().loadAll();
    if (orgId && row.customer_id) {
      const found = get().addresses
        .filter((a) => a.org_id === orgId && a.customer_id === row.customer_id && (row.street ? a.street === row.street : true))
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
      if (found) return found;
    }
    return null;
  },

  deleteAddress: async (id) => {
    await db.del("addresses", id);
    set({ addresses: get().addresses.filter((a) => a.id !== id) });
    return true;
  },

  upsertEquipment: async (row) => {
    const isUpdate = !!row.id;
    if (isUpdate) {
      const updates = { ...row };
      delete (updates as { id?: string }).id;
      await db.patch("equipment", row.id!, updates);
      const updated = { ...get().equipment.find((e) => e.id === row.id), ...updates, id: row.id! } as Equipment;
      set({ equipment: get().equipment.map((e) => (e.id === row.id ? updated : e)) });
      return updated;
    }
    const orgId = get().user?.org_id;
    const payload = { ...row, ...(orgId ? { org_id: orgId } : {}) };
    const inserted = await db.post<Equipment>("equipment", payload as Record<string, unknown>);
    if (inserted === null) return null;
    if (inserted.length > 0) {
      const created = inserted[0];
      set({ equipment: [created, ...get().equipment] });
      return created;
    }
    await get().loadAll();
    return null;
  },

  deleteEquipment: async (id) => {
    await db.del("equipment", id);
    set({ equipment: get().equipment.filter((e) => e.id !== id) });
    return true;
  },

  /* ── Notifications ── */
  markNotificationRead: async (id) => {
    const now = new Date().toISOString();
    // Optimistic local update so the badge drops immediately.
    set({ notifications: get().notifications.map((n) => (n.id === id ? { ...n, read_at: now } : n)) });
    await db.patch("notifications", id, { read_at: now });
  },

  markAllNotificationsRead: async () => {
    const userId = get().user?.id;
    if (!userId) return;
    const now = new Date().toISOString();
    set({ notifications: get().notifications.map((n) => (n.read_at ? n : { ...n, read_at: now })) });
    // Bulk update in one round-trip rather than N patches.
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", userId)
      .is("read_at", null);
    if (error) {
      // eslint-disable-next-line no-console
      console.error("[store] markAllNotificationsRead failed:", error.message);
    }
  },

  /* ── Auto-refresh ── */
  _interval: null,

  startAutoRefresh: () => {
    get().stopAutoRefresh();
    // Replay any writes/uploads queued in a previous session (e.g. clocked out
    // or snapped a photo offline, then closed the app) before/while the first
    // load runs. Also hydrate the pending-upload count from IndexedDB.
    flushQueue().then((res) => { set({ pendingWrites: res.remaining }); noteQueueConflicts(res.conflictRows.length); }).catch(() => {});
    flushUploads().then((res) => set({ pendingUploads: res.remaining })).catch(() => {});
    pendingUploadCount().then((n) => set({ pendingUploads: n })).catch(() => {});
    get().loadAll();
    // Each poll also retries queued writes: iOS often reports "online" in a
    // dead zone (no 'online' event ever fires), so a stuck clock-out would
    // otherwise wait for the next clock action or app restart — long enough
    // for a manager to force-close the shift in the meantime.
    const iv = setInterval(() => {
      // Not while a flush is already running — the poll would just queue up
      // behind it (and starve its own data refresh in a hanging dead zone).
      if (pendingCount() > 0 && !isFlushing() && (typeof navigator === "undefined" || navigator.onLine !== false)) {
        flushQueue()
          .then((res) => { set({ pendingWrites: res.remaining }); noteQueueConflicts(res.conflictRows.length); })
          .catch(() => {})
          .finally(() => { void get().loadAll(); });
      } else {
        void get().loadAll();
      }
    }, 15000);
    set({ _interval: iv });
  },

  stopAutoRefresh: () => {
    const iv = get()._interval;
    if (iv) clearInterval(iv);
    set({ _interval: null });
  },
}));

// Auth state listener — handles sign-out and token refresh
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      useStore.getState().setUser(null);
    }
  });

  // Let supabase.ts surface DB errors via our toast system. Type widened
  // from "error" only so transient-network failures can surface as a
  // quiet "Syncing data…" info toast instead of a wall of red noise.
  (window as unknown as { __dbToast?: (m: string, t: "error" | "info" | "warning" | "success") => void }).__dbToast =
    (msg: string, type) => useStore.getState().showToast(msg, type);

  // React to connectivity changes immediately instead of waiting up to 15s
  // for the next poll: "online" flushes queued offline writes (clock-outs
  // etc.) THEN refetches live data (clears the offline banner); "offline"
  // short-circuits loadAll to the snapshot (raises it). Guarded on a
  // logged-in user so we don't spin on the marketing page.
  window.addEventListener("online", () => {
    if (!useStore.getState().user) return;
    void (async () => {
      const res = await flushQueue();
      useStore.setState({ pendingWrites: res.remaining });
      noteQueueConflicts(res.conflictRows.length);
      // Then replay queued image uploads (rows first so a receipt's row exists
      // before anything references it), and refresh live data.
      const up = await flushUploads();
      useStore.setState({ pendingUploads: up.remaining });
      await useStore.getState().loadAll();
    })();
  });
  window.addEventListener("offline", () => {
    if (useStore.getState().user) void useStore.getState().loadAll();
  });
}
