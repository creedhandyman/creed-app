"use client";
import { useEffect } from "react";
import { create } from "zustand";
import { apiFetch } from "./api";

/**
 * Client side of the Texts screen: the unread count on the More tab / side
 * menu / More hub tile, polled from /api/sms/threads?count=1 while the app is
 * open and visible (every 60s, plus whenever the app comes back to the
 * front). The Texts screen refreshes it right after it marks texts read.
 */
interface TextsState {
  unread: number;
  setUnread: (n: number) => void;
}

export const useTextsStore = create<TextsState>((set) => ({
  unread: 0,
  setUnread: (n) => set({ unread: Math.max(0, n | 0) }),
}));

export async function refreshTextsUnread(): Promise<void> {
  try {
    const r = await apiFetch("/api/sms/threads?count=1");
    if (!r.ok) return;
    const j = (await r.json()) as { unread?: number };
    useTextsStore.getState().setUnread(Number(j.unread) || 0);
  } catch {
    /* offline: keep the last count */
  }
}

const POLL_MS = 60_000;

/** Keep the unread count fresh while `enabled` (texting on for the business). */
export function useTextsUnreadPoll(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      useTextsStore.getState().setUnread(0);
      return;
    }
    const tick = () => {
      if (document.visibilityState === "visible") refreshTextsUnread();
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled]);
}

/** "3:05 PM" today, "Nov 9, 3:05 PM" another day. */
export function fmtWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}
