/**
 * Agent API — the pure input rules (no database): what a work order and a
 * schedule request must look like, and the rows they turn into. Tested in
 * src/__tests__/agent-api.test.ts.
 */
import { parseSchedTime } from "../day-plan";

export const WORK_ORDER_SOURCES = ["appfolio", "angi", "buildium", "email"] as const;
export type WorkOrderSource = (typeof WORK_ORDER_SOURCES)[number];

/** Display name of a source, as the app shows it. */
export const SOURCE_LABEL: Record<WorkOrderSource, string> = {
  appfolio: "AppFolio", angi: "Angi", buildium: "Buildium", email: "Email",
};

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "");

export function cleanSource(v: unknown): WorkOrderSource | null {
  const s = str(v, 20).toLowerCase();
  return (WORK_ORDER_SOURCES as readonly string[]).includes(s) ? (s as WorkOrderSource) : null;
}

/** Photo links: https only, no quotes / spaces / angle brackets, ≤ 12. */
export function cleanPhotoLinks(v: unknown): string[] {
  const out: string[] = [];
  for (const p of Array.isArray(v) ? v : []) {
    if (typeof p !== "string" || p.length > 1000 || /["'<>\s]/.test(p)) continue;
    try {
      const u = new URL(p);
      if (u.protocol !== "https:") continue;
      if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname)) continue;
      if (!out.includes(u.toString())) out.push(u.toString());
    } catch { /* not a URL */ }
    if (out.length >= 12) break;
  }
  return out;
}

export interface WorkOrderInput {
  source: WorkOrderSource;
  externalId: string;
  description: string;
  name: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  photos: string[];
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

export function checkWorkOrder(a: Record<string, unknown>): Checked<WorkOrderInput> {
  const source = cleanSource(a.source);
  if (!source) return { ok: false, error: `source must be one of: ${WORK_ORDER_SOURCES.join(", ")}` };
  const externalId = str(a.external_id, 120);
  const description = str(a.description, 4000);
  const name = str(a.customer_name, 120);
  const phone = str(a.phone, 40);
  const email = str(a.email, 200);
  if (!description) return { ok: false, error: "description is required" };
  if (!name && !phone && !email) return { ok: false, error: "need customer_name, phone or email" };
  return {
    ok: true,
    value: {
      source, externalId, description, name, phone, email,
      street: str(a.street, 200), city: str(a.city, 100), state: str(a.state, 40), zip: str(a.zip, 20),
      photos: cleanPhotoLinks(a.photo_urls),
    },
  };
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export function isYmd(v: unknown): v is string {
  if (typeof v !== "string" || !YMD.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "9:00", "09:00", "9:00 am", "2:30pm" → "HH:MM" (24 h). "" = none / bad. */
export function cleanTime(v: unknown): string {
  const s = str(v, 12);
  if (!s) return "";
  const t = parseSchedTime(`🕐 ${s}`);
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return "";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

export interface ScheduleInput {
  jobId: string;
  dates: string[];
  time: string;
  crew: string[];
  note: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Most visit days one call may book. */
export const MAX_SCHEDULE_DAYS = 14;

/**
 * Days come as `dates` (a list) or `start_date` + `days` (consecutive).
 * `crew` are names of people on the team; `knownCrew` (the team's names)
 * decides which are real — an unknown name is an error, not a silent drop.
 */
export function checkSchedule(a: Record<string, unknown>, knownCrew: string[]): Checked<ScheduleInput> {
  if (!isUuid(a.job_id)) return { ok: false, error: "job_id must be a job id" };
  let dates: string[] = [];
  if (Array.isArray(a.dates) && a.dates.length) {
    if (!a.dates.every(isYmd)) return { ok: false, error: "dates must be YYYY-MM-DD" };
    dates = [...new Set(a.dates as string[])].sort();
  } else if (isYmd(a.start_date)) {
    const n = a.days == null ? 1 : Number(a.days);
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: "days must be a whole number ≥ 1" };
    dates = Array.from({ length: Math.min(n, MAX_SCHEDULE_DAYS + 1) }, (_, i) => addDaysYmd(a.start_date as string, i));
  } else {
    return { ok: false, error: "give start_date (YYYY-MM-DD) or dates" };
  }
  if (dates.length > MAX_SCHEDULE_DAYS) return { ok: false, error: `at most ${MAX_SCHEDULE_DAYS} days per call` };
  const time = a.time == null || a.time === "" ? "" : cleanTime(a.time);
  if (a.time != null && a.time !== "" && !time) return { ok: false, error: "time must look like 09:00 or 2:30 pm" };
  const byKey = new Map(knownCrew.map((n) => [n.trim().toLowerCase(), n]));
  const crew: string[] = [];
  for (const raw of Array.isArray(a.crew) ? a.crew : []) {
    const want = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    const hit = byKey.get(want);
    if (!hit) return { ok: false, error: `unknown crew member: ${String(raw).slice(0, 60)}` };
    if (!crew.includes(hit)) crew.push(hit);
  }
  return { ok: true, value: { jobId: a.job_id, dates, time, crew, note: str(a.note, 300).replace(/·/g, "-") } };
}

/** The schedule note the app reads back (🕐 time · 👷 crew · note). */
export function scheduleNote(s: { time: string; crew: string[]; note: string }): string {
  return [s.time ? `🕐 ${s.time}` : "", s.crew.length ? `👷 ${s.crew.join(", ")}` : "", s.note].filter(Boolean).join(" · ");
}

/** One schedule row per day, tied to the job by id. */
export function scheduleRows(s: ScheduleInput, property: string, orgId: string) {
  const note = scheduleNote(s);
  return s.dates.map((d) => ({ org_id: orgId, sched_date: d, job: property, job_id: s.jobId, note }));
}

/** Statuses a job can be scheduled from (never a finished / paid one). */
export const SCHEDULABLE = new Set(["lead", "quoted", "accepted", "scheduled", "active"]);
