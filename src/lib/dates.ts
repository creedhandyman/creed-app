/**
 * Parse a `time_entries.entry_date` string into a LOCAL Date at midnight.
 *
 * Entries are written in two formats:
 *   - "M/D/YYYY"   — clock in/out (`new Date().toLocaleDateString("en-US")`)
 *   - "YYYY-MM-DD" — manual entry (`new Date().toISOString().split("T")[0]`)
 *
 * The trap: `new Date("2026-06-20")` is parsed as UTC midnight, which in any
 * negative-offset (US) timezone resolves to the PREVIOUS evening. That
 * silently bucketed manually-entered hours into the wrong week/month on the
 * dashboard and Financials — the "couple hours off" pay drift. Building the
 * Date from explicit (year, monthIndex, day) parts keeps it local and stable.
 */
export function parseEntryDate(raw?: string | null): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // "M/D/YYYY" or "MM/DD/YYYY"
  const slash = s.split("/");
  if (slash.length === 3) {
    const m = parseInt(slash[0], 10);
    const d = parseInt(slash[1], 10);
    const y = parseInt(slash[2], 10);
    if (y && m && d) return new Date(y, m - 1, d);
  }

  // "YYYY-MM-DD" (tolerate a trailing time component)
  const dash = s.split("T")[0].split("-");
  if (dash.length === 3) {
    const y = parseInt(dash[0], 10);
    const m = parseInt(dash[1], 10);
    const d = parseInt(dash[2], 10);
    if (y && m && d) return new Date(y, m - 1, d);
  }

  // Last resort — unknown format; may be TZ-sensitive but better than null.
  const t = new Date(s);
  return isNaN(t.getTime()) ? null : t;
}

/**
 * Format a decimal-hours value (the unit stored in time_entries.hours, where
 * 1.5 = 1h 30m) as human hours-and-minutes: "2h 30m", "45m", "3h".
 *
 * Use this for DISPLAYING worked/tracked time — the crew is used to reading a
 * clock, not "2.5h". It is display-only: the underlying decimal number stays
 * in state and DB, and pay math (hours × rate) must keep using that number,
 * never this string. Rounds to the nearest minute and rolls 60m up to the
 * next hour. Zero renders as "0m". Plain string in/out so PDF/HTML builders
 * (payroll-runner, export-*) can import it too.
 */
export function formatHours(decimalHrs?: number | null): string {
  const total = Math.max(0, Number(decimalHrs) || 0);
  let h = Math.floor(total);
  let m = Math.round((total - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
