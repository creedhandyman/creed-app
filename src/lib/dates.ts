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
