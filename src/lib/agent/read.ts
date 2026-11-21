/**
 * Agent API — pure rules for the read tools and update_job (no database):
 * date ranges, how a visit / job / quote / invoice is shown to an assistant,
 * why a day has no open times, and which status changes an assistant may
 * make. Tested in src/__tests__/agent-read.test.ts.
 */
import { visitSnap } from "../schedule-notify";
import { stripNoteParts } from "../dispatch-week";
import { parseSchedTime } from "../day-plan";
import { addDays, fmt12, openSlotsOnDay, toMin, weekdayOf, type BookingSettings, type BusyVisit, type LocalNow } from "../booking";
import { summaryLine } from "../job-summary";
import type { RoomsBlob } from "../job-blob";

export const JOB_STATUSES = ["lead", "quoted", "accepted", "scheduled", "active", "complete", "invoiced", "paid", "inspection"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const isYmd = (v: unknown): v is string => typeof v === "string" && YMD.test(v) && !isNaN(Date.parse(v + "T00:00:00Z"));

/** Named range or from/to → an inclusive [from, to], at most `maxDays` long. */
export function resolveRange(
  a: { range?: unknown; from?: unknown; to?: unknown },
  today: string,
  dflt: "today" | "next_7_days" = "today",
  maxDays = 62,
): { ok: true; from: string; to: string } | { ok: false; error: string } {
  if (a.from !== undefined || a.to !== undefined) {
    const from = a.from === undefined ? today : a.from;
    if (!isYmd(from)) return { ok: false, error: "from must be YYYY-MM-DD" };
    const to = a.to === undefined ? from : a.to;
    if (!isYmd(to)) return { ok: false, error: "to must be YYYY-MM-DD" };
    if (to < from) return { ok: false, error: "to is before from" };
    if (to > addDays(from, maxDays - 1)) return { ok: false, error: `at most ${maxDays} days at a time` };
    return { ok: true, from, to };
  }
  const r = typeof a.range === "string" ? a.range : dflt;
  const dow = weekdayOf(today);
  switch (r) {
    case "today": return { ok: true, from: today, to: today };
    case "tomorrow": return { ok: true, from: addDays(today, 1), to: addDays(today, 1) };
    case "this_week": return { ok: true, from: today, to: addDays(today, dow === 0 ? 0 : 7 - dow) }; // through Sunday
    case "next_week": { const mon = addDays(today, dow === 0 ? 1 : 8 - dow); return { ok: true, from: mon, to: addDays(mon, 6) }; }
    case "next_7_days": return { ok: true, from: today, to: addDays(today, 6) };
    case "next_30_days": return { ok: true, from: today, to: addDays(today, 29) };
    default: return { ok: false, error: "range must be today, tomorrow, this_week, next_week, next_7_days or next_30_days" };
  }
}

export interface SchedRowLike {
  id: string | number;
  job?: string | null;
  job_id?: string | null;
  sched_date: string;
  end_date?: string | null;
  note?: string | null;
  start_time?: string | null;
  booking_status?: string | null;
}
export interface JobLite {
  id: string;
  client?: string | null;
  property?: string | null;
  status?: string | null;
  requested_tech?: string | null;
  customer_id?: string | null;
  archived?: boolean | null;
}

/** Does the visit touch [from, to]? */
export const visitInRange = (r: SchedRowLike, from: string, to: string) => r.sched_date <= to && (r.end_date || r.sched_date) >= from;

/** One visit as the assistant sees it. */
export function visitOut(r: SchedRowLike, job?: JobLite) {
  const v = visitSnap(r, job?.requested_tech);
  const time = v.time || (r.start_time && Number.isFinite(toMin(r.start_time)) ? r.start_time.slice(0, 5) : "");
  return {
    schedule_id: String(r.id),
    date: r.sched_date,
    end_date: v.end,
    weekday: WEEKDAYS[weekdayOf(r.sched_date)],
    time: time || null,
    time_label: time ? fmt12(time) : "no set time (all day)",
    crew: v.crew,
    job_id: r.job_id || null,
    address: r.job || job?.property || "",
    customer: job?.client || "",
    job_status: job?.status || null,
    pending_booking_request: r.booking_status === "requested",
    note: stripNoteParts(r.note || "") || null,
  };
}
export type VisitOut = ReturnType<typeof visitOut>;

export const sortVisits = (a: VisitOut, b: VisitOut) =>
  a.date.localeCompare(b.date) || (a.time || "99").localeCompare(b.time || "99") || a.address.localeCompare(b.address);

/** A job's one-line title: the job summary, else trade / address. */
export function jobTitle(blob: RoomsBlob, job: { trade?: string | null; property?: string | null }): string {
  let s = "";
  try { s = summaryLine(blob); } catch { /* */ }
  return (s || job.trade || job.property || "Job").slice(0, 160);
}

/** Work-order checklist from the blob. */
export function checklistOf(blob: RoomsBlob): { area: string; task: string; done: boolean; completed_at: string | null }[] {
  const wo = Array.isArray(blob.workOrder) ? blob.workOrder : [];
  return wo
    .filter((w: unknown) => w && typeof w === "object")
    .map((w: { room?: unknown; detail?: unknown; action?: unknown; done?: unknown; completed_at?: unknown }) => ({
      area: typeof w.room === "string" ? w.room : "",
      task: String(w.detail || w.action || ""),
      done: w.done === true,
      completed_at: typeof w.completed_at === "string" ? w.completed_at : null,
    }));
}

export interface MoneyJob {
  status?: string | null;
  total?: number | null;
  amount_paid?: number | null;
  quote_sent_at?: string | null;
  quote_viewed_at?: string | null;
  quote_view_count?: number | null;
  approved_at?: string | null;
  client_signature?: string | null;
  invoice_sent_at?: string | null;
  paid_at?: string | null;
}
const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

/** Where the quote stands. */
export function quoteState(j: MoneyJob): "no_quote" | "not_sent" | "awaiting_approval" | "approved" {
  if (j.approved_at || j.client_signature) return "approved";
  if (j.status === "lead" || j.status === "inspection") return "no_quote";
  if (j.status === "quoted") return j.quote_sent_at ? "awaiting_approval" : "not_sent";
  return "approved"; // accepted and later: the work went ahead
}

/** Where the bill stands. */
export function invoiceState(j: MoneyJob): { state: "not_invoiced" | "unpaid" | "partly_paid" | "paid"; total: number; paid: number; balance: number } {
  const total = money(j.total), paid = money(j.amount_paid);
  if (j.status === "paid") return { state: "paid", total, paid: Math.max(paid, total), balance: 0 };
  if (j.status !== "invoiced") return { state: "not_invoiced", total, paid, balance: 0 };
  const balance = money(Math.max(0, total - paid));
  return { state: paid > 0 ? "partly_paid" : "unpaid", total, paid, balance };
}

/** "quoted" / ["quoted","lead"] → valid statuses (null = bad input; [] = any). */
export function cleanStatuses(v: unknown): JobStatus[] | null {
  if (v === undefined || v === null || v === "") return [];
  const arr = Array.isArray(v) ? v : [v];
  const out: JobStatus[] = [];
  for (const s of arr) {
    const k = typeof s === "string" ? s.trim().toLowerCase() : "";
    if (!(JOB_STATUSES as readonly string[]).includes(k)) return null;
    if (!out.includes(k as JobStatus)) out.push(k as JobStatus);
  }
  return out;
}

/** Customer search: name / email substring, or phone digits. */
export function customerHit(c: { name?: string | null; phone?: string | null; email?: string | null }, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 4 && (c.phone || "").replace(/\D/g, "").includes(digits.replace(/^1(?=\d{10}$)/, ""))) return true;
  return (c.name || "").toLowerCase().includes(s) || (c.email || "").toLowerCase().includes(s);
}

// ── update_job ─────────────────────────────────────────────────────────────

/** Statuses an assistant may set. Not "quoted" (can start automatic quote
 *  follow-ups), "invoiced" (automatic invoice reminders) or "paid" (that is a
 *  payment): those stay in Creed. */
export const AGENT_SETTABLE = ["accepted", "scheduled", "active", "complete"] as const;
/** A job in one of these is billed or done with billing: hands off. */
export const LOCKED = new Set(["invoiced", "paid"]);

export function checkStatusChange(from: string, to: unknown): { ok: true; to: string } | { ok: false; error: string } {
  const t = typeof to === "string" ? to.trim().toLowerCase() : "";
  if (!(AGENT_SETTABLE as readonly string[]).includes(t)) {
    return { ok: false, error: `status can be set to ${AGENT_SETTABLE.join(", ")}; quoted, invoiced and paid are set in Creed` };
  }
  if (LOCKED.has(from)) return { ok: false, error: `job is ${from}; billing statuses are changed in Creed` };
  return { ok: true, to: t };
}

/** Append a dated note to the job's notes (never replaces them). */
export function appendNote(existing: unknown, note: string, stamp: string): string {
  const prior = typeof existing === "string" ? existing.trimEnd() : "";
  const line = `[${stamp} · AI assistant] ${note}`;
  return (prior ? `${prior}\n${line}` : line).slice(-20000);
}

export function cleanNote(v: unknown): string {
  return typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, 2000) : "";
}

// ── get_open_slots: why a day has no open times ────────────────────────────

export interface LabeledVisit extends BusyVisit { label?: string }

export interface DayAnswer {
  date: string;
  weekday: string;
  slots: string[];
  /** Only on days with no open times. */
  why?: string;
  reason?: "closed" | "notice" | "all_day_visit" | "booked" | "too_short" | "past";
}

/**
 * Every day in [from, to]: its open times (the booking page's rules), and for
 * an empty day the reason — no working hours that weekday, inside the minimum
 * notice, blocked all day by a visit with no set time (or a multi-day one),
 * or booked full.
 */
export function explainDays(s: BookingSettings, visits: LabeledVisit[], now: LocalNow, from: string, to: string): DayAnswer[] {
  const out: DayAnswer[] = [];
  const noticeAt = now.minutes + s.minNoticeHours * 60;
  for (let d = from, i = 0; d <= to && i < 62; d = addDays(d, 1), i++) {
    const weekday = WEEKDAYS[weekdayOf(d)];
    const base = { date: d, weekday };
    const offset = Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(now.date + "T00:00:00Z")) / 86400000);
    if (offset < 0) { out.push({ ...base, slots: [], reason: "past", why: "in the past" }); continue; }
    const wins = s.hours[String(weekdayOf(d))] || [];
    if (!wins.length) { out.push({ ...base, slots: [], reason: "closed", why: `no working hours set for ${weekday}s` }); continue; }
    const earliest = noticeAt - offset * 1440;
    const lastWinEnd = Math.max(...wins.map((w) => toMin(w[1])));
    if (earliest + s.slotMin > lastWinEnd) {
      out.push({ ...base, slots: [], reason: "notice", why: `inside the ${s.minNoticeHours}-hour minimum notice for bookings` });
      continue;
    }
    const slots = openSlotsOnDay(d, s, visits, Math.max(0, earliest));
    if (slots.length) { out.push({ ...base, slots }); continue; }
    const onDay = visits.filter((v) => d >= v.date && d <= (v.endDate && v.endDate > v.date ? v.endDate : v.date));
    const allDay = onDay.filter((v) => !v.start || (v.endDate && v.endDate > v.date));
    if (allDay.length) {
      const names = allDay.map((v) => v.label).filter(Boolean).slice(0, 3).join("; ");
      out.push({ ...base, slots: [], reason: "all_day_visit",
        why: `blocked all day by ${allDay.length === 1 ? "a visit" : `${allDay.length} visits`} with no set start time or spanning several days${names ? ` (${names})` : ""}; give ${allDay.length === 1 ? "it" : "them"} a start time in Creed to free the rest of the day` });
      continue;
    }
    if (onDay.length) {
      out.push({ ...base, slots: [], reason: "booked", why: `fully booked: ${onDay.length} visit${onDay.length === 1 ? "" : "s"} plus ${s.bufferMin}-minute travel buffers fill the working hours` });
      continue;
    }
    out.push({ ...base, slots: [], reason: "too_short", why: `working hours that day are shorter than one ${s.slotMin}-minute appointment` });
  }
  return out;
}

/** One sentence for the whole range, so an assistant can answer "why nothing?". */
export function slotsHeadline(days: DayAnswer[], hoursSet: boolean): string {
  const open = days.filter((d) => d.slots.length);
  if (open.length) return `${open.reduce((n, d) => n + d.slots.length, 0)} open start times on ${open.length} of ${days.length} days.`;
  const count = (r: DayAnswer["reason"]) => days.filter((d) => d.reason === r).length;
  const parts = [
    count("closed") && `${count("closed")} closed (no working hours)`,
    count("notice") && `${count("notice")} inside the minimum notice`,
    count("all_day_visit") && `${count("all_day_visit")} blocked by all-day / untimed visits`,
    count("booked") && `${count("booked")} fully booked`,
    count("too_short") && `${count("too_short")} with hours too short for an appointment`,
    count("past") && `${count("past")} in the past`,
  ].filter(Boolean);
  return `No open times. Of ${days.length} days: ${parts.join(", ")}.${hoursSet ? "" : " Working hours were never set, so the default hours (Mon–Fri 9:30–12 and 1:30–6) were used; set them in Creed: Ops → Settings → Online booking."}`;
}
