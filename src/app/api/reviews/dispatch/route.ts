import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * Hourly cron — reads any review_requests rows whose scheduled_for has
 * passed and status is still "scheduled", builds the message from the
 * org template (or default), sends via Twilio SMS / Resend email
 * depending on `channel`, then patches the row's status + sent_at /
 * error.
 *
 * Authorization mirrors /api/payroll/auto-run: Vercel cron header,
 * CRON_SECRET bearer, or x-admin-token for manual triggers from the
 * field-test panel.
 *
 * Email is best-effort via Resend (RESEND_API_KEY). If the channel
 * requires email but Resend isn't configured, the row is marked failed
 * with an explanatory error so the owner can see why it didn't send.
 *
 * Throughput note: we cap at MAX_PER_RUN per invocation so a backlog
 * after a long outage doesn't burn the function timeout. Anything
 * beyond the cap stays "scheduled" and gets picked up on the next
 * hourly fire.
 */

const MAX_PER_RUN = 50;

interface ReviewRequestRow {
  id: string;
  org_id: string;
  job_id: string;
  customer_id: string | null;
  channel: "sms" | "email" | "both";
}

interface OrgRow {
  id: string;
  name: string | null;
  review_request_message: string | null;
  google_review_url: string | null;
}

interface JobRow {
  id: string;
  property: string | null;
  client: string | null;
}

interface CustomerRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
}

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  if (req.headers.get("x-vercel-cron") === "1") return true;
  const adminToken = req.headers.get("x-admin-token");
  const adminPw = process.env.ADMIN_PASSWORD;
  if (adminPw && adminToken && adminToken === adminPw) return true;
  return false;
}

function defaultTemplate(): string {
  return "Hi {customer_name}, thanks for choosing {business_name} for your {job_property} project. If we earned it, we'd love a quick Google review: {review_link}";
}

function fallbackTemplate(): string {
  return "Hi {customer_name}, thanks for choosing {business_name} for your {job_property} project. If we earned it, we'd love a quick rating — just reply with a star rating 1-5.";
}

function renderTemplate(
  template: string,
  vars: { customer_name: string; business_name: string; job_property: string; review_link: string },
): string {
  return template
    .replace(/\{customer_name\}/g, vars.customer_name)
    .replace(/\{business_name\}/g, vars.business_name)
    .replace(/\{job_property\}/g, vars.job_property)
    .replace(/\{review_link\}/g, vars.review_link);
}

function firstName(full: string | null | undefined): string {
  if (!full) return "there";
  return String(full).trim().split(/\s+/)[0] || "there";
}

function normalizePhone(raw: string): string {
  const v = (raw || "").trim();
  if (!v) return "";
  if (v.startsWith("+")) return "+" + v.slice(1).replace(/\D/g, "");
  const digits = v.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

async function sendSms(to: string, body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    return { ok: false, error: "Twilio not configured (TWILIO_ACCOUNT_SID/TOKEN/FROM_NUMBER)" };
  }
  const phone = normalizePhone(to);
  if (!phone) return { ok: false, error: "No valid phone number on customer record" };

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const form = new URLSearchParams({ To: phone, From: from, Body: body });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({} as { message?: string }));
    return { ok: false, error: (data as { message?: string }).message || `Twilio ${res.status}` };
  }
  return { ok: true };
}

async function sendEmail(to: string, subject: string, body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { ok: false, error: "Resend not configured (set RESEND_API_KEY to enable email)" };
  }
  if (!to || !to.includes("@")) {
    return { ok: false, error: "No valid email on customer record" };
  }
  const from = process.env.RESEND_FROM_EMAIL || "reviews@creedhandyman.com";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text: body,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({} as { message?: string }));
    return { ok: false, error: (data as { message?: string }).message || `Resend ${res.status}` };
  }
  return { ok: true };
}

interface DispatchResult {
  id: string;
  job_id: string;
  channel: string;
  status: "sent" | "failed";
  error?: string;
}

async function dispatchOne(
  supabase: SupabaseClient,
  row: ReviewRequestRow,
  orgsById: Map<string, OrgRow>,
  jobsById: Map<string, JobRow>,
  customersById: Map<string, CustomerRow>,
): Promise<DispatchResult> {
  const org = orgsById.get(row.org_id);
  const job = jobsById.get(row.job_id);
  const customer = row.customer_id ? customersById.get(row.customer_id) : undefined;

  if (!job) {
    await supabase
      .from("review_requests")
      .update({ status: "failed", error: "Job not found", sent_at: new Date().toISOString() })
      .eq("id", row.id);
    return { id: row.id, job_id: row.job_id, channel: row.channel, status: "failed", error: "Job not found" };
  }

  const businessName = org?.name || "us";
  const jobProperty = job.property || "your home";
  const customerName = firstName(customer?.name || job.client);
  const reviewLink = org?.google_review_url || "";
  const template = (org?.review_request_message && org.review_request_message.trim().length)
    ? org.review_request_message
    : (reviewLink ? defaultTemplate() : fallbackTemplate());

  const body = renderTemplate(template, {
    customer_name: customerName,
    business_name: businessName,
    job_property: jobProperty,
    review_link: reviewLink,
  });

  // The send. "both" only succeeds if at least one channel sends; we
  // record the first error encountered so the owner can act on it.
  const errors: string[] = [];
  let sentAny = false;

  if (row.channel === "sms" || row.channel === "both") {
    if (!customer?.phone) {
      errors.push("No phone on customer");
    } else {
      const r = await sendSms(customer.phone, body);
      if (r.ok) sentAny = true; else errors.push(`SMS: ${r.error}`);
    }
  }

  if (row.channel === "email" || row.channel === "both") {
    if (!customer?.email) {
      errors.push("No email on customer");
    } else {
      const subject = `Quick favor from ${businessName}`;
      const r = await sendEmail(customer.email, subject, body);
      if (r.ok) sentAny = true; else errors.push(`Email: ${r.error}`);
    }
  }

  const now = new Date().toISOString();
  if (sentAny) {
    await supabase
      .from("review_requests")
      .update({ status: "sent", sent_at: now, error: errors.length ? errors.join("; ") : null })
      .eq("id", row.id);
    // Mirror onto the job so the manual "Request Review" button knows.
    await supabase
      .from("jobs")
      .update({ review_requested_at: now })
      .eq("id", row.job_id);
    return { id: row.id, job_id: row.job_id, channel: row.channel, status: "sent" };
  }

  const errMsg = errors.join("; ") || "Unknown send failure";
  await supabase
    .from("review_requests")
    .update({ status: "failed", sent_at: now, error: errMsg })
    .eq("id", row.id);
  return { id: row.id, job_id: row.job_id, channel: row.channel, status: "failed", error: errMsg };
}

async function handleDispatch(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const nowIso = new Date().toISOString();
  const { data: pending, error: pErr } = await supabase
    .from("review_requests")
    .select("id, org_id, job_id, customer_id, channel")
    .eq("status", "scheduled")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(MAX_PER_RUN);

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  const rows: ReviewRequestRow[] = (pending || []) as ReviewRequestRow[];
  if (!rows.length) {
    return NextResponse.json({ ok: true, dispatched: 0, ts: nowIso });
  }

  // Batch the lookups so we do at most three queries per run instead of
  // 3N: orgs, jobs, customers — each fetched once for the union of ids
  // present on the pending rows.
  const orgIds = Array.from(new Set(rows.map((r) => r.org_id))).filter(Boolean);
  const jobIds = Array.from(new Set(rows.map((r) => r.job_id))).filter(Boolean);
  const custIds = Array.from(new Set(rows.map((r) => r.customer_id).filter(Boolean) as string[]));

  const [orgRes, jobRes, custRes] = await Promise.all([
    orgIds.length
      ? supabase.from("organizations").select("id, name, review_request_message, google_review_url").in("id", orgIds)
      : Promise.resolve({ data: [] as OrgRow[], error: null }),
    jobIds.length
      ? supabase.from("jobs").select("id, property, client").in("id", jobIds)
      : Promise.resolve({ data: [] as JobRow[], error: null }),
    custIds.length
      ? supabase.from("customers").select("id, name, phone, email").in("id", custIds)
      : Promise.resolve({ data: [] as CustomerRow[], error: null }),
  ]);

  const orgsById = new Map<string, OrgRow>(((orgRes.data || []) as OrgRow[]).map((o) => [o.id, o]));
  const jobsById = new Map<string, JobRow>(((jobRes.data || []) as JobRow[]).map((j) => [j.id, j]));
  const customersById = new Map<string, CustomerRow>(((custRes.data || []) as CustomerRow[]).map((c) => [c.id, c]));

  const results: DispatchResult[] = [];
  for (const row of rows) {
    try {
      const r = await dispatchOne(supabase, row, orgsById, jobsById, customersById);
      results.push(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase
        .from("review_requests")
        .update({ status: "failed", sent_at: new Date().toISOString(), error: msg })
        .eq("id", row.id);
      results.push({ id: row.id, job_id: row.job_id, channel: row.channel, status: "failed", error: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    dispatched: results.length,
    sent: results.filter((r) => r.status === "sent").length,
    failed: results.filter((r) => r.status === "failed").length,
    ts: nowIso,
    results,
  });
}

// Vercel cron uses GET; manual triggers can use either.
export const GET = handleDispatch;
export const POST = handleDispatch;
