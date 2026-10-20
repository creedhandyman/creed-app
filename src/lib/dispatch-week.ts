/**
 * Dispatch Assistant glue: the app's calendar ⇄ the week route planner.
 *
 *  - collectWeek:  what's booked on the planned days (per visit-day, with
 *                  crew + promised time + on-site minutes) and the pool of
 *                  jobs still waiting for a day.
 *  - toPlanInput:  those → route-plan's fixed / flex visits, once the
 *                  addresses have coordinates.
 *  - planWrites:   an accepted plan → schedule rows to insert (new jobs) and
 *                  patches for booked visits it gave a time / crew / new day.
 *  - crewNow:      where each tech is now — their live heartbeat fix when
 *                  it's newer than their last clock-in/out GPS stamp today —
 *                  the job they're clocked into and their next stop (for
 *                  "John is 10 min from …").
 *
 * PURE (no store, React or fetch), tested in src/__tests__/dispatch-week.test.ts.
 * Calendar rules come from lib/day-plan (the same entry→job match, crew list
 * and done/now/todo states Home and Schedule use) so the assistant can't
 * disagree with the calendar it's planning.
 */
import type { CrewLocation, Job, Profile, ScheduleEntry, TimeEntry, TimeOffRequest } from "./types";
import { stopsForDay, entryJob, isJobScheduled, parseSchedTime, parseSchedCrew, localYmd, isEntryOnDay } from "./day-plan";
import { isStaleOpenEntry } from "./shift";
import { clockMinutes, formatClock } from "./mileage-days";
import { liveFixFor, stampMs } from "./crew-location";
import { haversineMiles, ROAD_FACTOR, driveMinutes } from "./geo";
import { hhmmToMin, minToHhmm, roundQuarter } from "./route-plan";
import { planningCrew } from "./job-duration";
import type { FixedVisit, FlexVisit, LatLng, PlanInput, PlanOptions, WeekPlan } from "./route-plan";

/** On-site time for a job whose quote has no labor hours. */
export const DEFAULT_JOB_MIN = 120;
/** On-site time for a calendar entry with no job behind it. */
export const DEFAULT_VISIT_MIN = 120;

export interface Crew { id: string; name: string }

export interface PoolJob {
  job: Job;
  /** Total on-site minutes (all crew together). */
  totalMin: number;
  /** No labor hours on the quote → DEFAULT_JOB_MIN. */
  estimated: boolean;
  /** The job's requested tech, when they're on this week's crew. */
  techId?: string;
  /** People who work it together: the quote's Crew pick, else Auto (2 for
   *  more than a day's work — job-duration's rule — but never more people
   *  than this plan has). */
  crew: number;
  /** The quote's own day estimate when it's more than one day (it counts
   *  dry/cure waits, so the job isn't squeezed into fewer days). */
  minDays?: number;
}

/** Crew pick + AI day estimate off a quote's rooms blob (null = Auto / none). */
export function quotePlanning(job: Pick<Job, "rooms">): { crewSize: number | null; estDays: number | null } {
  try {
    const d = typeof job.rooms === "string" ? JSON.parse(job.rooms || "{}") : job.rooms;
    const cs = d?.crewSize;
    const ed = d?.estDays;
    return {
      crewSize: typeof cs === "number" && cs > 0 ? Math.round(cs) : null,
      estDays: typeof ed === "number" && ed > 0 ? ed : null,
    };
  } catch {
    return { crewSize: null, estDays: null };
  }
}

export interface BookedVisit {
  /** `${entry.id}@${day}` — one per entry per planned day. */
  key: string;
  entry: ScheduleEntry;
  job?: Job;
  day: string;
  /** Crew on the planning roster (the note's 👷 list + the requested tech). */
  techIds: string[];
  /** Everyone named on the visit, roster or not. */
  crewNames: string[];
  /** On-site minutes per tech that day. */
  durMin: number;
  fixedMin?: number;
  estimated: boolean;
  /** One day, at most one person, not under way → may be re-planned. */
  movable: boolean;
  /** Someone is clocked into it right now. */
  inProgress: boolean;
  /** Names people, none of them on this plan's crew (a sub, or a tech who's
   *  off this week) — left out of the plan, untouched. */
  external: boolean;
}

const nameKey = (s: string) => s.trim().toLowerCase();

/** Calendar days an entry covers (end_date absent = 1). */
export function spanDays(e: Pick<ScheduleEntry, "sched_date" | "end_date">): number {
  const end = e.end_date && e.end_date > e.sched_date ? e.end_date : e.sched_date;
  return Math.round((Date.parse(end + "T12:00:00") - Date.parse(e.sched_date + "T12:00:00")) / 86400000) + 1;
}

export function collectWeek({ jobs, schedule, timeEntries, crew, days, includeQuoted, dayMin }: {
  jobs: Job[];
  schedule: ScheduleEntry[];
  timeEntries: TimeEntry[];
  crew: Crew[];
  days: string[];
  includeQuoted: boolean;
  /** Working minutes in a day (caps a visit's per-day time). */
  dayMin: number;
}): { pool: PoolJob[]; booked: BookedVisit[] } {
  const idByName = new Map(crew.map((c) => [nameKey(c.name), c.id]));

  // A job's hours are shared over every calendar day it's booked for, so a
  // job split into a Monday and a Thursday visit isn't counted twice.
  const visitDays = new Map<string, number>();
  for (const e of schedule) {
    const j = entryJob(e, jobs);
    if (j) visitDays.set(j.id, (visitDays.get(j.id) || 0) + spanDays(e));
  }

  const booked: BookedVisit[] = [];
  for (const day of days) {
    for (const s of stopsForDay({ schedule, jobs, timeEntries, day })) {
      if (s.state === "done") continue;
      const techIds = [...new Set(s.crew.map((n) => idByName.get(nameKey(n))).filter((x): x is string => !!x))];
      const hrs = s.job?.total_hrs || 0;
      const estimated = !(hrs > 0) || !s.job;
      const share = estimated ? DEFAULT_VISIT_MIN : (hrs * 60) / Math.max(1, visitDays.get(s.job!.id) || 1);
      // Everyone named works it together, so the wall time splits over them.
      const durMin = Math.round(Math.min(dayMin, Math.max(15, share / Math.max(1, s.crew.length))));
      const inProgress = s.state === "now";
      booked.push({
        key: `${s.entry.id}@${day}`,
        entry: s.entry,
        job: s.job,
        day,
        techIds,
        crewNames: s.crew,
        durMin,
        fixedMin: hhmmToMin(s.time) ?? undefined,
        estimated,
        movable: spanDays(s.entry) === 1 && s.crew.length <= 1 && !inProgress,
        inProgress,
        external: s.crew.length > 0 && techIds.length === 0,
      });
    }
  }

  const pool: PoolJob[] = jobs
    .filter((j) => !j.archived && !!j.property?.trim()
      && (j.status === "accepted" || (includeQuoted && j.status === "quoted"))
      && !isJobScheduled(j, schedule))
    .sort((a, b) => Number(a.status !== "accepted") - Number(b.status !== "accepted")
      || (a.created_at || "").localeCompare(b.created_at || ""))
    .map((job) => {
      const hrs = job.total_hrs || 0;
      const q = quotePlanning(job);
      // A crew picked on the quote is kept (the planner reports it when that
      // many people aren't free together); Auto never asks for more people
      // than are being planned.
      const crewN = q.crewSize ?? Math.min(planningCrew(hrs, null), Math.max(1, crew.length));
      // estimateDays' other half (hours ÷ crew ÷ day) is the planner's own,
      // with this plan's working hours.
      const aiDays = hrs > 0 && q.estDays ? Math.ceil(q.estDays) : 0;
      return {
        job,
        totalMin: hrs > 0 ? Math.round(hrs * 60) : DEFAULT_JOB_MIN,
        estimated: !(hrs > 0),
        techId: job.requested_tech ? idByName.get(nameKey(job.requested_tech)) : undefined,
        crew: crewN,
        minDays: aiDays > 1 ? aiDays : undefined,
      };
    });

  return { pool, booked };
}

/** Is a tech on approved time off that day? */
export function isOffDay(timeOff: TimeOffRequest[], techId: string, day: string): boolean {
  return timeOff.some((r) => r.status === "approved" && r.user_id === techId && r.start_date <= day && day <= r.end_date);
}

export const poolKey = (jobId: string) => `job:${jobId}`;

export function toPlanInput({ pool, booked, coords, days, crew, replanBooked, leaveOut, base, timeOff, startMinByDay, opts }: {
  pool: PoolJob[];
  booked: BookedVisit[];
  /** Coordinates for an address (null/undefined = not found). */
  coords: (address: string) => LatLng | null | undefined;
  days: string[];
  crew: Crew[];
  /** Let the planner move single-person booked visits to other days/techs. */
  replanBooked: boolean;
  /** Pool job ids the dispatcher left out of this plan. */
  leaveOut: string[];
  base: LatLng | null;
  timeOff: TimeOffRequest[];
  startMinByDay?: Record<string, number>;
  opts?: Partial<PlanOptions>;
}): { input: PlanInput; noLocation: string[] } {
  const fixed: FixedVisit[] = [];
  const flex: FlexVisit[] = [];
  const noLocation: string[] = [];

  for (const b of booked) {
    if (b.external) continue;
    const pt = coords(b.entry.job);
    if (!pt) { noLocation.push(b.key); continue; }
    const common = { key: b.key, jobId: b.job?.id, entryId: b.entry.id, address: b.entry.job, pt };
    if (replanBooked && b.movable) {
      // Moving it to another day drops its old promised time.
      flex.push({ ...common, totalMin: b.durMin, isNew: false, phase: -1 });
    } else if (b.techIds.length) {
      for (const techId of b.techIds) fixed.push({ ...common, durMin: b.durMin, fixedMin: b.fixedMin, day: b.day, techId });
    } else {
      // Booked with nobody on it: keeps its day, gets a tech.
      flex.push({ ...common, totalMin: b.durMin, fixedMin: b.fixedMin, days: [b.day], isNew: false, phase: -1 });
    }
  }

  for (const p of pool) {
    if (leaveOut.includes(p.job.id)) continue;
    const key = poolKey(p.job.id);
    const pt = coords(p.job.property);
    if (!pt) { noLocation.push(key); continue; }
    flex.push({
      key, jobId: p.job.id, address: p.job.property, pt, totalMin: p.totalMin,
      crew: p.crew, minDays: p.minDays,
      leadId: p.techId, isNew: true, phase: p.job.status === "accepted" ? 0 : 1,
    });
  }

  return {
    input: {
      days,
      techIds: crew.map((c) => c.id),
      base,
      fixed,
      flex,
      isOff: (techId, day) => isOffDay(timeOff, techId, day),
      startMinByDay,
      opts,
    },
    noLocation,
  };
}

// ── Notes ────────────────────────────────────────────────────────────

/** A schedule note without its 🕐 time and 👷 crew parts (the free text). */
export function stripNoteParts(note?: string | null): string {
  return (note || "")
    .replace(/🕐\s*\d{1,2}:\d{2}(?:\s*[ap]\.?\s?m\b\.?)?\s*·?\s*/gi, "")
    .replace(/👷\s*[^·]+·?\s*/g, "")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
}

/** "🕐 14:00 · 👷 Ann, Bo · <free text>" — the order Schedule's quick-add writes. */
export function composeNote(note: string | null | undefined, time: string, crew: string[]): string {
  return [time ? `🕐 ${time}` : "", crew.length ? `👷 ${crew.join(", ")}` : "", stripNoteParts(note)]
    .filter(Boolean)
    .join(" · ");
}

// ── Plan → calendar writes ───────────────────────────────────────────

export interface SchedulePost {
  jobId: string;
  job: string;
  sched_date: string;
  end_date?: string;
  note: string;
}

export interface SchedulePatch {
  entryId: string;
  job: string;
  patch: { sched_date?: string; note?: string };
  moved: boolean;
  retimed: boolean;
  recrewed: boolean;
}

export function planWrites(plan: WeekPlan, { booked, crew, replanBooked }: {
  booked: BookedVisit[];
  crew: Crew[];
  replanBooked: boolean;
}): { posts: SchedulePost[]; patches: SchedulePatch[] } {
  const nameOf = (id: string) => crew.find((c) => c.id === id)?.name || "";
  const pieces = new Map<string, { day: string; techId: string; startMin: number; address: string; jobId?: string }[]>();
  for (const r of plan.routes) {
    for (const s of r.stops) {
      const list = pieces.get(s.key) || [];
      list.push({ day: r.day, techId: r.techId, startMin: s.startMin, address: s.address, jobId: s.jobId });
      pieces.set(s.key, list);
    }
  }
  const byDay = <T extends { day: string }>(a: T, b: T) => a.day.localeCompare(b.day);
  const techNames = (list: { techId: string }[]) => [...new Set(list.map((p) => p.techId))].map(nameOf).filter(Boolean);

  const posts: SchedulePost[] = [];
  for (const [key, list] of pieces) {
    if (!key.startsWith("job:")) continue;
    list.sort(byDay);
    const first = list[0];
    const last = list[list.length - 1];
    // A crew visit is one row: everyone on it, starting when the last of
    // them is there (the planner gives them the same start).
    const startMin = Math.max(...list.filter((p) => p.day === first.day).map((p) => p.startMin));
    posts.push({
      jobId: first.jobId || key.slice(4),
      job: first.address,
      sched_date: first.day,
      end_date: last.day > first.day ? last.day : undefined,
      note: composeNote("", minToHhmm(roundQuarter(startMin)), techNames(list)),
    });
  }

  const patches: SchedulePatch[] = [];
  const entryIds = [...new Set(booked.map((b) => b.entry.id))];
  for (const entryId of entryIds) {
    const visits = booked.filter((b) => b.entry.id === entryId);
    if (visits.some((v) => v.external)) continue;
    const placed = visits.map((b) => pieces.get(b.key));
    if (placed.some((p) => !p?.length)) continue; // part of it wasn't planned — leave it alone
    const all = (placed as NonNullable<(typeof placed)[number]>[]).flat().sort(byDay);
    const e = visits[0].entry;
    const replanned = replanBooked && visits.every((v) => v.movable);
    const oldTime = parseSchedTime(e.note);
    const oldCrew = parseSchedCrew(e.note);
    const crewless = visits.every((v) => !v.crewNames.length);

    // A crew visit starts when the last of them is there (the planner lines
    // their starts up), so take the latest start on its first day.
    const startMin = Math.max(...all.filter((p) => p.day === all[0].day).map((p) => p.startMin));
    const time = oldTime && !replanned ? oldTime : minToHhmm(roundQuarter(startMin));
    const crewNames = crewless || replanned ? techNames(all) : oldCrew;
    const day = replanned ? all[0].day : e.sched_date;

    const retimed = time !== oldTime;
    const recrewed = crewNames.join("|") !== oldCrew.join("|");
    const moved = day !== e.sched_date;
    if (!retimed && !recrewed && !moved) continue;
    const patch: SchedulePatch["patch"] = {};
    if (retimed || recrewed) patch.note = composeNote(e.note, time, crewNames);
    if (moved) patch.sched_date = day;
    patches.push({ entryId, job: e.job, patch, moved, retimed, recrewed });
  }
  return { posts, patches };
}

// ── Crew right now ───────────────────────────────────────────────────

export interface CrewNow {
  id: string;
  name: string;
  /** Where they are, as far as the app knows: the live heartbeat fix when it's
   *  newer than their last clock-in/out GPS stamp today, else that stamp.
   *  `ageMin` is set for a live fix only. */
  fix?: { lat: number; lng: number; time: string; kind: "in" | "out" | "live"; ageMin?: number };
  /** Clocked into this job right now. */
  onJob?: { address: string; since: string; jobId?: string };
  /** Their next stop still to do today. */
  next?: { address: string; time: string; jobId?: string };
}

export function crewNow({ crew, timeEntries, schedule, jobs, locations = [], now = new Date() }: {
  crew: Pick<Profile, "id" | "name">[];
  timeEntries: TimeEntry[];
  schedule: ScheduleEntry[];
  jobs: Job[];
  /** crew_locations rows (owners/managers only — empty for crew). */
  locations?: CrewLocation[];
  now?: Date;
}): CrewNow[] {
  const today = localYmd(now);
  const todays = timeEntries.filter((e) => isEntryOnDay(e.entry_date, today));
  const stops = stopsForDay({ schedule, jobs, timeEntries, day: today });
  return crew.map((p) => {
    const mine = todays.filter((e) => e.user_id === p.id);
    const stamped = mine
      .filter((e) => e.start_lat != null || e.end_lat != null)
      .sort((a, b) => (clockMinutes(b.end_time || b.start_time) ?? 0) - (clockMinutes(a.end_time || a.start_time) ?? 0));
    const last = stamped[0];
    let fix: CrewNow["fix"];
    if (last) {
      const out = last.end_lat != null && last.end_lng != null;
      const lat = out ? last.end_lat : last.start_lat;
      const lng = out ? last.end_lng : last.start_lng;
      if (lat != null && lng != null) fix = { lat, lng, time: (out ? last.end_time : last.start_time) || "", kind: out ? "out" : "in" };
    }
    const live = liveFixFor(locations.find((l) => l.user_id === p.id), fix ? stampMs(now, fix.time) : null, now);
    if (live) {
      const d = new Date(live.atMs);
      fix = { lat: live.lat, lng: live.lng, time: formatClock(d.getHours() * 60 + d.getMinutes()), kind: "live", ageMin: live.ageMin };
    }
    const open = mine.find((e) => !!e.start_time && !e.end_time && !isStaleOpenEntry(e.entry_date, e.start_time, now.getTime()));
    const onJob = open ? { address: open.job, since: open.start_time || "", jobId: open.job_id } : undefined;
    const nextStop = stops.find((s) => s.state === "todo" && s.crew.includes(p.name)
      && !(onJob && (s.job?.id ? s.job.id === onJob.jobId : s.entry.job === onJob.address)));
    const next = nextStop ? { address: nextStop.entry.job, time: nextStop.time, jobId: nextStop.job?.id } : undefined;
    return { id: p.id, name: p.name, fix, onJob, next };
  });
}

/** Road miles + drive minutes between two points (the app-wide estimate). */
export function etaBetween(a: LatLng, b: LatLng): { miles: number; min: number } {
  const miles = Math.round(haversineMiles(a.lat, a.lng, b.lat, b.lng) * ROAD_FACTOR * 10) / 10;
  return { miles, min: driveMinutes(miles) };
}

/** The nearest crew members to a point, closest first. */
export function closestCrew(pt: LatLng, locs: { id: string; name: string; pt: LatLng; busy: boolean }[], n = 3) {
  return locs
    .map((l) => ({ ...l, ...etaBetween(l.pt, pt) }))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, n);
}
