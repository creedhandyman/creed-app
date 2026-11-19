/**
 * Agent API — the server side shared by the REST routes (/api/agent/v1/<tool>)
 * and the MCP endpoint (/api/mcp). One key check, one scope check, one rate
 * limit, one activity log, five tools. The business ALWAYS comes from the
 * key's org_id; nothing in a request can name another business.
 *
 * Left out on purpose: sending anything to customers, payments, deleting,
 * bulk imports. draft_quote only drafts (the owner reviews and sends).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "../api-auth";
import { memoryLimit } from "../rate-limit";
import { siteOrigin } from "../site-url";
import { tryReadBlob } from "../job-blob";
import { ymdInZone } from "../dates";
import { dispatchNotifications, resolveRecipients } from "../notify-server";
import { DRAFTS_PER_DAY, draftLeadQuote, draftSummary, draftTotals } from "../lead-draft";
import { addDays, localNow, openSlots, readBookingSettings } from "../booking";
import { loadBusyVisits } from "../booking-server";
import type { Room } from "../types";
import { hashKey, looksLikeKey, type AgentScope } from "./keys";
import { matchCustomers, sameCustomer, type CustomerLike } from "./customer-match";
import { SCHEDULABLE, SOURCE_LABEL, checkSchedule, checkWorkOrder, isUuid, scheduleRows } from "./plan";
import { draftPdfQuery } from "./draft-link";

export interface AgentCtx {
  supabase: SupabaseClient;
  orgId: string;
  keyId: string;
  scopes: AgentScope[];
}

export type ToolResult = { ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: string };

export interface ToolDef {
  name: string;
  scope: AgentScope;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Calls one key may make per minute (per server instance) and per hour
 *  (counted in api_activity, shared by every instance). */
export const RATE = { perMinute: 30, perHour: 600 };

const prop = (type: string, description: string, extra: Record<string, unknown> = {}) => ({ type, description, ...extra });

export const TOOLS: ToolDef[] = [
  {
    name: "find_customer",
    scope: "customers:read",
    description: "Find an existing customer of this business by phone, email or name. Phone and email are normalized, so any format matches. Returns up to 5 matches with their addresses.",
    inputSchema: {
      type: "object",
      properties: { phone: prop("string", "Any phone format"), email: prop("string", "Email address"), name: prop("string", "Full name (weakest match)") },
    },
  },
  {
    name: "add_work_order",
    scope: "work_orders:write",
    description: "Add a work order as a new LEAD (not a scheduled job). Links it to the matching customer (by phone or email) or adds the customer. Sending the same source + external_id again returns the existing lead.",
    inputSchema: {
      type: "object",
      required: ["source", "description"],
      properties: {
        source: prop("string", "Where it came from", { enum: ["appfolio", "angi", "buildium", "email"] }),
        external_id: prop("string", "The work order / request id in that system"),
        description: prop("string", "What needs doing, in the customer's or manager's words"),
        customer_name: prop("string", "Tenant / customer name"),
        phone: prop("string", "Customer phone"),
        email: prop("string", "Customer email"),
        street: prop("string", "Street address"), city: prop("string", "City"), state: prop("string", "State"), zip: prop("string", "ZIP"),
        photo_urls: prop("array", "Up to 12 https photo links", { items: { type: "string" } }),
      },
    },
  },
  {
    name: "draft_quote",
    scope: "quotes:draft",
    description: "Run Creed's AI quote engine on a lead and save the result as a DRAFT for the owner to review (nothing is sent). Uses the business's rates, minimum charge, trip fee, tax, Good/Better/Best options and flat-price setting. Returns total, hours, a short line list, a link to the quote in Creed and a PDF link. Limited to 25 AI drafts per business per day.",
    inputSchema: { type: "object", required: ["job_id"], properties: { job_id: prop("string", "The lead's job id (from add_work_order)") } },
  },
  {
    name: "get_open_slots",
    scope: "schedule:read",
    description: "Open appointment times from the business's working hours minus what is already on its schedule (the same rules as its online booking page).",
    inputSchema: { type: "object", properties: { days_ahead: prop("integer", "How many days to look ahead (1-30, default: the business's booking setting)") } },
  },
  {
    name: "schedule_job",
    scope: "schedule:write",
    description: "Put a job on the schedule: one schedule entry per day with an optional start time and crew, tied to the job by id. Sets the job to scheduled. Calling again for the same day updates that day's entry.",
    inputSchema: {
      type: "object",
      required: ["job_id"],
      properties: {
        job_id: prop("string", "The job id"),
        start_date: prop("string", "First day, YYYY-MM-DD"),
        days: prop("integer", "Consecutive days from start_date (default 1, max 14)"),
        dates: prop("array", "Or: exact days, YYYY-MM-DD", { items: { type: "string" } }),
        time: prop("string", "Start time, e.g. 09:00 or 2:30 pm"),
        crew: prop("array", "Team member names", { items: { type: "string" } }),
        note: prop("string", "Short note for the crew"),
      },
    },
  },
];

export const toolByName = (n: string): ToolDef | undefined => TOOLS.find((t) => t.name === n);

// ── Key check ───────────────────────────────────────────────────────────────

export function bearerKey(h: { get(n: string): string | null }): string {
  const m = (h.get("authorization") || "").match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : (h.get("x-api-key") || "").trim();
}

/** The business + scopes behind a key, or null (unknown, revoked, malformed). */
export async function authenticateKey(key: string): Promise<AgentCtx | null> {
  if (!looksLikeKey(key)) return null;
  const supabase = serviceClient();
  const { data, error } = await supabase.from("api_keys")
    .select("id, org_id, scopes, revoked_at").eq("key_hash", hashKey(key)).maybeSingle();
  if (error || !data || data.revoked_at) return null;
  // Best-effort: "last used" on the settings page.
  await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { supabase, orgId: String(data.org_id), keyId: String(data.id), scopes: (data.scopes || []) as AgentScope[] };
}

/** Write one activity row. Never throws (a failed log never fails a call). */
export async function logActivity(supabase: SupabaseClient, row: {
  orgId: string; keyId: string | null; tool: string; via: string; ok: boolean; status: number; summary?: string; jobId?: string | null;
}): Promise<void> {
  try {
    await supabase.from("api_activity").insert({
      org_id: row.orgId, key_id: row.keyId, tool: row.tool.slice(0, 40), via: row.via, ok: row.ok,
      status: row.status, summary: (row.summary || "").slice(0, 300), job_id: row.jobId && isUuid(row.jobId) ? row.jobId : null,
    });
  } catch { /* logging is best-effort */ }
}

/** Every call goes through here: scope → rate limit → tool → activity log. */
export async function runTool(ctx: AgentCtx, name: string, args: unknown, via: "rest" | "mcp"): Promise<ToolResult> {
  const def = toolByName(name);
  const a = (args && typeof args === "object" && !Array.isArray(args) ? args : {}) as Record<string, unknown>;
  const jobId = typeof a.job_id === "string" ? a.job_id : null;
  const done = async (r: ToolResult, summary: string, jid: string | null = jobId): Promise<ToolResult> => {
    await logActivity(ctx.supabase, { orgId: ctx.orgId, keyId: ctx.keyId, tool: def ? name : "unknown", via, ok: r.ok, status: r.ok ? 200 : r.status, summary: r.ok ? summary : `${summary ? summary + ": " : ""}${r.error}`, jobId: jid });
    return r;
  };
  if (!def) return done({ ok: false, status: 404, error: `unknown tool: ${String(name).slice(0, 40)}` }, "");
  if (!ctx.scopes.includes(def.scope)) return done({ ok: false, status: 403, error: `this key lacks the ${def.scope} scope` }, "");
  if (!memoryLimit(`agent:${ctx.keyId}`, RATE.perMinute, 60_000)) return done({ ok: false, status: 429, error: "too many calls, slow down" }, "");
  const { count } = await ctx.supabase.from("api_activity").select("id", { count: "exact", head: true })
    .eq("key_id", ctx.keyId).gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
  if ((count || 0) >= RATE.perHour) return done({ ok: false, status: 429, error: "hourly call limit reached" }, "");
  try {
    const out = await HANDLERS[def.name](ctx, a);
    return done(out.result, out.summary, out.jobId ?? jobId);
  } catch (e) {
    console.error(`[agent] ${name} failed:`, e);
    return done({ ok: false, status: 500, error: "server error" }, "");
  }
}

type Handler = (ctx: AgentCtx, a: Record<string, unknown>) => Promise<{ result: ToolResult; summary: string; jobId?: string | null }>;
const fail = (status: number, error: string) => ({ result: { ok: false as const, status, error }, summary: "" });

async function loadCustomers(ctx: AgentCtx): Promise<CustomerLike[]> {
  const { data, error } = await ctx.supabase.from("customers").select("id, name, phone, email")
    .eq("org_id", ctx.orgId).limit(10000);
  if (error) throw new Error(error.message);
  return (data || []) as CustomerLike[];
}

// ── The five tools ──────────────────────────────────────────────────────────

const findCustomer: Handler = async (ctx, a) => {
  const q = { phone: a.phone as string, email: a.email as string, name: a.name as string };
  if (!q.phone && !q.email && !q.name) return fail(400, "give phone, email or name");
  const hits = matchCustomers(await loadCustomers(ctx), q).slice(0, 5);
  const ids = hits.map((h) => h.customer.id);
  const addrs = new Map<string, string[]>();
  if (ids.length) {
    const { data } = await ctx.supabase.from("addresses").select("customer_id, street, city, state, zip")
      .eq("org_id", ctx.orgId).in("customer_id", ids).limit(100);
    for (const r of (data || []) as { customer_id: string; street?: string; city?: string; state?: string; zip?: string }[]) {
      const line = [r.street, r.city, r.state, r.zip].filter(Boolean).join(", ");
      if (line) addrs.set(r.customer_id, [...(addrs.get(r.customer_id) || []), line]);
    }
  }
  return {
    result: { ok: true, data: { matches: hits.map((h) => ({
      customer_id: h.customer.id, name: h.customer.name || "", phone: h.customer.phone || "", email: h.customer.email || "",
      matched_by: h.by, addresses: addrs.get(h.customer.id) || [],
    })) } },
    summary: `${hits.length} match${hits.length === 1 ? "" : "es"}`,
  };
};

const addWorkOrder: Handler = async (ctx, a) => {
  const c = checkWorkOrder(a);
  if (!c.ok) return fail(400, c.error);
  const w = c.value;
  const sb = ctx.supabase;
  const existing = async () => {
    if (!w.externalId) return null;
    const { data } = await sb.from("jobs").select("id, status, customer_id").eq("org_id", ctx.orgId)
      .eq("source", w.source).eq("external_id", w.externalId).limit(1);
    return data?.[0] || null;
  };
  const dup = await existing();
  if (dup) {
    return { result: { ok: true, data: { job_id: dup.id, customer_id: dup.customer_id, status: dup.status, created: false } }, summary: `already had ${SOURCE_LABEL[w.source]} ${w.externalId}`, jobId: dup.id };
  }
  let customerId: string | null = sameCustomer(await loadCustomers(ctx), w)?.id ?? null;
  const matched = !!customerId;
  if (!customerId) {
    const { data, error } = await sb.from("customers").insert({
      org_id: ctx.orgId, name: w.name || w.phone || w.email, type: "individual", phone: w.phone || null, email: w.email || null,
    }).select("id").single();
    if (error) return fail(500, error.message);
    customerId = data.id;
  }
  const addressLine = [w.street, w.city, w.state, w.zip].filter(Boolean).join(", ");
  let addressId: string | null = null;
  if (w.street || w.city) {
    const { data, error } = await sb.from("addresses").insert({
      org_id: ctx.orgId, customer_id: customerId, street: w.street || null, city: w.city || null, state: w.state || null, zip: w.zip || null,
    }).select("id").single();
    if (error) return fail(500, error.message);
    addressId = data.id;
  }
  const label = SOURCE_LABEL[w.source];
  const { data: job, error: jobErr } = await sb.from("jobs").insert({
    org_id: ctx.orgId,
    property: addressLine || "(address pending)",
    client: w.name || w.phone || w.email,
    customer_id: customerId,
    address_id: addressId,
    job_date: ymdInZone(Date.now()),
    source: w.source,
    external_id: w.externalId || null,
    rooms: JSON.stringify({
      leadDescription: w.description,
      leadPhotos: w.photos,
      leadSource: w.source,
      ...(w.externalId ? { leadExternalId: w.externalId } : {}),
      leadVia: "agent",
    }),
    total: 0, total_labor: 0, total_mat: 0, total_hrs: 0,
    status: "lead",
    created_by: `${label} (AI assistant)`,
  }).select("id").single();
  if (jobErr) {
    // Two calls for the same work order at once: the unique index stops the
    // second, which returns the first's lead.
    const again = jobErr.code === "23505" ? await existing() : null;
    if (again) return { result: { ok: true, data: { job_id: again.id, customer_id: again.customer_id, status: again.status, created: false } }, summary: "already had it", jobId: again.id };
    return fail(500, jobErr.message);
  }
  try {
    const recipients = await resolveRecipients(sb, ctx.orgId, { managers: true, event: "leads" });
    if (recipients.length) {
      await dispatchNotifications(sb, {
        orgId: ctx.orgId, type: "new_lead", title: `New ${label} work order`,
        body: addressLine ? `${w.name || "Customer"} · ${addressLine}` : (w.name || "New lead"),
        jobId: job.id,
        smsBody: `New ${label} work order: ${w.name || ""} ${addressLine}`.trim(),
        recipients,
      });
    }
  } catch (e) { console.error("[agent] notify failed (lead saved):", e); }
  return {
    result: { ok: true, data: { job_id: job.id, customer_id: customerId, customer_matched: matched, status: "lead", created: true } },
    summary: `lead from ${label}${w.externalId ? ` ${w.externalId}` : ""}`,
    jobId: job.id,
  };
};

/** AI drafts this business ran through the agent API in the last day. */
async function agentDraftsToday(ctx: AgentCtx): Promise<number> {
  const { count } = await ctx.supabase.from("api_activity").select("id", { count: "exact", head: true })
    .eq("org_id", ctx.orgId).eq("tool", "draft_quote").like("summary", "AI draft%")
    .gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
  return count || 0;
}

const ORG_PRICING = "default_rate, trade_rates, markup_pct, tax_pct, tax_mode, trip_fee, min_labor_hours, material_tax_pct, material_tax_by_zip";

const draftQuote: Handler = async (ctx, a) => {
  if (!isUuid(a.job_id)) return fail(400, "job_id must be a job id");
  const sb = ctx.supabase;
  const { data: job } = await sb.from("jobs").select("id, status, rooms, property, client, source")
    .eq("id", a.job_id).eq("org_id", ctx.orgId).maybeSingle();
  if (!job) return fail(404, "no such job in this business");
  const blob = tryReadBlob(job.rooms) || {};
  let rooms: Room[] | null = null;
  let estDays: number | null = null;
  let ranAi = false;
  const prior = blob.leadDraft as { rooms?: Room[]; estDays?: number | null } | undefined;
  if (job.status !== "lead") return fail(409, `job is ${job.status}, not a lead — open it in Creed`);
  if (Array.isArray(blob.rooms) && blob.rooms.length) return fail(409, "this lead already has a quote — open it in Creed");
  if (prior && Array.isArray(prior.rooms) && prior.rooms.length) {
    rooms = prior.rooms; estDays = prior.estDays ?? null; // already drafted: no second AI run
  } else {
    if (await agentDraftsToday(ctx) >= DRAFTS_PER_DAY) return fail(429, `daily limit of ${DRAFTS_PER_DAY} AI drafts reached`);
    const src = SOURCE_LABEL[job.source as keyof typeof SOURCE_LABEL];
    const r = await draftLeadQuote(sb, {
      orgId: ctx.orgId, jobId: job.id,
      description: typeof blob.leadDescription === "string" ? blob.leadDescription : "",
      photos: Array.isArray(blob.leadPhotos) ? (blob.leadPhotos as unknown[]).filter((p): p is string => typeof p === "string") : [],
      property: job.property || "", client: job.client || "",
      requestFrom: src ? `a ${src} work order` : "a work order",
    });
    ranAi = true;
    if (!r.ok || !r.rooms) {
      const status = r.reason === "daily cap" ? 429 : r.reason === "too little to quote" ? 422 : 502;
      return { result: { ok: false, status, error: `no draft: ${r.reason}` }, summary: "AI draft failed" };
    }
    rooms = r.rooms; estDays = r.estDays ?? null;
  }
  const { data: org } = await sb.from("organizations").select(ORG_PRICING).eq("id", ctx.orgId).maybeSingle();
  // Optional columns, read on their own so a missing one can't break the draft.
  const { data: extra } = await sb.from("organizations").select("tiered_quotes_default, flat_pricing").eq("id", ctx.orgId).maybeSingle();
  const o = { ...(org || {}), ...(extra || {}) } as Parameters<typeof draftSummary>[1] & { flat_pricing?: boolean };
  const totals = draftTotals(rooms, o, job.property || "");
  const sum = draftSummary(rooms, o, job.property || "");
  const flat = (typeof blob.flatPricing === "boolean" ? blob.flatPricing : o.flat_pricing === true);
  const origin = siteOrigin();
  return {
    result: { ok: true, data: {
      job_id: job.id,
      status: "draft",
      note: "Draft only. Nothing was sent; the owner reviews and sends it in Creed.",
      total: totals.total,
      hours: totals.hours,
      est_days: estDays,
      flat_pricing: flat,
      options: sum.tiers,
      lines: sum.lines.slice(0, 15).map((l) => (flat ? { detail: l.detail, price: l.price } : { detail: l.detail, price: l.price, hours: l.hours })),
      more_lines: Math.max(0, sum.lines.length - 15),
      quote_link: `${origin}/?job=${job.id}`,
      pdf_link: `${origin}/api/agent/draft-pdf?${draftPdfQuery(job.id)}`,
    } },
    summary: ranAi ? `AI draft $${Math.round(totals.total)}` : `draft $${Math.round(totals.total)} (already drafted)`,
  };
};

const getOpenSlots: Handler = async (ctx, a) => {
  const { data } = await ctx.supabase.from("organizations")
    .select("booking_hours, booking_slot_min, booking_buffer_min, booking_min_notice_hours, booking_days_ahead, booking_tz")
    .eq("id", ctx.orgId).maybeSingle();
  const s = readBookingSettings((data || {}) as Record<string, unknown>);
  const want = Number(a.days_ahead);
  if (Number.isInteger(want) && want >= 1) s.daysAhead = Math.min(want, 30);
  const now = localNow(new Date(), s.tz);
  const visits = await loadBusyVisits(ctx.supabase, ctx.orgId, now.date, s.daysAhead);
  const days = openSlots(s, visits, now);
  return {
    result: { ok: true, data: { timezone: s.tz, slot_minutes: s.slotMin, from: now.date, to: addDays(now.date, s.daysAhead), days } },
    summary: `${days.reduce((n, d) => n + d.slots.length, 0)} open times`,
  };
};

const scheduleJob: Handler = async (ctx, a) => {
  const sb = ctx.supabase;
  const { data: team } = await sb.from("profiles").select("name, status").eq("org_id", ctx.orgId);
  const names = ((team || []) as { name?: string; status?: string }[]).filter((p) => p.status !== "pending" && p.name).map((p) => p.name as string);
  const c = checkSchedule(a, names);
  if (!c.ok) return fail(400, c.error);
  const s = c.value;
  const { data: job } = await sb.from("jobs").select("id, status, property").eq("id", s.jobId).eq("org_id", ctx.orgId).maybeSingle();
  if (!job) return fail(404, "no such job in this business");
  if (!SCHEDULABLE.has(job.status)) return fail(409, `job is ${job.status} and can't be scheduled`);
  const rows = scheduleRows(s, job.property || "", ctx.orgId);
  // A day this job is already on gets its entry updated, not a second one.
  const { data: have } = await sb.from("schedule").select("id, sched_date").eq("org_id", ctx.orgId).eq("job_id", job.id).in("sched_date", s.dates);
  const byDate = new Map(((have || []) as { id: string | number; sched_date: string }[]).map((r) => [r.sched_date, r.id]));
  const fresh = rows.filter((r) => !byDate.has(r.sched_date));
  for (const r of rows) {
    const id = byDate.get(r.sched_date);
    if (id != null) {
      const { error } = await sb.from("schedule").update({ note: r.note, job: r.job }).eq("id", id).eq("org_id", ctx.orgId);
      if (error) return fail(500, error.message);
    }
  }
  if (fresh.length) {
    const { error } = await sb.from("schedule").insert(fresh);
    if (error) return fail(500, error.message);
  }
  let status = job.status;
  if (["lead", "quoted", "accepted"].includes(job.status)) {
    const { error } = await sb.from("jobs").update({ status: "scheduled" }).eq("id", job.id).eq("org_id", ctx.orgId).eq("status", job.status);
    if (!error) status = "scheduled";
  }
  return {
    result: { ok: true, data: { job_id: job.id, status, days: s.dates, time: s.time || null, crew: s.crew, added: fresh.length, updated: rows.length - fresh.length } },
    summary: `${s.dates.length} day${s.dates.length === 1 ? "" : "s"} from ${s.dates[0]}`,
    jobId: job.id,
  };
};

const HANDLERS: Record<string, Handler> = {
  find_customer: findCustomer,
  add_work_order: addWorkOrder,
  draft_quote: draftQuote,
  get_open_slots: getOpenSlots,
  schedule_job: scheduleJob,
};
