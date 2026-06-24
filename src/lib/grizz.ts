"use client";

/**
 * Grizz coaching flags — post-onboarding. Stored in localStorage (no schema
 * migration), keyed by user id so a shared device doesn't leak one person's
 * progress to another. Three things are persisted:
 *   - grizz_tips     global on/off switch for tips + the getting-started card
 *   - gs_dismissed   the dashboard getting-started card has been closed/finished
 *   - tip_<id>       a specific coachmark has been acknowledged ("Got it")
 *
 * Onboarding still runs once for new users regardless of these (it's gated by
 * the no-org check, not by tips).
 */

const key = (base: string, uid?: string | null) => `creed_${base}${uid ? "_" + uid : ""}`;

const read = (k: string): string | null => {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(k); } catch { return null; }
};
const write = (k: string, v: string) => {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(k, v); } catch { /* private mode / quota */ }
};

/** Global "Show Grizz tips" switch. Default ON (returns true when unset). */
export function tipsEnabled(uid?: string | null): boolean {
  return read(key("grizz_tips", uid)) !== "0";
}
export function setTipsEnabled(on: boolean, uid?: string | null): void {
  write(key("grizz_tips", uid), on ? "1" : "0");
}

/** Dashboard getting-started card dismissed (× tapped, or all tasks complete). */
export function gsDismissed(uid?: string | null): boolean {
  return read(key("gs_dismissed", uid)) === "1";
}
export function dismissGs(uid?: string | null): void {
  write(key("gs_dismissed", uid), "1");
}

/** A coachmark tip has been acknowledged. */
export function tipSeen(id: string, uid?: string | null): boolean {
  return read(key("tip_" + id, uid)) === "1";
}
export function markTipSeen(id: string, uid?: string | null): void {
  write(key("tip_" + id, uid), "1");
}
