"use client";
import { create } from "zustand";
import { supabase, db } from "./supabase";
import type {
  Profile,
  Job,
  TimeEntry,
  Review,
  Referral,
  ScheduleEntry,
  PayHistory,
  Receipt,
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

  // dark mode
  darkMode: boolean;
  toggleDark: () => void;

  // data
  profiles: Profile[];
  jobs: Job[];
  timeEntries: TimeEntry[];
  reviews: Review[];
  referrals: Referral[];
  schedule: ScheduleEntry[];
  payHistory: PayHistory[];
  receipts: Receipt[];
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
    if (profiles.length) {
      set({ user: profiles[0] });
      sv("user", profiles[0]);
      return null;
    }
    // Fallback: match by email
    const byEmail = await db.get<Profile>("profiles", { email });
    if (byEmail.length) {
      set({ user: byEmail[0] });
      sv("user", byEmail[0]);
      return null;
    }
    return "Profile not found";
  },

  signup: async (email, password, name) => {
    if (!email || !password || !name) return "Fill all fields";
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return error.message;
    if (!data.user) return "Signup failed";

    // Check if email confirmation is required
    if (data.user.identities?.length === 0) {
      return "Email already registered";
    }
    if (!data.session) {
      return "CHECK_EMAIL";
    }

    // Create profile row linked to auth user
    const r = await db.post<Profile>("profiles", {
      id: data.user.id,
      email,
      name,
      role: "tech",
      rate: 35,
      start_date: new Date().toISOString().split("T")[0],
      emp_num: String(Math.floor(Math.random() * 900) + 100),
    });
    if (r?.length) {
      set({ user: r[0] });
      sv("user", r[0]);
      return null;
    }
    return "Profile creation failed";
  },

  logout: () => {
    supabase.auth.signOut();
    set({ user: null });
    sv("user", null);
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
          set({ user: profiles[0] });
          sv("user", profiles[0]);
          return;
        }
      }
      // No valid session — clear stale cached user
      const cached = ld<Profile | null>("user", null);
      if (cached) {
        set({ user: null });
        sv("user", null);
      }
    } catch {
      // Auth check failed, keep cached state
    }
  },

  /* ── Dark mode ── */
  darkMode: ld("dk", true),

  toggleDark: () => {
    const next = !get().darkMode;
    set({ darkMode: next });
    sv("dk", next);
  },

  /* ── Data ── */
  profiles: [],
  jobs: [],
  timeEntries: [],
  reviews: [],
  referrals: [],
  schedule: [],
  payHistory: [],
  receipts: [],
  loading: true,

  loadAll: async () => {
    const [profiles, jobs, timeEntries, reviews, referrals, schedule, payHistory, receipts] =
      await Promise.all([
        db.get<Profile>("profiles"),
        db.get<Job>("jobs"),
        db.get<TimeEntry>("time_entries"),
        db.get<Review>("reviews"),
        db.get<Referral>("referrals"),
        db.get<ScheduleEntry>("schedule"),
        db.get<PayHistory>("pay_history"),
        db.get<Receipt>("receipts"),
      ]);
    set({ profiles, jobs, timeEntries, reviews, referrals, schedule, payHistory, receipts, loading: false });
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
