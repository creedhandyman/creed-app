// Shared rules for open (still-clocked-in) time entries.

/** A shift running this long was almost certainly a forgotten clock-out:
 *  instead of booking all of it (or a flat 12h), ask when they finished. */
export const LONG_SHIFT_MS = 12 * 60 * 60 * 1000;

/** Start of an entry as epoch ms, from its entry_date (M/D/YYYY or
 *  YYYY-MM-DD) + start_time ("07:42 AM" or "07:42"). null if unparseable. */
export function entryStartMs(entryDate?: string | null, startTime?: string | null): number | null {
  if (!entryDate || !startTime) return null;
  let base: Date;
  if (entryDate.includes("-")) {
    base = new Date(entryDate + "T00:00:00");
  } else if (entryDate.includes("/")) {
    const [m, d, y] = entryDate.split("/").map((n) => parseInt(n, 10));
    base = new Date(y, m - 1, d);
  } else {
    return null;
  }
  const m = startTime.match(/(\d+):(\d+)\s*([AP]M)?/i);
  if (!m || isNaN(base.getTime())) return null;
  let h = parseInt(m[1], 10);
  const ap = m[3]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  base.setHours(h, parseInt(m[2], 10), 0, 0);
  return base.getTime();
}

/** True for an open entry that started on a previous day or is over the
 *  long-shift limit — i.e. someone forgot to clock out. */
export function isStaleOpenEntry(entryDate?: string | null, startTime?: string | null, now = Date.now()): boolean {
  const start = entryStartMs(entryDate, startTime);
  if (start === null) return false;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return start < today.getTime() || now - start >= LONG_SHIFT_MS;
}
