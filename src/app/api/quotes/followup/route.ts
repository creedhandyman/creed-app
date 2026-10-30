import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cronAuth } from "@/lib/cron-auth";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { smsConsentGranted } from "@/lib/sms-consent";
import { signJobToken } from "@/lib/job-token";
import { siteOrigin } from "@/lib/site-url";
import { notifyQuoteFollowup } from "@/lib/notify-server";
import {
  followupChannel, followupDue, followupMessage, FOLLOWUP_STALE_DAYS, MAX_FOLLOWUPS, ordinal,
  type FollowupChannel, type FollowupJob,
} from "@/lib/quote-followup";

export const dynamic = "force-dynamic";

/**
 * Daily cron — nudges customers who haven't answered a quote.
 *
 * Opt-in per business (organizations.quote_followup_enabled, Ops → Settings).
 * For each sent, still-"quoted", unsigned job, followup #1 goes out 2 days after
 * the last contact and #2 three days after that (lib/quote-followup.ts holds the
 * rules). Channel: a text only with the customer's recorded opt-in, else email,
 * else the OWNER is alerted to reach out themselves. The owner is told what
 * happened either way, deep-linked to the job.
 *
 * Auth: lib/cron-auth.ts. Manual test: add `?dry=1` to see what WOULD go out
 * (nothing is sent or stamped).
 *
 * Idempotent: each job is "claimed" with a conditional update on its follow-up
 * count BEFORE anything is sent, so a double-invoked cron or a retry can't send
 * the same step twice. A send that then fails falls back to the next channel and
 * finally to the owner alert.
 */

const MAX_PER_RUN = 50;
const DAY_MS = 86_400_000;

interface JobRow extends FollowupJob {
  id: string;
  org_id: string;
  client: string | null;
  property: string | null;
  customer_id: string | null;
  quote_viewed_at: string | null;
}

interface CustomerRow { id: string; name: string | null; phone: string | null; email: string | null }

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!cronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dry = req.nextUrl.searchParams.get("dry") === "1";

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: orgs, error: oErr } = await supabase
    .from("organizations").select("id, name").eq("quote_followup_enabled", true);
  if (oErr) {
    return NextResponse.json({
      error: oErr.message,
      hint: "organizations.quote_followup_enabled is missing — run the quote follow-up migration (see CLAUDE.md).",
    }, { status: 500 });
  }
  if (!orgs?.length) return NextResponse.json({ ok: true, orgs: 0, sent: 0 });
  const orgName = new Map<string, string>(orgs.map((o) => [o.id as string, (o.name as string) || ""]));

  const { data: raw, error: jErr } = await supabase
    .from("jobs")
    .select("id, org_id, status, archived, client, property, customer_id, rooms, quote_sent_at, quote_viewed_at, quote_view_count, quote_followup_at, quote_followup_count")
    .in("org_id", [...orgName.keys()])
    .eq("status", "quoted")
    .not("quote_sent_at", "is", null)
    // Only rows that could still be due, newest first, so old ghosted quotes
    // can't crowd new ones out of the read (followupDue re-checks all of this).
    .not("archived", "is", true)
    .or(`quote_followup_count.is.null,quote_followup_count.lt.${MAX_FOLLOWUPS}`)
    .gte("quote_sent_at", new Date(Date.now() - (FOLLOWUP_STALE_DAYS + 10) * DAY_MS).toISOString())
    .order("quote_sent_at", { ascending: false })
    .limit(500);
  if (jErr) {
    return NextResponse.json({
      error: jErr.message,
      hint: "jobs.quote_followup_* columns are missing — run the quote follow-up migration (see CLAUDE.md).",
    }, { status: 500 });
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const due = ((raw || []) as unknown as JobRow[])
    .map((j) => ({ j, step: followupDue(j, now) }))
    .filter((x): x is { j: JobRow; step: 1 | 2 } => x.step !== null)
    .slice(0, MAX_PER_RUN);
  if (!due.length) return NextResponse.json({ ok: true, dry, due: 0, sent: 0 });

  const custIds = [...new Set(due.map((x) => x.j.customer_id).filter(Boolean) as string[])];
  const { data: custs } = custIds.length
    ? await supabase.from("customers").select("id, name, phone, email").in("id", custIds)
    : { data: [] as CustomerRow[] };
  const customers = new Map<string, CustomerRow>(((custs || []) as CustomerRow[]).map((c) => [c.id, c]));

  const results: { job_id: string; step: number; via: FollowupChannel | "skipped"; error?: string }[] = [];

  for (const { j, step } of due) {
    // Built before the claim: if signing throws (secret unset) nothing is spent.
    const link = `${siteOrigin()}/status?job=${encodeURIComponent(j.id)}&t=${encodeURIComponent(signJobToken(j.id))}`;
    const cust = j.customer_id ? customers.get(j.customer_id) : undefined;
    const channel = followupChannel({
      consent: smsConsentGranted(j.rooms),
      phone: cust?.phone,
      email: cust?.email,
    });
    if (dry) { results.push({ job_id: j.id, step, via: channel }); continue; }

    // Claim this step before sending (see header). 0 rows back = another run got it.
    const prev = Math.max(0, Math.floor(Number(j.quote_followup_count) || 0));
    let claim = supabase
      .from("jobs")
      .update({ quote_followup_count: step, quote_followup_at: nowIso })
      .eq("id", j.id)
      .eq("status", "quoted");
    claim = prev === 0
      ? claim.or("quote_followup_count.is.null,quote_followup_count.eq.0")
      : claim.eq("quote_followup_count", prev);
    const { data: claimed } = await claim.select("id");
    if (!claimed?.length) { results.push({ job_id: j.id, step, via: "skipped" }); continue; }

    const business = orgName.get(j.org_id) || "";
    const client = j.client || cust?.name || "your customer";
    const where = j.property || "their quote";
    const msg = followupMessage({
      step, customer: cust?.name || j.client, business, property: j.property, link,
      viewed: (Number(j.quote_view_count) || 0) > 0,
    });

    let via: FollowupChannel = "owner";
    let error: string | undefined;
    try {
      if (channel === "sms") {
        const r = await sendSms(cust!.phone as string, msg);
        if (r.ok) via = "sms"; else error = `SMS: ${r.error}`;
      }
      if (via === "owner" && (channel === "sms" || channel === "email") && (cust?.email || "").includes("@")) {
        const r = await sendEmail(cust!.email as string, `Your quote from ${business || "us"}`, msg);
        if (r.ok) via = "email"; else error = `${error ? error + "; " : ""}Email: ${r.error}`;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    results.push({ job_id: j.id, step, via, ...(error ? { error } : {}) });

    const days = Math.floor((now - Date.parse(j.quote_sent_at || nowIso)) / DAY_MS);
    const ord = `${ordinal(step)} of ${MAX_FOLLOWUPS}`;
    if (via === "sms" || via === "email") {
      await notifyQuoteFollowup(supabase, {
        jobId: j.id, orgId: j.org_id,
        title: via === "sms" ? "Follow-up texted" : "Follow-up emailed",
        body: `${via === "sms" ? "Texted" : "Emailed"} ${client} about ${where} (${ord}).`,
      });
    } else {
      await notifyQuoteFollowup(supabase, {
        jobId: j.id, orgId: j.org_id,
        title: "Follow-up needed",
        body: `${client}'s quote for ${where} has been out ${days} day${days === 1 ? "" : "s"}${(Number(j.quote_view_count) || 0) > 0 ? " and they've opened it" : ""}. It couldn't go out automatically (no text consent or working email on file), so tap to reach out yourself.`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    dry,
    due: due.length,
    sent: results.filter((r) => r.via === "sms" || r.via === "email").length,
    ownerAlerts: results.filter((r) => r.via === "owner").length,
    results,
  });
}

export const GET = handle;
export const POST = handle;
