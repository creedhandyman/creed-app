/**
 * Two-way Google Calendar sync: the PURE rules (tested in gcal-sync.test.ts).
 *
 *   Creed visit → Google event:  desiredEvent()  (one event per schedule row,
 *                                 id = eventIdFor(org, row) so it can't duplicate)
 *   Google event → Creed visit:  eventToVisit() + applyVisit()  (date / time /
 *                                 end day only; crew + free-text note are kept)
 *   Who wins:                     decidePull()  — loop guard + "latest edit wins"
 *
 * Loop guard: the mapping row remembers the etag Google gave our last write /
 * read (an incoming event with that etag is our own write coming back) and
 * the hash of the event Creed last rendered for the visit (the same hash now
 * = nothing changed in Creed, so nothing is pushed).
 */
import { createHash } from "crypto";
import { visitSnap } from "../schedule-notify";
import { composeNote, stripNoteParts } from "../dispatch-week";
import { parseSchedCrew, parseSchedTime, fmtClock } from "../day-plan";
import { visitHours } from "../calendar-feed";
import { zonedToUtc, utcToZoned } from "../tz";

export interface SyncRow {
  id: string | number;
  job?: string | null;
  job_id?: string | null;
  sched_date: string;
  end_date?: string | null;
  note?: string | null;
  booking_status?: string | null;
  updated_at?: string | null;
}
export interface SyncJob {
  id: string;
  client?: string | null;
  requested_tech?: string | null;
  total_hrs?: number | null;
  trade?: string | null;
  archived?: boolean | null;
  status?: string | null;
}
type EvTime = { date?: string; dateTime?: string; timeZone?: string };
export interface GEvent {
  id: string;
  etag?: string;
  status?: string; // confirmed | tentative | cancelled
  summary?: string;
  description?: string;
  location?: string;
  start?: EvTime;
  end?: EvTime;
  updated?: string;
  recurringEventId?: string;
  recurrence?: string[];
  transparency?: string;
  extendedProperties?: { private?: Record<string, string> };
}
export type EventBody = Omit<GEvent, "id" | "etag" | "updated" | "recurringEventId" | "recurrence"> & { id?: string };

/** Visit as Google shows it: time null = all day; end = last day (inclusive) when it spans days. */
export interface Visit { date: string; end: string | null; time: string | null }

const pad = (n: number) => String(n).padStart(2, "0");
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
const daySpan = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000) + 1;

/** Deterministic Google event id for a visit (base32hex alphabet: 0-9 a-v). */
export function eventIdFor(orgId: string, scheduleId: string | number): string {
  return "creed" + createHash("sha256").update(`${orgId}:${scheduleId}`).digest("hex").slice(0, 32);
}

/** Visits that never go to Google: a pending online-booking request, an archived job. */
export function excluded(row: SyncRow, job: SyncJob | undefined): boolean {
  return row.booking_status === "requested" || !!job?.archived;
}

/** The Google event Creed wants for this visit. */
export function desiredEvent(row: SyncRow, job: SyncJob | undefined, tz: string, appUrl: string): EventBody {
  const v = visitSnap(row, job?.requested_tech);
  const place = v.job || "Job";
  const crewTag = v.crew.length ? `${v.crew.map((c) => c.split(" ")[0]).join(", ")}: ` : "";
  const last = v.end || v.date;
  const multi = last > v.date;
  const free = stripNoteParts(row.note || "");
  const description = [
    v.crew.length ? `Crew: ${v.crew.join(", ")}` : "",
    job?.client ? `Client: ${job.client}` : "",
    job?.trade ? `Work: ${job.trade}` : "",
    free ? `Notes: ${free}` : "",
    `Open in Creed: ${appUrl}${row.job_id ? `/?job=${row.job_id}` : ""}`,
    "Move or delete this event and Creed follows. Edit the job itself in Creed.",
  ].filter(Boolean).join("\n");
  const timeTag = v.time && multi ? `${fmtClock(v.time)} · ` : "";
  const body: EventBody = {
    summary: `${timeTag}${crewTag}${place}${job?.client ? ` — ${job.client}` : ""}`,
    location: place,
    description,
    status: "confirmed",
    extendedProperties: { private: { creedScheduleId: String(row.id) } },
  };
  if (v.time && !multi) {
    const mins = Math.round(visitHours(job, v.crew.length, 1) * 60);
    const end = utcToZoned(zonedToUtc(v.date, v.time, tz).getTime() + mins * 60000, tz);
    body.start = { dateTime: `${v.date}T${v.time}:00`, timeZone: tz };
    body.end = { dateTime: `${end.date}T${end.time}:00`, timeZone: tz };
    body.transparency = "opaque";
  } else {
    body.start = { date: v.date };
    body.end = { date: addDays(last, 1) };
    body.transparency = "transparent";
  }
  return body;
}

/** Stable hash of what Creed renders (only the fields Creed owns). */
export function eventHash(b: EventBody): string {
  const pick = { s: b.summary, l: b.location, d: b.description, a: b.start, z: b.end, t: b.transparency };
  return createHash("sha256").update(JSON.stringify(pick)).digest("hex").slice(0, 24);
}

/** A Google event's date / time in the business's time zone. */
export function eventToVisit(ev: GEvent, tz: string): Visit | null {
  if (ev.start?.date) {
    const lastDay = ev.end?.date ? addDays(ev.end.date, -1) : ev.start.date;
    return { date: ev.start.date, end: lastDay > ev.start.date ? lastDay : null, time: null };
  }
  if (!ev.start?.dateTime) return null;
  const s = utcToZoned(ev.start.dateTime, tz);
  let end: string | null = null;
  if (ev.end?.dateTime) {
    const e = utcToZoned(ev.end.dateTime, tz);
    // Ending at midnight belongs to the day before.
    const lastDay = e.time === "00:00" ? addDays(e.date, -1) : e.date;
    if (lastDay > s.date) end = lastDay;
  }
  return { date: s.date, end, time: s.time };
}

/**
 * The schedule-row patch that makes `row` match `visit`, or null when it
 * already does. Crew and free text in the note are kept. An all-day span over
 * several days keeps the row's time: Creed shows a timed multi-day visit as an
 * all-day span, so moving that span must not wipe the time.
 */
export function applyVisit(row: SyncRow, visit: Visit): { sched_date: string; end_date: string | null; note: string } | null {
  const oldTime = parseSchedTime(row.note);
  const time = visit.time ?? (visit.end ? oldTime : "");
  const end = visit.end && visit.end > visit.date && daySpan(visit.date, visit.end) <= 60 ? visit.end : null;
  const note = time === oldTime ? (row.note || "") : composeNote(row.note, time, parseSchedCrew(row.note));
  const oldEnd = row.end_date && row.end_date > row.sched_date ? row.end_date : null;
  if (row.sched_date === visit.date && oldEnd === end && note === (row.note || "")) return null;
  return { sched_date: visit.date, end_date: end, note };
}

export type PullDecision = "echo" | "apply" | "creed";

/**
 * A linked event came back from Google.
 *   echo  — same etag we last saw: our own write (or nothing new). Do nothing.
 *   apply — Google changed it and Creed didn't, or Google's edit is newer.
 *   creed — both changed and Creed's edit is newer: Creed is pushed over it.
 */
export function decidePull(p: {
  mapEtag: string | null | undefined;
  eventEtag: string | null | undefined;
  creedChanged: boolean;
  eventUpdated: string | null | undefined;
  rowUpdated: string | null | undefined;
}): PullDecision {
  if (p.eventEtag && p.mapEtag && p.eventEtag === p.mapEtag) return "echo";
  if (!p.creedChanged) return "apply";
  const g = Date.parse(p.eventUpdated || "") || 0;
  const c = Date.parse(p.rowUpdated || "") || 0;
  return g > c ? "apply" : "creed";
}
