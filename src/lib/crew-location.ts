/**
 * Live crew locations — the rules, kept PURE (no Supabase, React or GPS) so
 * they're unit-tested in src/__tests__/crew-location.test.ts.
 *
 *  - heartbeatDue / usableFix: when the foreground heartbeat (lib/crew-heartbeat)
 *    takes a fix and which fixes it sends.
 *  - liveFixFor: whether a tech's `crew_locations` row is newer than their last
 *    clock-in/out GPS stamp today — used by Dispatch's "Crew right now"
 *    (dispatch-week crewNow), Crew Map and the Jobs closest-tech hint.
 *
 * Privacy rules live in the heartbeat + RLS: only while clocked in, only while
 * the app is on screen, never in the background.
 */
import type { CrewLocation } from "./types";
import { localYmd } from "./day-plan";
import { clockMinutes } from "./mileage-days";

/** A fix every ~4 minutes while on the clock with the app open. */
export const HEARTBEAT_MS = 4 * 60_000;
/** Coming back to the app takes a fix unless the last one is this fresh. */
export const RETURN_GAP_MS = 60_000;
/** Fixes worse than this are noise for "where is the crew". */
export const MAX_FIX_ACC_M = 100;
/** How often the heartbeat checks the clock (no GPS unless a fix is due). */
export const CHECK_MS = 30_000;
/** A missing crew_locations table (migration not run) is re-checked this often. */
export const TABLE_RETRY_MS = 60 * 60_000;
/** A live fix older than this reads "location from 2:14 PM", not "live". */
export const LIVE_FRESH_MIN = 15;

export function heartbeatDue(s: {
  clockedIn: boolean;
  visible: boolean;
  now: number;
  /** Last heartbeat attempt this session (0 = none yet). */
  lastAt: number;
  /** When the shift started — the clock-in took its own GPS stamp. */
  clockInAt?: number | null;
  /** "return" = the app just came back on screen (or opened). */
  trigger: "tick" | "return";
}): boolean {
  if (!s.clockedIn || !s.visible) return false;
  const clockIn = s.clockInAt != null && s.clockInAt <= s.now ? s.clockInAt : 0;
  const since = s.now - Math.max(s.lastAt || 0, clockIn);
  return since >= (s.trigger === "return" ? RETURN_GAP_MS : HEARTBEAT_MS);
}

export function usableFix<T extends { lat: number; lng: number; accuracy: number }>(fix: T | null | undefined): fix is T {
  return !!fix
    && Number.isFinite(fix.lat) && Number.isFinite(fix.lng) && Math.abs(fix.lat) <= 90 && Math.abs(fix.lng) <= 180
    && Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= MAX_FIX_ACC_M;
}

/** The table (or a column) isn't there yet — the migration hasn't run. */
export function isMissingTableError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code && ["42P01", "PGRST205", "42703", "PGRST204"].includes(err.code)) return true;
  return /does not exist|schema cache/i.test(err.message || "");
}

/** Epoch ms of a "8:05 AM" clock stamp on `day`'s local date (null = no time). */
export function stampMs(day: Date, time?: string | null): number | null {
  const m = clockMinutes(time);
  if (m == null) return null;
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + m * 60_000;
}

export interface LiveFix {
  lat: number;
  lng: number;
  acc?: number | null;
  atMs: number;
  /** Whole minutes since the fix (never negative — server vs phone clock). */
  ageMin: number;
}

/**
 * The tech's heartbeat fix when it's from today and newer than their last
 * clock stamp. A stamp in the same minute wins (stamps only carry minutes, and
 * a clock-out right after a heartbeat is the fresher news).
 */
export function liveFixFor(loc: CrewLocation | null | undefined, lastStampMs: number | null, now: Date): LiveFix | undefined {
  if (!loc) return undefined;
  const atMs = Date.parse(loc.at);
  if (!Number.isFinite(atMs) || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return undefined;
  if (localYmd(new Date(atMs)) !== localYmd(now)) return undefined;
  if (lastStampMs != null && atMs < lastStampMs + 60_000) return undefined;
  return { lat: loc.lat, lng: loc.lng, acc: loc.acc ?? null, atMs, ageMin: Math.max(0, Math.floor((now.getTime() - atMs) / 60_000)) };
}
