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

/* ── Start times ───────────────────────────────────────────────────
   Trips started in the app (GPS / odometer / Work-mode tracker) or given a
   time by hand store `start_time` ("8:05 AM", same format as time entries).
   Older rows and Suggested trips have none, so the start is estimated from
   that day's clock-ins: leaving a job = its last clock-out; leaving the shop
   (or an unknown start) = arriving at the next job minus the drive time. */

/** "8:05 AM" / "08:05 PM" / "20:05" → minutes since midnight, or null. */
export function clockMinutes(s?: string | null): number | null {
  const m = (s || "").match(/(\d{1,2}):(\d{2})\s*([AP]M)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const ap = (m[3] || "").toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + parseInt(m[2], 10);
}

/** minutes since midnight → "8:05 AM". */
export function formatClock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** A Date → "8:05 AM" (local). */
export function clockOf(d: Date): string {
  return formatClock(d.getHours() * 60 + d.getMinutes());
}

export interface DayClockEntry { job?: string; start_time?: string; end_time?: string }
export interface LegStart { time: string; estimated: boolean }

/** One start per leg of the day (null = can't tell). */
export function legStartTimes<T extends MileageTrip & { start_time?: string | null }>(
  day: TripDay<T>,
  clockEntries: DayClockEntry[],
  base?: string | null,
): (LegStart | null)[] {
  // The day's job stops in clock order; back-to-back entries at one place merge.
  type Stop = { key: string; arrive: number | null; leave: number | null };
  const stops: Stop[] = [];
  const timed = clockEntries
    .filter((e) => e.job && e.job !== "General" && clockMinutes(e.start_time) != null)
    .sort((a, b) => clockMinutes(a.start_time)! - clockMinutes(b.start_time)!);
  for (const e of timed) {
    const key = norm(e.job!);
    const out = clockMinutes(e.end_time);
    const last = stops[stops.length - 1];
    if (last && last.key === key) {
      last.leave = out == null || last.leave == null ? null : Math.max(last.leave, out);
    } else {
      stops.push({ key, arrive: clockMinutes(e.start_time), leave: out });
    }
  }
  const baseKey = norm(base || "");
  const chain: (Stop & { isBase?: boolean })[] = [];
  if (baseKey) chain.push({ key: baseKey, arrive: null, leave: null, isBase: true });
  chain.push(...stops);
  if (baseKey && stops.length) chain.push({ key: baseKey, arrive: null, leave: null, isBase: true });

  const used = new Set<number>();
  const drive = (mi: number) => Math.max(1, Math.round((mi / 28) * 60)); // = geo.driveMinutes

  return day.legs.map((leg) => {
    const own = (leg.trip.start_time || "").trim();
    if (own) return { time: own, estimated: false };
    const to = norm(leg.trip.job);
    const from = leg.from ? norm(leg.from) : null;
    const miles = Number(leg.trip.total_miles || 0);
    const arriveBy = (s: Stop | undefined) =>
      s && s.arrive != null ? { time: formatClock(s.arrive - drive(miles)), estimated: true } : null;
    for (let k = 0; k + 1 < chain.length; k++) {
      if (used.has(k) || chain[k + 1].key !== to) continue;
      if (from != null && chain[k].key !== from) continue;
      used.add(k);
      const a = chain[k];
      if (!a.isBase && a.leave != null) return { time: formatClock(a.leave), estimated: true };
      return arriveBy(chain[k + 1]);
    }
    // Not part of the clocked chain — fall back to arriving at that job.
    return arriveBy(stops.find((s) => s.key === to));
  });
}
