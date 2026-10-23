/**
 * Schedule → iCalendar (.ics) for the phone-calendar subscribe link
 * (/api/calendar/feed/<token>.ics). PURE (tested in calendar-feed.test.ts).
 *
 * Times are FLOATING local times (no Z / TZID): "8:00 AM" in the app shows as
 * 8:00 AM on the phone, which is what a local crew wants. Untimed visits are
 * all-day events (a multi-day one spans its days); timed multi-day visits get
 * one event per day at that time.
 */
import { visitSnap } from "./schedule-notify";
import { stripNoteParts } from "./dispatch-week";

export interface FeedRow { id: string; job?: string | null; job_id?: string | null; sched_date: string; end_date?: string | null; note?: string | null }
export interface FeedJob { id: string; client?: string | null; requested_tech?: string | null; total_hrs?: number | null; trade?: string | null; archived?: boolean | null }

const pad = (n: number) => String(n).padStart(2, "0");
const dateOnly = (ymd: string) => ymd.replace(/-/g, "");
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
function daysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = a; d <= b && out.length < 60; d = addDays(d, 1)) out.push(d);
  return out;
}

/** RFC 5545 text escaping. */
export const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Fold lines longer than 75 octets (continuation lines start with a space). */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "", curLen = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (curLen + n > (parts.length ? 74 : 75)) { parts.push(cur); cur = ""; curLen = 0; }
    cur += ch; curLen += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

/** Visit length on one day: the job's hours ÷ crew ÷ days, 1–10 h; 2 h when unknown. */
export function visitHours(job: FeedJob | undefined, crewSize: number, days: number): number {
  const total = Number(job?.total_hrs) || 0;
  if (total <= 0) return 2;
  const h = total / Math.max(1, crewSize) / Math.max(1, days);
  return Math.min(10, Math.max(1, Math.round(h * 4) / 4));
}

export interface FeedOptions {
  name: string;            // calendar name shown in the phone
  /** Only visits this person is on (crew list / requested tech); null = everyone. */
  forName: string | null;
  appUrl: string;
  now?: Date;
}

export function buildCalendar(rows: FeedRow[], jobs: FeedJob[], opts: FeedOptions): string {
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const now = opts.now || new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const me = opts.forName?.trim().toLowerCase() || null;
  const lines: string[] = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Creed//Schedule//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(opts.name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
  ];
  for (const row of rows) {
    const job = row.job_id ? jobById.get(row.job_id) : undefined;
    if (job?.archived) continue;
    const v = visitSnap(row, job?.requested_tech);
    if (me && !v.crew.some((c) => c.toLowerCase() === me)) continue;
    const place = v.job || "Job";
    const summary = opts.forName
      ? (job?.client ? `${place} — ${job.client}` : place)
      : `${v.crew.length ? `${v.crew.map((c) => c.split(" ")[0]).join(", ")}: ` : ""}${place}`;
    const free = stripNoteParts(row.note || "");
    const desc = [
      v.crew.length ? `Crew: ${v.crew.join(", ")}` : "",
      job?.client ? `Client: ${job.client}` : "",
      job?.trade ? `Work: ${job.trade}` : "",
      free ? `Notes: ${free}` : "",
      `Open in Creed: ${opts.appUrl}`,
    ].filter(Boolean).join("\n");
    const common = [
      `SUMMARY:${icsText(summary)}`,
      `LOCATION:${icsText(place)}`,
      `DESCRIPTION:${icsText(desc)}`,
      `DTSTAMP:${stamp}`,
    ];
    const days = daysBetween(v.date, v.end || v.date);
    if (!v.time) {
      lines.push("BEGIN:VEVENT", `UID:${row.id}@creedhm.com`,
        `DTSTART;VALUE=DATE:${dateOnly(v.date)}`, `DTEND;VALUE=DATE:${dateOnly(addDays(days[days.length - 1], 1))}`,
        ...common, "TRANSP:TRANSPARENT", "END:VEVENT");
      continue;
    }
    const [h, m] = v.time.split(":").map(Number);
    const mins = Math.round(visitHours(job, v.crew.length, days.length) * 60);
    for (const d of days) {
      const start = new Date(Date.UTC(2000, 0, 1, h, m + mins));
      const endDay = addDays(d, start.getUTCDate() - 1);
      lines.push("BEGIN:VEVENT", `UID:${row.id}-${dateOnly(d)}@creedhm.com`,
        `DTSTART:${dateOnly(d)}T${pad(h)}${pad(m)}00`,
        `DTEND:${dateOnly(endDay)}T${pad(start.getUTCHours())}${pad(start.getUTCMinutes())}00`,
        ...common, "END:VEVENT");
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
