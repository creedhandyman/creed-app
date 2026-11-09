// Online booking — the ONE place that decides which times a customer can
// pick on /book/[slug]. Pure (no Supabase, no Date.now()) so it is fully
// tested in `__tests__/booking.test.ts`; the public API routes feed it the
// org's settings, the org's schedule rows and "now" in the org's time zone.
//
// Model: one crew per business (a booking blocks the whole business for its
// length). A time is open when the appointment fits INSIDE one work window
// (so it never runs through lunch), starts on a step boundary, starts after
// the minimum notice, and stays `bufferMin` clear of every other visit.
// Existing visits with no time in their note, and multi-day visits, block
// the whole day — the safe reading when we can't tell when the crew is busy.

/** "HH:MM" 24h. */
export type Hhmm = string;
/** Work windows per weekday, keyed "0" (Sun) … "6" (Sat). A missing or empty
 *  day is closed. Each window is [start, end] in "HH:MM". */
export type BookingHours = Record<string, [Hhmm, Hhmm][]>;

/** Bernard's day: 9:30 to noon and 1:30 to 6, lunch kept clear, Mon–Fri. */
export const DEFAULT_BOOKING_HOURS: BookingHours = {
  "0": [],
  "1": [["09:30", "12:00"], ["13:30", "18:00"]],
  "2": [["09:30", "12:00"], ["13:30", "18:00"]],
  "3": [["09:30", "12:00"], ["13:30", "18:00"]],
  "4": [["09:30", "12:00"], ["13:30", "18:00"]],
  "5": [["09:30", "12:00"], ["13:30", "18:00"]],
  "6": [],
};

export interface BookingSettings {
  hours: BookingHours;
  /** Appointment length offered to customers, minutes. */
  slotMin: number;
  /** Gap kept before and after every visit (drive time), minutes. */
  bufferMin: number;
  /** No bookings sooner than this many hours from now. */
  minNoticeHours: number;
  /** How many days ahead the page shows. */
  daysAhead: number;
  /** IANA zone the hours are written in. */
  tz: string;
}

export const BOOKING_DEFAULTS: Omit<BookingSettings, "hours"> = {
  slotMin: 120,
  bufferMin: 30,
  minNoticeHours: 24,
  daysAhead: 21,
  tz: "America/Chicago",
};

/** Start times are offered every this many minutes. */
export const SLOT_STEP_MIN = 30;

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
};

/** "9:30" / "09:30" → 570; anything else → NaN. */
export function toMin(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || "").trim());
  if (!m) return NaN;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 24 || mi > 59) return NaN;
  return h * 60 + mi;
}

/** 570 → "09:30". */
export function fromMin(min: number): Hhmm {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** "14:00" → "2:00 PM". */
export function fmt12(hhmm: string): string {
  const m = toMin(hhmm);
  if (!Number.isFinite(m)) return hhmm;
  const h = Math.floor(m / 60), mi = m % 60;
  return `${h % 12 || 12}:${String(mi).padStart(2, "0")} ${h >= 12 && h < 24 ? "PM" : "AM"}`;
}

/** The one validity rule for stored hours (jsonb or its JSON text). Bad
 *  windows (unparseable, end ≤ start) are dropped. Junk (not an object, or no
 *  day keys at all) → the default hours. A real setting with every day closed
 *  stays closed, so the owner can stop offering times without the switch. */
export function readBookingHours(raw: unknown): BookingHours {
  let v: unknown = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
  if (!v || typeof v !== "object" || Array.isArray(v)) return DEFAULT_BOOKING_HOURS;
  const out: BookingHours = {};
  let anyDay = false;
  for (let d = 0; d < 7; d++) {
    const day = (v as Record<string, unknown>)[String(d)];
    const wins: [Hhmm, Hhmm][] = [];
    if (Array.isArray(day)) {
      anyDay = true;
      for (const w of day) {
        if (!Array.isArray(w) || w.length !== 2) continue;
        const a = toMin(String(w[0])), b = toMin(String(w[1]));
        if (Number.isFinite(a) && Number.isFinite(b) && b > a) wins.push([fromMin(a), fromMin(b)]);
      }
    }
    wins.sort((x, y) => toMin(x[0]) - toMin(y[0]));
    out[String(d)] = wins;
  }
  return anyDay ? out : DEFAULT_BOOKING_HOURS;
}

/** Org row → settings with every default applied (missing columns = defaults). */
export function readBookingSettings(org: Record<string, unknown> | null | undefined): BookingSettings {
  const o = org || {};
  const tz = typeof o.booking_tz === "string" && o.booking_tz.trim() ? o.booking_tz.trim() : BOOKING_DEFAULTS.tz;
  return {
    hours: readBookingHours(o.booking_hours),
    slotMin: clampInt(o.booking_slot_min, 30, 480, BOOKING_DEFAULTS.slotMin),
    bufferMin: clampInt(o.booking_buffer_min, 0, 240, BOOKING_DEFAULTS.bufferMin),
    minNoticeHours: clampInt(o.booking_min_notice_hours, 0, 24 * 14, BOOKING_DEFAULTS.minNoticeHours),
    daysAhead: clampInt(o.booking_days_ahead, 1, 60, BOOKING_DEFAULTS.daysAhead),
    tz: isValidTz(tz) ? tz : BOOKING_DEFAULTS.tz,
  };
}

export function isValidTz(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/** One visit already on the calendar, reduced to what the slot finder needs. */
export interface BusyVisit {
  date: string;            // YYYY-MM-DD (start day)
  endDate?: string | null; // last day for multi-day visits
  start?: Hhmm | null;     // null/"" = no time known → blocks the whole day
  durationMin?: number | null;
}

/** "Now" in the business's own time zone. */
export interface LocalNow { date: string; minutes: number }

/** The wall-clock date + minute in `tz` at instant `now`. */
export function localNow(now: Date, tz: string): LocalNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: Number(g("hour")) * 60 + Number(g("minute")) };
}

/** YYYY-MM-DD + n days (calendar math in UTC, so no DST drift). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Busy minute ranges on `date` (already widened by the buffer). A whole-day
 *  block is [0, 1440]. */
function busyRanges(date: string, visits: BusyVisit[], defaultMin: number, bufferMin: number): [number, number][] {
  const out: [number, number][] = [];
  for (const v of visits) {
    const end = v.endDate && v.endDate > v.date ? v.endDate : v.date;
    if (date < v.date || date > end) continue;
    const s = v.start ? toMin(v.start) : NaN;
    if (end !== v.date || !Number.isFinite(s)) { out.push([0, 1440]); continue; }
    const dur = typeof v.durationMin === "number" && v.durationMin > 0 ? v.durationMin : defaultMin;
    out.push([s - bufferMin, s + dur + bufferMin]);
  }
  return out;
}

/** Open start times on one day. `earliest` = the first allowed minute that
 *  day (min notice), or 0. */
export function openSlotsOnDay(
  date: string,
  s: Pick<BookingSettings, "hours" | "slotMin" | "bufferMin">,
  visits: BusyVisit[],
  earliest = 0,
): Hhmm[] {
  const wins = s.hours[String(weekdayOf(date))] || [];
  const busy = busyRanges(date, visits, s.slotMin, s.bufferMin);
  const out: Hhmm[] = [];
  for (const [ws, we] of wins) {
    const a = toMin(ws), b = toMin(we);
    // Step from the window's own start so 9:30 is offered, not 9:00.
    for (let t = a; t + s.slotMin <= b; t += SLOT_STEP_MIN) {
      if (t < earliest) continue;
      const clash = busy.some(([bs, be]) => t < be && t + s.slotMin > bs);
      if (!clash) out.push(fromMin(t));
    }
  }
  return out;
}

export interface DaySlots { date: string; slots: Hhmm[] }

/** Every open time from today through `daysAhead`, days with none left out. */
export function openSlots(s: BookingSettings, visits: BusyVisit[], now: LocalNow): DaySlots[] {
  const noticeAt = now.minutes + s.minNoticeHours * 60; // minutes from today's midnight
  const out: DaySlots[] = [];
  for (let i = 0; i <= s.daysAhead; i++) {
    const date = addDays(now.date, i);
    const earliest = noticeAt - i * 1440;
    if (earliest >= 1440) continue; // the whole day is inside the notice
    const slots = openSlotsOnDay(date, s, visits, Math.max(0, earliest));
    if (slots.length) out.push({ date, slots });
  }
  return out;
}

/** Is this exact start still bookable? (Re-checked right before saving.) */
export function isSlotOpen(s: BookingSettings, visits: BusyVisit[], now: LocalNow, date: string, start: Hhmm): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(toMin(start))) return false;
  return openSlots(s, visits, now).some((d) => d.date === date && d.slots.includes(fromMin(toMin(start))));
}

/** A schedule row → BusyVisit. The time comes from the "🕐 2:30pm" in the
 *  note first, because Schedule and Dispatch retime a visit by rewriting the
 *  note; `start_time` is only the fallback (`parseTime` is day-plan's
 *  parseSchedTime, injected to keep this file import-free). The length comes
 *  from `duration_min`, else the linked job's labor hours (one crew, capped
 *  at a workday), else the default appointment length. */
export function visitFromRow(
  row: { sched_date: string; end_date?: string | null; note?: string | null; start_time?: string | null; duration_min?: number | null },
  parseTime: (note?: string | null) => string,
  jobHours?: number | null,
): BusyVisit {
  const fromNote = parseTime(row.note);
  const raw = fromNote && Number.isFinite(toMin(fromNote)) ? fromNote
    : row.start_time && Number.isFinite(toMin(row.start_time)) ? row.start_time : "";
  const start = raw ? fromMin(toMin(raw)) : null;
  const dur = typeof row.duration_min === "number" && row.duration_min > 0
    ? row.duration_min
    : typeof jobHours === "number" && jobHours > 0 ? Math.min(600, Math.round(jobHours * 60)) : null;
  return { date: String(row.sched_date).slice(0, 10), endDate: row.end_date || null, start, durationMin: dur };
}

/** Google Calendar "add event" link for a confirmed visit (the customer's
 *  confirmation email). Times are wall-clock in `tz`. */
export function googleCalendarUrl(p: { title: string; date: string; start: Hhmm; durationMin: number; tz: string; location?: string; details?: string }): string {
  const s = toMin(p.start);
  const e = s + p.durationMin;
  const dEnd = e >= 1440 ? addDays(p.date, 1) : p.date;
  const stamp = (d: string, m: number) => `${d.replace(/-/g, "")}T${fromMin(m % 1440).replace(":", "")}00`;
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: p.title,
    dates: `${stamp(p.date, s)}/${stamp(dEnd, e)}`,
    ctz: p.tz,
    ...(p.location ? { location: p.location } : {}),
    ...(p.details ? { details: p.details } : {}),
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** "2026-11-10" → "Tue, Nov 10". */
export function fmtDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
