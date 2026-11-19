/**
 * Wall-clock time in a named time zone ↔ UTC, with no library (Intl only).
 * Used by the calendar feed and the Google Calendar sync, which must say
 * exactly WHEN a visit is: a time with no zone ("floating") was read as UTC
 * by Google's calendar subscriptions, putting Wichita jobs 5–6 h early.
 */
const pad = (n: number) => String(n).padStart(2, "0");

function parts(t: number, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t));
  const g = (k: string) => Number(f.find((p) => p.type === k)?.value);
  return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour") % 24, mi: g("minute"), s: g("second") };
}

/** Offset of `tz` from UTC at instant `t`, in ms (Chicago in winter = −6 h). */
export function tzOffsetMs(t: number, tz: string): number {
  const p = parts(t, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000;
}

/** "2026-11-22" + "08:00" in `tz` → the UTC instant. */
export function zonedToUtc(ymd: string, hhmm: string, tz: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = (hhmm || "00:00").split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - tzOffsetMs(guess, tz);
  // Re-check at the result so a DST change between guess and answer is right.
  return new Date(guess - tzOffsetMs(first, tz));
}

/** A UTC instant → its date + "HH:MM" on the wall clock in `tz`. */
export function utcToZoned(t: Date | number | string, tz: string): { date: string; time: string } {
  const p = parts(new Date(t).getTime(), tz);
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

/** iCalendar UTC stamp: 20261122T140000Z. */
export function icsUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
