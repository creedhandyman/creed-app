"use client";
import { create } from "zustand";
import { supabase, db } from "./supabase";
import { saveSnapshot, loadSnapshot, clearSnapshot } from "./offline-cache";
import { enqueueWrite, flushQueue, applyPending, pendingCount, clearQueue } from "./offline-queue";
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
  confirmState: { title: string; message: string; visible: boolean; resolve: ((v: boolean) => void) | null };
  showConfirm: (title: string, message: string) => Promise<boolean>;
  resolveConfirm: (v: boolean) => void;

  // data
  customers: Customer[];
  addresses: Address[];
  profiles: Profile[];
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
  /** Count of offline writes waiting to sync (the offline-queue). Surfaced in
   *  the banner so a tech knows their offline clock-out isn't lost. */
  pendingWrites: number;
  loadAll: () => Promise<void>;

  /** Offline-durable time-entry writes. ALL clock in/out/manual/edit/delete
   *  goes through these so a write survives no-signal (queued + replayed on
   *  reconnect) and updates the store optimistically. `mode` is "post" for a
   *  new row (caller supplies a stable id via newRowId) or "patch" to update. */
  saveTimeEntry: (rowId: string, patch: Record<string, unknown>, mode: "post" | "patch") => Promise<void>;
  dropTimeEntry: (rowId: string) => Promise<void>;

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

export const useStore = create<AppState>((set, get) => ({
  /* ── Auth ── */
  user: ld<Profile | null>("user", null),

  login: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    // Fetch profile by auth user ID
    const profiles = await db.get<Profile>("profiles", { id: data.user.id });
    const profile = profiles[0];
    if (!profile) return "Profile not found";

    set({ user: profile });
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
        // Land the confirmation link on /onboarding (which bootstraps the org +
        // profile). Without this it falls back to Supabase's Site URL and the
        // link can dead-end. The redirect host must be in Supabase's allow-list.
        emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/onboarding` : undefined,
      },
    });
    if (error) return error.message;
    if (!data.user) return "Signup failed";

    if (data.user.identities?.length === 0) return "Email already registered";

    // If email confirmation is required in Supabase, session will be null
    if (!data.session) return "CHECK_EMAIL";

    // Auto-proceed to onboarding — no invite or authorization needed
    set({ user: { id: data.user.id, email, name, role: "tech", rate: 35, start_date: new Date().toISOString().split("T")[0], emp_num: "", org_id: "" } });
    return "ONBOARD";
  },

  logout: () => {
    supabase.auth.signOut();
    set({ user: null, org: null, usingOfflineData: false, lastSyncedAt: null });
    sv("user", null);
    sv("org", null);
    // Drop the cached offline snapshot + any queued writes so the next account
    // on this device starts clean (the owner guard already refuses cross-user
    // reads; the queue is unconditionally wiped).
    void clearSnapshot();
    clearQueue();
    set({ pendingWrites: 0 });
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
        const profiles = await db.get<Profile>("profiles", { id: session.user.id });
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
    set({ toast: { message, type, visible: true } });
    // Errors get a longer window — they often carry diagnostic detail
    // (Postgres code/hint) that a 3s flash doesn't give time to read.
    const ms = type === "error" ? 8000 : 3000;
    setTimeout(() => get().hideToast(), ms);
  },
  hideToast: () => set({ toast: { ...get().toast, visible: false } }),
  confirmState: { title: "", message: "", visible: false, resolve: null },
  showConfirm: (title, message) => {
    return new Promise<boolean>((resolve) => {
      set({ confirmState: { title, message, visible: true, resolve } });
    });
  },
  resolveConfirm: (v) => {
    const { confirmState } = get();
    if (confirmState.resolve) confirmState.resolve(v);
    set({ confirmState: { title: "", message: "", visible: false, resolve: null } });
  },

  /* ── Data ── */
  customers: [],
  addresses: [],
  profiles: [],
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
  pendingWrites: pendingCount(),

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
    const settle = <T,>(p: Promise<T[]>): Promise<T[]> =>
      p.catch((err) => {
        // Should never trip — db.get catches internally — but if it
        // does, log and degrade to empty instead of crashing loadAll.
        // eslint-disable-next-line no-console
        console.error("[store] unexpected loadAll fetch rejection:", err);
        return [];
      });
    const results = await Promise.all([
      settle(db.get<Customer>("customers", orgFilter)),
      settle(db.get<Address>("addresses", orgFilter)),
      settle(db.get<Profile>("profiles", orgFilter)),
      settle(db.get<Job>("jobs", orgFilter)),
      settle(db.get<TimeEntry>("time_entries", orgFilter)),
      settle(db.get<Review>("reviews", orgFilter)),
      settle(db.get<Referral>("referrals", orgFilter)),
      settle(db.get<ScheduleEntry>("schedule", orgFilter)),
      settle(db.get<PayHistory>("pay_history", orgFilter, { limit: 500 })),
      settle(db.get<Receipt>("receipts", orgFilter)),
      settle(db.get<QuestPayout>("quest_payouts", orgFilter)),
      settle(db.get<TimeOffRequest>("time_off_requests", orgFilter)),
      settle(db.get<RecurringJob>("recurring_jobs", orgFilter)),
      settle(db.get<ReviewRequest>("review_requests", orgFilter)),
      settle(db.get<MembershipPlan>("membership_plans", orgFilter)),
      settle(db.get<CustomerMembership>("customer_memberships", orgFilter)),
      settle(db.get<Equipment>("equipment", orgFilter)),
      // Notifications are per-user, not per-org — scope to the current
      // user and cap so the feed query stays light on every 15s refresh.
      settle(userId ? db.get<AppNotification>("notifications", { user_id: userId }, { limit: 50 }) : Promise.resolve([])),
    ]);
    const [
      customers, addresses, profiles, jobs, timeEntries,
      reviews, referrals, schedule, payHistory, receipts, questPayouts, timeOffRequests, recurringJobs, reviewRequests,
      membershipPlans, customerMemberships, equipment,
      notifications,
    ] = results as [
      Customer[], Address[], Profile[], Job[], TimeEntry[],
      Review[], Referral[], ScheduleEntry[], PayHistory[], Receipt[], QuestPayout[], TimeOffRequest[], RecurringJob[], ReviewRequest[],
      MembershipPlan[], CustomerMembership[], Equipment[],
      AppNotification[],
    ];
    // Failed-batch guard: a real logged-in org ALWAYS has ≥1 profile (the user
    // themselves). An empty profiles result means the fetch failed (dropped
    // connection / server blip while navigator.onLine still read true) — don't
    // overwrite good data with a wipe; keep the snapshot up instead.
    if (profiles.length === 0 && orgId) {
      await applyOffline();
      return;
    }

    set({
      customers, addresses, profiles, jobs,
      // Materialize any not-yet-synced offline writes on top of server truth so
      // an optimistic clock-out isn't clobbered by a poll that lands before the
      // queue flushes. Once flushed, the queue is empty and this is a no-op.
      timeEntries: applyPending("time_entries", timeEntries),
      reviews, referrals, schedule, payHistory, receipts, questPayouts, timeOffRequests, recurringJobs, reviewRequests,
      membershipPlans, customerMemberships, equipment,
      notifications,
      loading: false,
      usingOfflineData: false,
      lastSyncedAt: Date.now(),
      pendingWrites: pendingCount(),
    });

    // Persist a fresh snapshot so the next offline load has real data to show.
    // Throttled (loadAll runs every 15s) to avoid churning IndexedDB.
    if (Date.now() - lastSnapshotAt > 30000) {
      lastSnapshotAt = Date.now();
      void saveSnapshot(userId, orgId, {
        customers, addresses, profiles, jobs, timeEntries,
        reviews, referrals, schedule, payHistory, receipts, questPayouts, timeOffRequests, recurringJobs, reviewRequests,
        membershipPlans, customerMemberships, equipment, notifications,
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
  saveTimeEntry: async (rowId, patch, mode) => {
    // Insert needs org_id like db.post would auto-inject (the queue's raw
    // upsert doesn't run that logic).
    const orgId = get().user?.org_id;
    const payload = mode === "post" && orgId ? { org_id: orgId, ...patch } : patch;
    enqueueWrite({ table: "time_entries", op: mode, rowId, payload });
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
      if (res.flushed > 0) await get().loadAll();
    }
  },

  dropTimeEntry: async (rowId) => {
    enqueueWrite({ table: "time_entries", op: "del", rowId });
    set({ timeEntries: get().timeEntries.filter((e) => e.id !== rowId), pendingWrites: pendingCount() });
    if (typeof navigator === "undefined" || navigator.onLine !== false) {
      const res = await flushQueue();
      set({ pendingWrites: res.remaining });
      if (res.flushed > 0) await get().loadAll();
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
    // Replay any writes queued in a previous session (e.g. clocked out offline,
    // then closed the app) before/while the first load runs.
    flushQueue().then((res) => set({ pendingWrites: res.remaining })).catch(() => {});
    get().loadAll();
    const iv = setInterval(() => get().loadAll(), 15000);
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
      await useStore.getState().loadAll();
    })();
  });
  window.addEventListener("offline", () => {
    if (useStore.getState().user) void useStore.getState().loadAll();
  });
}
