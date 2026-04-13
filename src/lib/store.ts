"use client";
import { create } from "zustand";
import { supabase, db } from "./supabase";
import type {
  Organization,
  Profile,
  Client,
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
  clients: Client[];
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
    setTimeout(() => get().hideToast(), 3000);
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
  clients: [],
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
    const [clients, profiles, jobs, timeEntries, reviews, referrals, schedule, payHistory, receipts, questPayouts] =
      await Promise.all([
        db.get<Client>("clients", orgFilter),
        db.get<Profile>("profiles", orgFilter),
        db.get<Job>("jobs", orgFilter),
        db.get<TimeEntry>("time_entries", orgFilter),
        db.get<Review>("reviews", orgFilter),
        db.get<Referral>("referrals", orgFilter),
        db.get<ScheduleEntry>("schedule", orgFilter),
        db.get<PayHistory>("pay_history", orgFilter),
        db.get<Receipt>("receipts", orgFilter),
        db.get<QuestPayout>("quest_payouts", orgFilter),
      ]);
    set({ clients, profiles, jobs, timeEntries, reviews, referrals, schedule, payHistory, receipts, questPayouts, loading: false });
    // Also refresh org data (picks up Stripe changes, site updates, etc.)
    if (orgId) {
      const orgs = await db.get<Organization>("organizations", { id: get().org?.id });
      if (orgs.length) { set({ org: orgs[0] }); sv("org", orgs[0]); }
    }
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
}
