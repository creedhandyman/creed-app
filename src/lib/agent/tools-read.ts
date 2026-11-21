/**
 * Agent API — the read tools (jobs, schedule, customers, quotes, invoices,
 * business summary) and update_job. Same runner as the rest (server.ts
 * runTool: key → scope → rate limit → activity log). Everything is scoped to
 * the key's business. Nothing here contacts customers, takes payments or
 * deletes; update_job only changes a status (not to quoted / invoiced / paid)
 * and appends a note.
 */
import type { AgentCtx, ToolResult } from "./server";
import { tryReadBlob, type RoomsBlob } from "../job-blob";
import { readTierRooms, readTierNames } from "../quote-blob";
import { siteOrigin } from "../site-url";
import { localNow, readBookingSettings, addDays } from "../booking";
import { isUuid } from "./plan";
import {
  appendNote, checkStatusChange, checklistOf, cleanNote, cleanStatuses, customerHit, invoiceState, jobTitle,
  quoteState, resolveRange, sortVisits, visitInRange, visitOut, type JobLite, type SchedRowLike, type VisitOut,
} from "./read";

type Out = { result: ToolResult; summary: string; jobId?: string | null };
type Handler = (ctx: AgentCtx, a: Record<string, unknown>) => Promise<Out>;
const fail = (status: number, error: string): Out => ({ result: { ok: false, status, error }, summary: "" });
const okOut = (data: Record<string, unknown>, summary: string, jobId?: string | null): Out => ({ result: { ok: true, data }, summary, jobId });
const intIn = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const appLink = (jobId: string) => `${siteOrigin()}/?job=${jobId}`;
const chunks = <T,>(a: T[], n = 150) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

const JOB_LIGHT = "id, property, client, customer_id, status, job_date, created_at, total, amount_paid, archived, requested_tech, trade, quote_sent_at, quote_viewed_at, quote_view_count, approved_at, client_signature, paid_at";
type JobRow = JobLite & {
  job_date?: string | null; created_at?: string | null; total?: number | null; amount_paid?: number | null; trade?: string | null;
  quote_sent_at?: string | null; quote_viewed_at?: string | null; quote_view_count?: number | null; approved_at?: string | null;
  client_signature?: string | null; paid_at?: string | null; rooms?: string | null; invoice_sent_at?: string | null;
};

/** The business's "today" + time zone. */
async function orgClock(ctx: AgentCtx): Promise<{ tz: string; today: string }> {
  const { data } = await ctx.supabase.from("organizations").select("booking_tz").eq("id", ctx.orgId).maybeSingle();
  const tz = readBookingSettings((data || {}) as Record<string, unknown>).tz;
  return { tz, today: localNow(new Date(), tz).date };
}

async function rowsInRange(ctx: AgentCtx, from: string, to: string): Promise<SchedRowLike[]> {
  const { data, error } = await ctx.supabase.from("schedule")
    .select("id, job, job_id, sched_date, end_date, note, start_time, booking_status")
    .eq("org_id", ctx.orgId).gte("sched_date", addDays(from, -60)).lte("sched_date", to).limit(3000);
  if (error) throw new Error(error.message);
  return ((data || []) as SchedRowLike[]).filter((r) => visitInRange(r, from, to));
}

async function jobsByIds(ctx: AgentCtx, ids: string[], cols = JOB_LIGHT): Promise<JobRow[]> {
  const out: JobRow[] = [];
  for (const part of chunks([...new Set(ids)].filter(Boolean))) {
    const { data, error } = await ctx.supabase.from("jobs").select(cols).eq("org_id", ctx.orgId).in("id", part);
    if (error) throw new Error(error.message);
    out.push(...((data || []) as unknown as JobRow[]));
  }
  return out;
}

/** Titles need the blob; fetched only for the jobs being returned. */
async function titlesFor(ctx: AgentCtx, jobs: JobRow[]): Promise<Map<string, string>> {
  const rows = await jobsByIds(ctx, jobs.map((j) => j.id), "id, rooms, trade, property");
  return new Map(rows.map((r) => [r.id, jobTitle(tryReadBlob(r.rooms) || {}, r)]));
}

async function visitsForJobs(ctx: AgentCtx, jobIds: string[], from?: string): Promise<Map<string, SchedRowLike[]>> {
  const out = new Map<string, SchedRowLike[]>();
  for (const part of chunks([...new Set(jobIds)])) {
    let q = ctx.supabase.from("schedule").select("id, job, job_id, sched_date, end_date, note, start_time, booking_status")
      .eq("org_id", ctx.orgId).in("job_id", part);
    if (from) q = q.gte("sched_date", addDays(from, -60));
    const { data, error } = await q.limit(3000);
    if (error) throw new Error(error.message);
    for (const r of (data || []) as SchedRowLike[]) if (r.job_id) out.set(r.job_id, [...(out.get(r.job_id) || []), r]);
  }
  return out;
}

function jobCard(j: JobRow, title: string, visits: VisitOut[]) {
  const crew = [...new Set(visits.flatMap((v) => v.crew))];
  return {
    job_id: j.id, title, customer: j.client || "", customer_id: j.customer_id || null, address: j.property || "",
    status: j.status, archived: !!j.archived, total: Math.round((Number(j.total) || 0) * 100) / 100,
    job_date: j.job_date || null, visits: visits.map(({ schedule_id, date, end_date, time, time_label, crew: c }) => ({ schedule_id, date, end_date, time, time_label, crew: c })),
    crew, link: appLink(j.id),
  };
}

// ── list_jobs ──────────────────────────────────────────────────────────────
const listJobs: Handler = async (ctx, a) => {
  const statuses = cleanStatuses(a.status);
  if (!statuses) return fail(400, "status must be one or more of: lead, quoted, accepted, scheduled, active, complete, invoiced, paid, inspection");
  const limit = intIn(a.limit, 1, 100, 25);
  const custText = str(a.customer, 120);
  const custId = a.customer_id;
  if (custId !== undefined && !isUuid(custId)) return fail(400, "customer_id must be a customer id");
  const dated = a.from !== undefined || a.to !== undefined || a.range !== undefined;
  let from = "", to = "";
  if (dated) {
    const { today } = await orgClock(ctx);
    const r = resolveRange(a, today, "next_7_days", 366);
    if (!r.ok) return fail(400, r.error);
    ({ from, to } = r);
  }
  const sb = ctx.supabase;
  let q = sb.from("jobs").select(JOB_LIGHT).eq("org_id", ctx.orgId);
  if (statuses.length) q = q.in("status", statuses);
  if (a.include_archived !== true) q = q.not("archived", "is", true);
  if (custId) q = q.eq("customer_id", custId as string);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(2000);
  if (error) return fail(500, error.message);
  let jobs = (data || []) as unknown as JobRow[];

  if (custText) {
    const { data: cs } = await sb.from("customers").select("id, name, phone, email").eq("org_id", ctx.orgId).limit(10000);
    const ids = new Set(((cs || []) as { id: string; name?: string; phone?: string; email?: string }[]).filter((c) => customerHit(c, custText)).map((c) => c.id));
    jobs = jobs.filter((j) => (j.customer_id && ids.has(j.customer_id)) || customerHit({ name: j.client }, custText));
  }
  let visitMap: Map<string, SchedRowLike[]>;
  if (dated) {
    const rows = await rowsInRange(ctx, from, to);
    visitMap = new Map();
    for (const r of rows) if (r.job_id) visitMap.set(r.job_id, [...(visitMap.get(r.job_id) || []), r]);
    jobs = jobs.filter((j) => visitMap.has(j.id) || (j.job_date && j.job_date >= from && j.job_date <= to));
    const first = (j: JobRow) => (visitMap.get(j.id) || []).map((r) => r.sched_date).sort()[0] || j.job_date || "";
    jobs.sort((x, y) => first(x).localeCompare(first(y)));
  }
  const total = jobs.length;
  const page = jobs.slice(0, limit);
  if (!dated) visitMap = await visitsForJobs(ctx, page.map((j) => j.id));
  const titles = await titlesFor(ctx, page);
  const out = page.map((j) => jobCard(j, titles.get(j.id) || j.property || "", (visitMap.get(j.id) || []).map((r) => visitOut(r, j)).sort(sortVisits)));
  return okOut({
    ...(dated ? { from, to } : {}), count: out.length, total_matches: total, more: total > out.length, jobs: out,
    ...(dated ? { note: "A job matches the dates when one of its visits falls in the range, or (no visit) its job date does." } : {}),
  }, `${out.length} of ${total} jobs`);
};

// ── get_job ────────────────────────────────────────────────────────────────
const getJob: Handler = async (ctx, a) => {
  if (!isUuid(a.job_id)) return fail(400, "job_id must be a job id (from list_jobs / list_schedule)");
  const { data } = await ctx.supabase.from("jobs").select(`${JOB_LIGHT}, rooms, invoice_sent_at`).eq("org_id", ctx.orgId).eq("id", a.job_id).maybeSingle();
  if (!data) return fail(404, "no such job in this business");
  const j = data as unknown as JobRow;
  const blob: RoomsBlob = tryReadBlob(j.rooms) || {};
  const visits = ((await visitsForJobs(ctx, [j.id])).get(j.id) || []).map((r) => visitOut(r, j)).sort(sortVisits);
  let customer: Record<string, unknown> | null = null;
  if (j.customer_id) {
    const { data: c } = await ctx.supabase.from("customers").select("id, name, phone, email").eq("org_id", ctx.orgId).eq("id", j.customer_id).maybeSingle();
    if (c) customer = { customer_id: c.id, name: c.name || "", phone: c.phone || "", email: c.email || "" };
  }
  const checklist = checklistOf(blob);
  const photos = (Array.isArray(blob.photos) ? blob.photos.length : 0) + (Array.isArray(blob.leadPhotos) ? blob.leadPhotos.length : 0);
  const showMoney = ctx.scopes.includes("billing:read");
  const card = jobCard(j, jobTitle(blob, j), visits);
  return okOut({
    ...card,
    summary: typeof blob.summaryEdit?.long === "string" && blob.summaryEdit.long ? blob.summaryEdit.long : card.title,
    request: typeof blob.leadDescription === "string" ? blob.leadDescription.slice(0, 2000) : null,
    customer,
    trade: j.trade || null,
    created_at: j.created_at || null,
    visits,
    checklist,
    checklist_done: `${checklist.filter((c) => c.done).length} of ${checklist.length}`,
    notes: typeof blob.jobNotes === "string" && blob.jobNotes ? blob.jobNotes.slice(-4000) : null,
    photo_count: photos,
    quote: { state: quoteState(j), total: card.total, sent_at: j.quote_sent_at || null, viewed_at: j.quote_viewed_at || null, view_count: j.quote_view_count || 0, approved_at: j.approved_at || null, signed: !!j.client_signature },
    invoice: showMoney ? { ...invoiceState(j), invoice_sent_at: j.invoice_sent_at || null, paid_at: j.paid_at || null } : { state: invoiceState(j).state },
  }, `job ${j.status}`, j.id);
};

// ── list_schedule ──────────────────────────────────────────────────────────
const listSchedule: Handler = async (ctx, a) => {
  const { today, tz } = await orgClock(ctx);
  const r = resolveRange(a, today, "today", 62);
  if (!r.ok) return fail(400, r.error);
  const crewWant = str(a.crew, 80).toLowerCase();
  const rows = await rowsInRange(ctx, r.from, r.to);
  const jobs = new Map((await jobsByIds(ctx, rows.map((x) => x.job_id || ""))).map((j) => [j.id, j]));
  let visits = rows
    .filter((x) => !(x.job_id && jobs.get(x.job_id)?.archived))
    .map((x) => visitOut(x, x.job_id ? jobs.get(x.job_id) : undefined))
    .sort(sortVisits);
  if (crewWant) visits = visits.filter((v) => v.crew.some((c) => c.toLowerCase().includes(crewWant)));
  const days: Record<string, number> = {};
  for (const v of visits) days[v.date] = (days[v.date] || 0) + 1;
  return okOut({
    timezone: tz, today, from: r.from, to: r.to, count: visits.length, visits_per_start_day: days,
    ...(visits.length ? {} : { note: "Nothing on the schedule in this range." }),
    visits,
  }, `${visits.length} visits ${r.from}..${r.to}`);
};

// ── list_customers / get_customer ─────────────────────────────────────────
const listCustomers: Handler = async (ctx, a) => {
  const q = str(a.query, 120);
  const limit = intIn(a.limit, 1, 100, 25);
  const offset = intIn(a.offset, 0, 100000, 0);
  const { data, error } = await ctx.supabase.from("customers").select("id, name, phone, email, created_at").eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false }).limit(10000);
  if (error) return fail(500, error.message);
  const all = ((data || []) as { id: string; name?: string; phone?: string; email?: string; created_at?: string }[]).filter((c) => customerHit(c, q));
  const page = all.slice(offset, offset + limit);
  const stats = new Map<string, { n: number; last: string }>();
  for (const part of chunks(page.map((c) => c.id))) {
    const { data: js } = await ctx.supabase.from("jobs").select("customer_id, job_date, created_at").eq("org_id", ctx.orgId).in("customer_id", part).limit(5000);
    for (const j of (js || []) as { customer_id: string; job_date?: string; created_at?: string }[]) {
      const s = stats.get(j.customer_id) || { n: 0, last: "" };
      const d = j.job_date || (j.created_at || "").slice(0, 10);
      stats.set(j.customer_id, { n: s.n + 1, last: d > s.last ? d : s.last });
    }
  }
  return okOut({
    count: page.length, total_matches: all.length, more: offset + page.length < all.length, next_offset: offset + page.length < all.length ? offset + page.length : null,
    customers: page.map((c) => ({ customer_id: c.id, name: c.name || "", phone: c.phone || "", email: c.email || "", job_count: stats.get(c.id)?.n || 0, last_job_date: stats.get(c.id)?.last || null })),
  }, `${page.length} of ${all.length} customers`);
};

const getCustomer: Handler = async (ctx, a) => {
  if (!isUuid(a.customer_id)) return fail(400, "customer_id must be a customer id (from list_customers / find_customer)");
  const sb = ctx.supabase;
  const { data: c } = await sb.from("customers").select("id, name, phone, email, created_at").eq("org_id", ctx.orgId).eq("id", a.customer_id).maybeSingle();
  if (!c) return fail(404, "no such customer in this business");
  const { data: ad } = await sb.from("addresses").select("street, city, state, zip").eq("org_id", ctx.orgId).eq("customer_id", c.id).limit(50);
  const { data: js } = await sb.from("jobs").select(JOB_LIGHT).eq("org_id", ctx.orgId).eq("customer_id", c.id).order("created_at", { ascending: false }).limit(100);
  const jobs = (js || []) as unknown as JobRow[];
  const titles = await titlesFor(ctx, jobs.slice(0, 50));
  const showMoney = ctx.scopes.includes("billing:read");
  const billed = jobs.filter((j) => j.status === "invoiced" || j.status === "paid");
  return okOut({
    customer_id: c.id, name: c.name || "", phone: c.phone || "", email: c.email || "", customer_since: (c.created_at || "").slice(0, 10) || null,
    addresses: ((ad || []) as { street?: string; city?: string; state?: string; zip?: string }[]).map((r) => [r.street, r.city, r.state, r.zip].filter(Boolean).join(", ")).filter(Boolean),
    job_count: jobs.length,
    jobs: jobs.slice(0, 50).map((j) => ({
      job_id: j.id, title: titles.get(j.id) || j.property || "", address: j.property || "", status: j.status, archived: !!j.archived,
      date: j.job_date || (j.created_at || "").slice(0, 10), total: Math.round((Number(j.total) || 0) * 100) / 100,
    })),
    ...(showMoney ? {
      lifetime_billed: Math.round(billed.reduce((n, j) => n + (Number(j.total) || 0), 0) * 100) / 100,
      unpaid_balance: Math.round(jobs.reduce((n, j) => n + invoiceState(j).balance, 0) * 100) / 100,
    } : {}),
  }, `customer, ${jobs.length} jobs`);
};

// ── list_quotes / get_quote / list_invoices ────────────────────────────────
const QUOTE_FILTERS = ["awaiting_approval", "not_sent", "approved", "all"] as const;
const listQuotes: Handler = async (ctx, a) => {
  const state = typeof a.state === "string" ? a.state : "awaiting_approval";
  if (!(QUOTE_FILTERS as readonly string[]).includes(state)) return fail(400, `state must be one of: ${QUOTE_FILTERS.join(", ")}`);
  const limit = intIn(a.limit, 1, 100, 25);
  let q = ctx.supabase.from("jobs").select(JOB_LIGHT).eq("org_id", ctx.orgId).not("archived", "is", true);
  if (state === "awaiting_approval" || state === "not_sent") q = q.eq("status", "quoted");
  else q = q.in("status", ["quoted", "accepted", "scheduled", "active", "complete", "invoiced", "paid"]);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(2000);
  if (error) return fail(500, error.message);
  const rows = ((data || []) as unknown as JobRow[]).filter((j) => state === "all" || quoteState(j) === state);
  const page = rows.slice(0, limit);
  const titles = await titlesFor(ctx, page);
  return okOut({
    state, count: page.length, total_matches: rows.length,
    total_value: Math.round(rows.reduce((n, j) => n + (Number(j.total) || 0), 0) * 100) / 100,
    quotes: page.map((j) => ({
      job_id: j.id, title: titles.get(j.id) || "", customer: j.client || "", address: j.property || "", state: quoteState(j),
      job_status: j.status, total: Math.round((Number(j.total) || 0) * 100) / 100, sent_at: j.quote_sent_at || null,
      viewed_at: j.quote_viewed_at || null, view_count: j.quote_view_count || 0, approved_at: j.approved_at || null, link: appLink(j.id),
    })),
  }, `${page.length} quotes (${state})`);
};

const getQuote: Handler = async (ctx, a) => {
  if (!isUuid(a.job_id)) return fail(400, "job_id must be a job id");
  const { data } = await ctx.supabase.from("jobs").select(`${JOB_LIGHT}, rooms, total_labor, total_mat, total_hrs`).eq("org_id", ctx.orgId).eq("id", a.job_id).maybeSingle();
  if (!data) return fail(404, "no such job in this business");
  const j = data as unknown as JobRow & { total_labor?: number; total_mat?: number; total_hrs?: number };
  const blob: RoomsBlob = tryReadBlob(j.rooms) || {};
  type It = { detail?: string; comment?: string; laborHrs?: number; materials?: { n?: string; qty?: number }[]; tiers?: string[] };
  const rooms = readTierRooms<{ name?: string; items?: It[] }>(blob);
  const lines = rooms.flatMap((r) => (Array.isArray(r.items) ? r.items : []).map((it) => ({
    area: r.name || "", detail: it.detail || "", hours: Number(it.laborHrs) || 0,
    materials: (Array.isArray(it.materials) ? it.materials : []).map((m) => ({ name: m.n || "", qty: m.qty || 1 })).filter((m) => m.name),
    ...(blob.tieredQuote === true ? { options: Array.isArray(it.tiers) && it.tiers.length ? it.tiers : ["all"] } : {}),
  })));
  const names = readTierNames(blob.tierNames);
  if (!lines.length && quoteState(j) === "no_quote") return fail(409, "this job has no quote yet (a lead can be drafted with draft_quote)");
  return okOut({
    job_id: j.id, title: jobTitle(blob, j), customer: j.client || "", address: j.property || "", state: quoteState(j), job_status: j.status,
    total: Math.round((Number(j.total) || 0) * 100) / 100, labor: Math.round((Number(j.total_labor) || 0) * 100) / 100,
    materials_total: Math.round((Number(j.total_mat) || 0) * 100) / 100, hours: Number(j.total_hrs) || 0,
    tiered: blob.tieredQuote === true, ...(blob.tieredQuote === true ? { option_names: { base: "Good", better: names.better, best: names.best } } : {}),
    sent_at: j.quote_sent_at || null, viewed_at: j.quote_viewed_at || null, approved_at: j.approved_at || null, signed: !!j.client_signature,
    lines: lines.slice(0, 60), more_lines: Math.max(0, lines.length - 60), link: appLink(j.id),
    note: "Totals are the saved quote's. Edit or send it in Creed.",
  }, `quote ${quoteState(j)}`, j.id);
};

const listInvoices: Handler = async (ctx, a) => {
  const state = typeof a.state === "string" ? a.state : "unpaid";
  if (!["unpaid", "paid", "all"].includes(state)) return fail(400, "state must be unpaid, paid or all");
  const limit = intIn(a.limit, 1, 100, 25);
  const statuses = state === "unpaid" ? ["invoiced"] : state === "paid" ? ["paid"] : ["invoiced", "paid"];
  const { data, error } = await ctx.supabase.from("jobs").select(`${JOB_LIGHT}, invoice_sent_at`).eq("org_id", ctx.orgId)
    .in("status", statuses).not("archived", "is", true).order("created_at", { ascending: false }).limit(2000);
  if (error) return fail(500, error.message);
  const rows = (data || []) as unknown as JobRow[];
  const unpaid = rows.filter((j) => j.status === "invoiced");
  const page = rows.slice(0, limit);
  const titles = await titlesFor(ctx, page);
  return okOut({
    state, count: page.length, total_matches: rows.length,
    unpaid_count: unpaid.length,
    unpaid_total: Math.round(unpaid.reduce((n, j) => n + invoiceState(j).balance, 0) * 100) / 100,
    invoices: page.map((j) => ({
      job_id: j.id, title: titles.get(j.id) || "", customer: j.client || "", address: j.property || "", ...invoiceState(j),
      invoice_sent_at: j.invoice_sent_at || null, paid_at: j.paid_at || null, link: appLink(j.id),
    })),
  }, `${page.length} invoices (${state})`);
};

// ── update_job ─────────────────────────────────────────────────────────────
const updateJob: Handler = async (ctx, a) => {
  if (!isUuid(a.job_id)) return fail(400, "job_id must be a job id");
  const note = cleanNote(a.note);
  if (a.status === undefined && !note) return fail(400, "give a status and/or a note");
  const sb = ctx.supabase;
  const { data: job } = await sb.from("jobs").select("id, status, archived, rooms").eq("org_id", ctx.orgId).eq("id", a.job_id).maybeSingle();
  if (!job) return fail(404, "no such job in this business");
  if (job.archived) return fail(409, "job is archived; restore it in Creed first");
  let status = job.status as string;
  const did: string[] = [];
  if (a.status !== undefined) {
    const c = checkStatusChange(status, a.status);
    if (!c.ok) return fail(409, c.error);
    if (c.to !== status) {
      // Only if nobody changed it in the meantime.
      const { data: upd, error } = await sb.from("jobs").update({ status: c.to }).eq("org_id", ctx.orgId).eq("id", job.id).eq("status", status).select("id");
      if (error) return fail(500, error.message);
      if (!upd?.length) return fail(409, "the job's status just changed in Creed; read it again with get_job");
      did.push(`${status} → ${c.to}`);
      status = c.to;
    }
  }
  if (note) {
    // Re-read the blob right before writing so a note never overwrites an edit made in between.
    const { data: fresh } = await sb.from("jobs").select("rooms").eq("org_id", ctx.orgId).eq("id", job.id).maybeSingle();
    const blob: RoomsBlob = tryReadBlob(fresh?.rooms) || {};
    const { tz } = await orgClock(ctx);
    const stamp = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date());
    const next = { ...blob, jobNotes: appendNote(blob.jobNotes, note, stamp) };
    const { error } = await sb.from("jobs").update({ rooms: JSON.stringify(next) }).eq("org_id", ctx.orgId).eq("id", job.id);
    if (error) return fail(500, error.message);
    did.push("note added");
  }
  return okOut({ job_id: job.id, status, changed: did, link: appLink(job.id) }, did.join(", ") || "no change", job.id);
};

// ── business_summary ───────────────────────────────────────────────────────
const businessSummary: Handler = async (ctx) => {
  const { today, tz } = await orgClock(ctx);
  const week = resolveRange({ range: "this_week" }, today) as { ok: true; from: string; to: string };
  const rows = await rowsInRange(ctx, today, week.to);
  const { data, error } = await ctx.supabase.from("jobs").select(JOB_LIGHT).eq("org_id", ctx.orgId).not("archived", "is", true)
    .in("status", ["lead", "quoted", "accepted", "scheduled", "active", "complete", "invoiced"]).limit(5000);
  if (error) return fail(500, error.message);
  const open = (data || []) as unknown as JobRow[];
  const byId = new Map(open.map((j) => [j.id, j]));
  const missing = rows.map((r) => r.job_id || "").filter((id) => id && !byId.has(id));
  for (const j of await jobsByIds(ctx, missing)) byId.set(j.id, j);
  const visits = rows.filter((r) => !(r.job_id && byId.get(r.job_id)?.archived)).map((r) => visitOut(r, r.job_id ? byId.get(r.job_id) : undefined)).sort(sortVisits);
  const todayV = visits.filter((v) => v.date <= today && (v.end_date || v.date) >= today);
  const pick = (f: (j: JobRow) => boolean) => open.filter(f);
  const leads = pick((j) => j.status === "lead");
  const awaiting = pick((j) => quoteState(j) === "awaiting_approval");
  const notSent = pick((j) => quoteState(j) === "not_sent");
  const accepted = pick((j) => j.status === "accepted");
  const onCal = await visitsForJobs(ctx, accepted.map((j) => j.id));
  const ready = accepted.filter((j) => !onCal.has(j.id));
  const toInvoice = pick((j) => j.status === "complete");
  const unpaid = pick((j) => j.status === "invoiced");
  const brief = (j: JobRow) => ({ job_id: j.id, customer: j.client || "", address: j.property || "", total: Math.round((Number(j.total) || 0) * 100) / 100 });
  const showMoney = ctx.scopes.includes("billing:read");
  const sum = (js: JobRow[]) => Math.round(js.reduce((n, j) => n + (Number(j.total) || 0), 0) * 100) / 100;
  return okOut({
    timezone: tz, today, week_through: week.to,
    today_visits: todayV,
    this_week: { visit_count: visits.length, visits: visits.slice(0, 40) },
    open_leads: { count: leads.length, newest: leads.slice(0, 10).map(brief) },
    quotes_awaiting_approval: { count: awaiting.length, ...(showMoney ? { total_value: sum(awaiting) } : {}), list: awaiting.slice(0, 10).map(brief) },
    quotes_not_sent: { count: notSent.length, list: notSent.slice(0, 10).map(brief) },
    approved_not_scheduled: { count: ready.length, list: ready.slice(0, 10).map(brief) },
    complete_not_invoiced: { count: toInvoice.length, list: toInvoice.slice(0, 10).map(brief) },
    unpaid_invoices: showMoney
      ? { count: unpaid.length, total_due: Math.round(unpaid.reduce((n, j) => n + invoiceState(j).balance, 0) * 100) / 100, list: unpaid.slice(0, 10).map((j) => ({ ...brief(j), balance: invoiceState(j).balance })) }
      : { count: unpaid.length, note: "Amounts need the billing:read permission." },
  }, `${todayV.length} today, ${visits.length} this week`);
};

export const READ_HANDLERS: Record<string, Handler> = {
  list_jobs: listJobs,
  get_job: getJob,
  list_schedule: listSchedule,
  list_customers: listCustomers,
  get_customer: getCustomer,
  list_quotes: listQuotes,
  get_quote: getQuote,
  list_invoices: listInvoices,
  update_job: updateJob,
  business_summary: businessSummary,
};

