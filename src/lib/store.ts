"use client";
import { create } from "zustand";
import { db } from "./supabase";
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
    const rows = await db.get<Profile>("profiles", { email, password });
    if (rows.length) {
      set({ user: rows[0] });
      sv("user", rows[0]);
      return null;
    }
    return "Invalid credentials";
  },

  signup: async (email, password, name) => {
    if (!email || !password || !name) return "Fill all fields";
    const existing = await db.get<Profile>("profiles", { email });
    if (existing.length) return "Email exists";
    const r = await db.post<Profile>("profiles", {
      email,
      password,
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
    return "Signup failed";
  },

  logout: () => {
    set({ user: null });
    sv("user", null);
    get().stopAutoRefresh();
  },

  setUser: (u) => {
    set({ user: u });
    sv("user", u);
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
