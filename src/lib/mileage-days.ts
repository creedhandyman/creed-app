/* Mileage log grouped by day — shared by the Mileage screen and its PDF.
   Each logged trip is ONE leg and only stores where it went (`job`), so a
   leg's starting point is inferred: the previous leg's destination that day,
   or — for the day's first leg — the shop (org address) when one is set,
   matching how Suggested trips chains shop → jobs → shop. */

export interface MileageTrip {
  id: string;
  job: string;
  trip_date: string;
  start_miles: number;
  end_miles: number;
  total_miles: number;
  created_at?: string;
}

export interface TripLeg<T extends MileageTrip = MileageTrip> {
  trip: T;
  /** Inferred start (previous stop / shop); null when unknown. */
  from: string | null;
  /** The destination is the shop (the drive home / back to base). */
  toBase: boolean;
}

export interface TripDay<T extends MileageTrip = MileageTrip> {
  date: string;
  legs: TripLeg<T>[];
  miles: number;
}

const norm = (s: string) => (s || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

/** Days newest-first (or oldest-first with `asc`); legs always in the order they were logged. */
export function groupTripsByDay<T extends MileageTrip>(trips: T[], base?: string | null, asc = false): TripDay<T>[] {
  const baseN = norm(base || "");
  const byDate = new Map<string, T[]>();
  for (const t of trips) {
    const d = t.trip_date || "Unknown";
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(t);
  }
  const days: TripDay<T>[] = [];
  for (const [date, list] of byDate) {
    list.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    const legs: TripLeg<T>[] = list.map((trip, i) => ({
      trip,
      from: i > 0 ? list[i - 1].job || null : (base || "").trim() || null,
      toBase: !!baseN && norm(trip.job) === baseN,
    }));
    // A first leg that drives TO the shop didn't start there.
    if (legs[0]?.toBase) legs[0].from = null;
    // Two legs in a row to the same place: the second didn't start "there".
    for (const l of legs) if (l.from && norm(l.from) === norm(l.trip.job)) l.from = null;
    days.push({ date, legs, miles: list.reduce((s, t) => s + Number(t.total_miles || 0), 0) });
  }
  days.sort((a, b) => (asc ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
  return days;
}

/** "2026-10-16" → "Fri, Oct 16" (local day, no UTC slide). */
export function dayLabel(ymd: string, withYear = false): string {
  const m = (ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return ymd || "Unknown";
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
}
