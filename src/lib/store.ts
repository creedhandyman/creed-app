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
  toggleDark: () => void;
  toggleNavSide: () => void;

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
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return error.message;
    if (!data.user) return "Signup failed";

    if (data.user.identities?.length === 0) return "Email already registered";
    if (!data.session) return "CHECK_EMAIL";

    // Profile created during onboarding (after org setup), not here
    // Store auth user id temporarily
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

  toggleDark: () => {
    const next = !get().darkMode;
    set({ darkMode: next });
    sv("dk", next);
  },

  toggleNavSide: () => {
    const next = !get().navLeft;
    set({ navLeft: next });
    sv("navl", next);
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
