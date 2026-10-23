/**
 * Schedule → crew notifications: who hears what when a visit is booked,
 * moved, or someone is taken off it. PURE (tested in schedule-notify.test.ts);
 * the client builds notices from the entry before/after its write and posts
 * them to /api/notify/schedule, which resolves names → profiles in the org,
 * skips the person who made the change, and writes the text from here.
 *
 * Crew on a visit = the note's 👷 list + the linked job's requested tech —
 * the same rule day-plan / Schedule's worker filter use.
 */
import { parseSchedCrew, parseSchedTime, fmtClock } from "./day-plan";

export interface VisitSnap {
  job: string;            // address shown on the schedule
  jobId?: string | null;
  date: string;           // YYYY-MM-DD
  end?: string | null;    // YYYY-MM-DD for multi-day
  time: string;           // "HH:MM" 24h or ""
  crew: string[];
}

export type NoticeKind = "scheduled" | "changed" | "removed";
export interface Notice { name: string; kind: NoticeKind; visit: VisitSnap; prev?: VisitSnap }

/** A schedule row (+ its job's requested tech) as a VisitSnap. */
export function visitSnap(
  e: { job?: string | null; job_id?: string | null; sched_date: string; end_date?: string | null; note?: string | null },
  requestedTech?: string | null,
): VisitSnap {
  const crew = parseSchedCrew(e.note);
  const rt = (requestedTech || "").trim();
  if (rt && !crew.some((c) => c.toLowerCase() === rt.toLowerCase())) crew.push(rt);
  return {
    job: e.job || "",
    jobId: e.job_id || null,
    date: e.sched_date,
    end: e.end_date && e.end_date > e.sched_date ? e.end_date : null,
    time: parseSchedTime(e.note),
    crew,
  };
}

const key = (s: string) => s.trim().toLowerCase();
const lastDay = (v: VisitSnap) => v.end || v.date;

/**
 * Notices for one visit write. prev = before (null for a new visit), next =
 * after (null when deleted). Visits entirely in the past (before `today`,
 * YYYY-MM-DD) are history — editing them tells nobody.
 */
export function scheduleNotices(prev: VisitSnap | null, next: VisitSnap | null, today: string): Notice[] {
  const live = (v: VisitSnap | null) => !!v && lastDay(v) >= today;
  if (!live(prev) && !live(next)) return [];
  const out: Notice[] = [];
  if (!prev || !live(prev)) {
    for (const name of next!.crew) out.push({ name, kind: "scheduled", visit: next! });
    return out;
  }
  if (!next) {
    for (const name of prev.crew) out.push({ name, kind: "removed", visit: prev });
    return out;
  }
  const before = new Set(prev.crew.map(key));
  const after = new Set(next.crew.map(key));
  const moved = prev.date !== next.date || (prev.end || "") !== (next.end || "") || prev.time !== next.time || prev.job !== next.job;
  for (const name of next.crew) {
    if (!before.has(key(name))) out.push({ name, kind: "scheduled", visit: next });
    else if (moved) out.push({ name, kind: "changed", visit: next, prev });
  }
  for (const name of prev.crew) if (!after.has(key(name))) out.push({ name, kind: "removed", visit: prev });
  return out;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-23" → "Fri, Oct 23" (parsed as a local day — no UTC slide). */
export function dayName(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  return `${DOW[dt.getDay()]}, ${MON[m - 1]} ${d}`;
}
/** "Fri, Oct 23 at 8:00 AM" / "Fri, Oct 23 – Mon, Oct 26" */
export function whenText(v: VisitSnap): string {
  const days = v.end ? `${dayName(v.date)} – ${dayName(v.end)}` : dayName(v.date);
  return v.time ? `${days} at ${fmtClock(v.time)}` : days;
}

export function noticeText(n: Notice): { title: string; body: string } {
  const place = n.visit.job || "a job";
  if (n.kind === "scheduled") return { title: "You're scheduled", body: `${place} · ${whenText(n.visit)}` };
  if (n.kind === "removed") return { title: "Taken off a visit", body: `${place} · ${whenText(n.visit)}` };
  const was = n.prev ? ` (was ${whenText(n.prev)})` : "";
  return { title: "Visit changed", body: `${place} · now ${whenText(n.visit)}${was}` };
}

/**
 * What ONE person receives for a batch of notices (Dispatch "Apply plan" can
 * touch a dozen visits): up to 2 notices go out one by one; more become a
 * single summary so a planned week is one alert, not twelve.
 */
export function messagesFor(notices: Notice[]): { title: string; body: string; jobId?: string | null }[] {
  if (notices.length <= 2) return notices.map((n) => ({ ...noticeText(n), jobId: n.visit.jobId }));
  const count = (k: NoticeKind) => notices.filter((n) => n.kind === k).length;
  const parts = [
    count("scheduled") ? `${count("scheduled")} new` : "",
    count("changed") ? `${count("changed")} changed` : "",
    count("removed") ? `${count("removed")} removed` : "",
  ].filter(Boolean).join(", ");
  const sorted = [...notices].filter((n) => n.kind !== "removed").sort((a, b) => a.visit.date.localeCompare(b.visit.date) || a.visit.time.localeCompare(b.visit.time));
  const list = sorted.slice(0, 4).map((n) => `${dayName(n.visit.date).split(",")[0]} ${n.visit.job}`).join("; ");
  return [{ title: "Your schedule was updated", body: `${notices.length} visits: ${parts}${list ? ` — ${list}${sorted.length > 4 ? "…" : ""}` : ""}` }];
}

/** Local YYYY-MM-DD. */
export function todayYmd(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
