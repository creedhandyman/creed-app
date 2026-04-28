"use client";
import { create } from "zustand";
import { supabase, db } from "./supabase";
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
} from "./types";

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
  loading: boolean;
  loadAll: () => Promise<void>;

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
      options: { data: { name } },
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
    set({ user: null, org: null });
    sv("user", null);
    sv("org", null);
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
  darkMode: ld("dk", false),
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
  loading: true,

  loadAll: async () => {
    const orgId = get().user?.org_id;
    const orgFilter = orgId ? { org_id: orgId } : undefined;
    const [
      customers, addresses, profiles, jobs, timeEntries,
      reviews, referrals, schedule, payHistory, receipts, questPayouts,
    ] = await Promise.all([
      db.get<Customer>("customers", orgFilter),
      db.get<Address>("addresses", orgFilter),
      db.get<Profile>("profiles", orgFilter),
      db.get<Job>("jobs", orgFilter),
      db.get<TimeEntry>("time_entries", orgFilter),
      db.get<Review>("reviews", orgFilter),
      db.get<Referral>("referrals", orgFilter),
      db.get<ScheduleEntry>("schedule", orgFilter),
      db.get<PayHistory>("pay_history", orgFilter, { limit: 500 }),
      db.get<Receipt>("receipts", orgFilter),
      db.get<QuestPayout>("quest_payouts", orgFilter),
    ]);
    set({
      customers, addresses, profiles, jobs, timeEntries,
      reviews, referrals, schedule, payHistory, receipts, questPayouts,
      loading: false,
    });
    // Also refresh org data (picks up Stripe changes, site updates, etc.).
    // Query by the user's org_id (authoritative) — querying by the currently
    // cached org.id meant that if the cached org was null/stale, the refetch
    // silently returned nothing and the UI never updated after Stripe connect.
    if (orgId) {
      const orgs = await db.get<Organization>("organizations", { id: orgId });
      if (orgs.length) { set({ org: orgs[0] }); sv("org", orgs[0]); }
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

  /* ── Auto-refresh ── */
  _interval: null,

  startAutoRefresh: () => {
    get().stopAutoRefresh();
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

  // Let supabase.ts surface DB errors via our toast system
  (window as unknown as { __dbToast?: (m: string, t: "error") => void }).__dbToast =
    (msg: string, type: "error") => useStore.getState().showToast(msg, type);
}
