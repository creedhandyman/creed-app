/**
 * The day's plan — single source for Home's Today / Needs-you / Wrap-up cards:
 * which stops are on the calendar for a day (and which are done), who's on the
 * clock, the owner's "needs you" job buckets and which phase of the day it is.
 *
 * PURE: no store, no Supabase, no React — so it's unit-tested
 * (src/__tests__/day-plan.test.ts). Every rule here is COPIED from the screen
 * that already owns it (Schedule's entry→job match + isScheduled, Timer's
 * stale-shift filter, the dashboard's need buckets, Jobs' balance) so Home can
 * never disagree with the screen a card links to. Change a rule there AND here.
 *
 * Tuning knobs: WRAP_HOUR / LATE_HOUR (when Home flips to "Wrap up the day")
 * and NUDGE_DAYS (when a sent quote needs a follow-up).
 */
import type { Job, Profile, ScheduleEntry, TimeEntry } from "./types";
import { isStaleOpenEntry } from "./shift";
import { parseEntryDate } from "./dates";

/** From this hour the day can wrap once nothing is left to do. */
export const WRAP_HOUR = 15;
/** From this hour the owner always sees the wrap-up. */
export const LATE_HOUR = 17;
/** A sent quote with no answer after this many days needs a nudge. */
export const NUDGE_DAYS = 3;
/** Job statuses that mean the work itself is finished. */
export const FINISHED: Job["status"][] = ["complete", "invoiced", "paid"];

// ── Dates ────────────────────────────────────────────────────────────

/** Local calendar date as YYYY-MM-DD (toISOString would be UTC — the next
 *  day on any US evening). Same body as Schedule's ymd. */
export const localYmd = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** YYYY-MM-DD shifted by n days (noon anchor dodges DST edges). */
export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(ymd + "T12:00:00");
  d.setDate(d.getDate() + n);
  return localYmd(d);
}

/** Is a time entry's entry_date (M/D/YYYY or YYYY-MM-DD) on this local day? */
export function isEntryOnDay(entryDate: string | null | undefined, ymd: string): boolean {
  const d = parseEntryDate(entryDate);
  return d ? localYmd(d) === ymd : false;
}

// ── Schedule note parsing (Schedule.tsx stores "🕐 14:00 · 👷 Ann, Bo") ──

/** "14:00" from the note's 🕐, or "" when untimed. Schedule writes 24h
 *  ("🕐 14:00", returned as-is); AppFolio imports write "🕐 2:00pm" /
 *  "🕐 10:30 AM", normalised here to 24h "HH:MM" ("2:00pm" → "14:00",
 *  "12:15am" → "00:15", "12:30pm" → "12:30") so sorting + fmtClock agree. */
export function parseSchedTime(note?: string | null): string {
  const m = note?.match(/🕐\s*(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s?m\b\.?)?/i);
  if (!m) return "";
  const ap = m[3]?.toLowerCase();
  if (!ap) return `${m[1]}:${m[2]}`;
  let h = Number(m[1]);
  if (ap === "p" && h < 12) h += 12;
  else if (ap === "a" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** Crew names from the note's 👷 list. */
export const parseSchedCrew = (note?: string | null): string[] => {
  const m = note?.match(/👷\s*([^·]+)/);
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
};

/** "14:05" → "2:05 PM" ("" stays ""). */
export function fmtClock(hhmm: string): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  return `${h > 12 ? h - 12 : h || 12}:${String(m).padStart(2, "0")} ${ap}`;
}

// ── Schedule ↔ job (copied from Schedule.tsx) ─────────────────────────

/** An entry's job: the linked one when it has job_id, else (legacy) the
 *  latest non-archived job at that address. */
export function entryJob(e: Pick<ScheduleEntry, "job" | "job_id">, jobs: Job[]): Job | undefined {
  const linked = e.job_id ? jobs.find((j) => j.id === e.job_id) : undefined;
  if (linked) return linked;
  if (!e.job) return undefined;
  return jobs
    .filter((j) => j.property === e.job && !j.archived)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
}

/** Is this job on the calendar? Linked entries count only for their own job.
 *  A legacy (unlinked) entry at the same address counts only if it isn't
 *  older than the job — an old job's visit must not hide a new one there. */
export const isJobScheduled = (j: { id: string; property: string; created_at?: string }, schedule: ScheduleEntry[]) =>
  schedule.some((e) => e.job_id
    ? e.job_id === j.id
    : e.job === j.property && (!j.created_at || e.sched_date >= j.created_at.slice(0, 10)));

/** Multi-day: an entry covers sched_date..end_date (end_date absent = one day). */
const spansDay = (s: { sched_date: string; end_date?: string }, day: string) =>
  day >= s.sched_date && day <= (s.end_date || s.sched_date);

const isOpenEntry = (te: TimeEntry) => !!te.start_time && !te.end_time;

// ── Stops ────────────────────────────────────────────────────────────

export type StopState = "todo" | "now" | "done";

export interface DayStop {
  entry: ScheduleEntry;
  job?: Job;
  /** "HH:MM" from the note, "" when untimed. */
  time: string;
  crew: string[];
  mine: boolean;
  state: StopState;
}

const minutesOf = (hhmm: string): number => {
  if (!hhmm) return Number.POSITIVE_INFINITY; // untimed → last
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

/**
 * Every calendar stop on `day`, in visiting order. A stop is
 *  - "done" when its job is finished, or someone clocked out of it that day
 *    (a closed time entry dated `day`) and nobody is still on it;
 *  - "now" while someone is clocked into it (an open entry dated `day`);
 *  - "todo" otherwise.
 * Archived jobs drop out. Crew = the note's 👷 list + the job's requested
 * tech. Sort: mine first (only when `me` is given), then by time (untimed
 * last), then by address.
 */
export function stopsForDay({ schedule, jobs, timeEntries, day, me }: {
  schedule: ScheduleEntry[];
  jobs: Job[];
  timeEntries: TimeEntry[];
  day: string;
  me?: string;
}): DayStop[] {
  const entries = schedule.filter((e) => spansDay(e, day));
  if (!entries.length) return [];
  const dayEntries = timeEntries.filter((te) => isEntryOnDay(te.entry_date, day));
  const out: DayStop[] = [];
  for (const e of entries) {
    const job = entryJob(e, jobs);
    if (job?.archived) continue;
    const w = parseSchedCrew(e.note);
    const crew = job?.requested_tech && !w.includes(job.requested_tech) ? [...w, job.requested_tech] : w;
    let state: StopState = "todo";
    if (job && FINISHED.includes(job.status)) {
      state = "done";
    } else {
      // Deliberately NOT job-entries' oldest-job rule: this asks "did anyone
      // work this VISIT's address today", so a legacy unlinked entry at the
      // stop's address counts whichever job it resolved to.
      const matches = dayEntries.filter((te) => (job && te.job_id === job.id) || (!te.job_id && te.job === e.job));
      if (matches.some(isOpenEntry)) state = "now";
      else if (matches.length) state = "done";
    }
    out.push({ entry: e, job, time: parseSchedTime(e.note), crew, mine: !!me && crew.includes(me), state });
  }
  return out.sort((a, b) =>
    (me ? Number(b.mine) - Number(a.mine) : 0)
    || minutesOf(a.time) - minutesOf(b.time)
    || (a.entry.job || "").localeCompare(b.entry.job || ""));
}

/**
 * A tech's "Your day" list from ALL of today's stops (stopsForDay with `me`,
 * done ones included): their own stops when they have any today — done or not
 * — else everyone's (nothing assigned → see the crew's day). Then the done
 * ones drop out. Deciding "have I got stops?" before dropping the done ones is
 * what lets a tech wrap once THEIR stops are finished, instead of inheriting
 * another crew's stop that's still to do.
 */
export function techDayStops(stops: DayStop[]): DayStop[] {
  const hasMine = stops.some((s) => s.mine);
  return (hasMine ? stops.filter((s) => s.mine) : stops).filter((s) => s.state !== "done");
}

/** The first stop still to do on `fromDay` or a later day (within maxDays). */
export function nextStopFrom({ schedule, jobs, timeEntries, fromDay, me, maxDays = 14 }: {
  schedule: ScheduleEntry[];
  jobs: Job[];
  timeEntries: TimeEntry[];
  fromDay: string;
  me?: string;
  maxDays?: number;
}): { stop: DayStop; day: string } | null {
  for (let i = 0; i < maxDays; i++) {
    const day = addDaysYmd(fromDay, i);
    const stop = stopsForDay({ schedule, jobs, timeEntries, day, me }).find((s) => s.state !== "done");
    if (stop) return { stop, day };
  }
  return null;
}

// ── Crew + me ────────────────────────────────────────────────────────

export interface OnClock {
  userId: string;
  name: string;
  job: string;
}

/**
 * Who's on the clock right now (an open entry dated today that isn't stale),
 * plus the stale open shifts — forgotten clock-outs from an earlier day or
 * past the long-shift limit (the exact Timer → Crew filter).
 */
export function crewStatus(timeEntries: TimeEntry[], profiles: Profile[], now: Date = new Date()): {
  onClock: OnClock[];
  stale: TimeEntry[];
} {
  const today = localYmd(now);
  const nowMs = now.getTime();
  const onClock = timeEntries
    .filter((e) => isOpenEntry(e) && isEntryOnDay(e.entry_date, today) && !isStaleOpenEntry(e.entry_date, e.start_time, nowMs))
    .map((e) => ({
      userId: e.user_id,
      name: profiles.find((p) => p.id === e.user_id)?.name || e.user_name || "",
      job: e.job,
    }));
  const stale = timeEntries.filter((e) => !e.end_time && e.start_time && !e.paid_at && isStaleOpenEntry(e.entry_date, e.start_time, nowMs));
  return { onClock, stale };
}

/** This user's day so far: hours from finished (closed) entries dated `ymd`,
 *  whether they've clocked out today, and whether any of that was on a job
 *  (not "General") — the cue to log drives. User match = the dashboard's
 *  (by id, or legacy name when the row predates user_id). */
export function myDay(timeEntries: TimeEntry[], user: { id: string; name: string }, ymd: string): {
  hoursToday: number;
  clockedOutToday: boolean;
  workedJobToday: boolean;
} {
  const closed = timeEntries.filter((e) =>
    (e.user_id === user.id || (!e.user_id && e.user_name === user.name))
    && isEntryOnDay(e.entry_date, ymd)
    && !isOpenEntry(e));
  return {
    hoursToday: closed.reduce((s, e) => s + (e.hours || 0), 0),
    clockedOutToday: closed.length > 0,
    workedJobToday: closed.some((e) => !!e.job && e.job !== "General"),
  };
}

// ── Needs-you buckets (the dashboard's 2x2 + leads) ───────────────────

export type NeedKey = "lead" | "toSend" | "waiting" | "toInvoice" | "unpaid";

/** Which Jobs tab each bucket lives on. */
export const NEED_TAB: Record<NeedKey, "active" | "billing"> = {
  lead: "active", toSend: "active", waiting: "active", toInvoice: "billing", unpaid: "billing",
};

/** A quote that already went out is waiting on the customer, not on you. */
export function needMatch(k: NeedKey, j: Job): boolean {
  if (j.archived) return false;
  switch (k) {
    case "lead": return j.status === "lead";
    case "toSend": return j.status === "quoted" && !j.quote_sent_at;
    case "waiting": return j.status === "quoted" && !!j.quote_sent_at;
    case "toInvoice": return j.status === "complete";
    case "unpaid": return j.status === "invoiced";
  }
}

/** A sent quote with no answer for NUDGE_DAYS+ days. */
export function needsNudge(j: Job, now: Date = new Date()): boolean {
  if (!needMatch("waiting", j)) return false;
  const sent = Date.parse(j.quote_sent_at || "");
  if (Number.isNaN(sent)) return false;
  return now.getTime() - sent >= NUDGE_DAYS * 86400000;
}

/** What the customer still owes, in dollars (= Jobs' balanceOf().due). */
export function balanceDue(j: Job): number {
  const paid = Math.round((Number(j.amount_paid) || 0) * 100) / 100;
  return Math.round(Math.max(0, (j.total || 0) - paid) * 100) / 100;
}

// ── Phase ────────────────────────────────────────────────────────────

export type DayPhase = "start" | "work" | "wrap";

/**
 * Which card Home leads with. On the clock → "work" (copy only — the layout
 * never reorders). Owner: wrap from LATE_HOUR, or from WRAP_HOUR once no
 * stops are left to do. Tech: wrap once their stops are done and they've
 * clocked out (or it's past WRAP_HOUR).
 */
export function dayPhase({ hour, clockedIn, admin, todoStops, clockedOutToday }: {
  hour: number;
  clockedIn: boolean;
  admin: boolean;
  todoStops: number;
  clockedOutToday: boolean;
}): DayPhase {
  if (clockedIn) return "work";
  if (admin) return hour >= LATE_HOUR || (hour >= WRAP_HOUR && todoStops === 0) ? "wrap" : "start";
  return todoStops === 0 && (clockedOutToday || hour >= WRAP_HOUR) ? "wrap" : "start";
}
