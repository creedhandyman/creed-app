import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cronAuth } from "@/lib/cron-auth";
import { sendEmail } from "@/lib/email";
import { sendLoggedSms } from "@/lib/sms-log";
import { smsConsentGranted } from "@/lib/sms-consent";
import { isPropertyManager, textRecipient, type RecipientCustomer } from "@/lib/sms-recipient";
import { textBody } from "@/lib/sms-templates";
import { signJobToken } from "@/lib/job-token";
import { siteOrigin } from "@/lib/site-url";
import { notifyManagers } from "@/lib/notify-server";
import {
  balanceDue, invoiceChannel, invoiceReminderDue, MAX_INVOICE_REMINDERS,
  type InvoiceChannel, type InvoiceReminderJob,
} from "@/lib/invoice-reminder";

export const dynamic = "force-dynamic";

/**
 * Daily cron (10 AM Central): reminders for unpaid invoices.
 *
 * Opt-in per business (organizations.auto_sms_invoice, Operations → Settings,
 * OFF by default). Jobs in "invoiced" with a balance due get a reminder 3, 7
 * and 14 days after the invoice went out (lib/invoice-reminder.ts), always to
 * whoever PAYS (never a resident):
 *   - property manager: email (else the owner is alerted);
 *   - regular customer: a text if they opted in to texts, else email, else
 *     the owner is alerted.
 * The owner gets an in-app note every time.
 *
 * Idempotent: each step is claimed (conditional update on
 * invoice_reminder_count) BEFORE sending. Auth: lib/cron-auth.ts. `?dry=1`
 * shows what WOULD go out without sending or stamping anything.
 */
const MAX_PER_RUN = 50;

interface JobRow extends InvoiceReminderJob {
  id: string;
  org_id: string;
  client: string | null;
  property: string | null;
  customer_id: string | null;
  rooms: string | null;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!cronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: orgs, error: oErr } = await supabase
    .from("organizations").select("id, name").eq("auto_sms_invoice", true);
  if (oErr) {
    return NextResponse.json({
      error: oErr.message,
      hint: "organizations.auto_sms_invoice is missing — run supabase/migrations/20261109_automatic_texts.sql.",
    }, { status: 500 });
  }
  if (!orgs?.length) return NextResponse.json({ ok: true, orgs: 0, sent: 0 });
  const orgName = new Map<string, string>(orgs.map((o) => [o.id as string, (o.name as string) || ""]));

  const { data: raw, error: jErr } = await supabase
    .from("jobs")
    .select("id, org_id, status, archived, client, property, customer_id, rooms, total, amount_paid, invoice_sent_at, invoice_reminder_count")
    .in("org_id", [...orgName.keys()])
    .eq("status", "invoiced")
    .not("invoice_sent_at", "is", null)
    .not("archived", "is", true)
    .or(`invoice_reminder_count.is.null,invoice_reminder_count.lt.${MAX_INVOICE_REMINDERS}`)
    .order("invoice_sent_at", { ascending: true })
    .limit(500);
  if (jErr) {
    return NextResponse.json({
      error: jErr.message,
      hint: "jobs.invoice_* columns are missing — run supabase/migrations/20261109_automatic_texts.sql.",
    }, { status: 500 });
  }

  const now = Date.now();
  const due = ((raw || []) as JobRow[])
    .map((j) => ({ j, step: invoiceReminderDue(j, now) }))
    .filter((x): x is { j: JobRow; step: number } => x.step !== null)
    .slice(0, MAX_PER_RUN);
  if (!due.length) return NextResponse.json({ ok: true, dry, due: 0, sent: 0 });

  const custIds = [...new Set(due.map((x) => x.j.customer_id).filter(Boolean) as string[])];
  const { data: custRows } = custIds.length
    ? await supabase.from("customers").select("id, type, name, phone, email").in("id", custIds)
    : { data: [] };
  const customers = new Map<string, RecipientCustomer>(
    ((custRows || []) as (RecipientCustomer & { id: string })[]).map((c) => [c.id, c]),
  );

  const results: { job_id: string; step: number; via: InvoiceChannel | "skipped"; error?: string }[] = [];

  for (const { j, step } of due) {
    const cust = j.customer_id ? customers.get(j.customer_id) : undefined;
    const pm = isPropertyManager(cust);
    const channel = invoiceChannel({ propertyManager: pm, consent: smsConsentGranted(j.rooms), phone: cust?.phone, email: cust?.email });
    if (dry) { results.push({ job_id: j.id, step, via: channel }); continue; }

    // Built before the claim: if signing throws (secret unset) nothing is spent.
    const link = `${siteOrigin()}/status?job=${encodeURIComponent(j.id)}&t=${encodeURIComponent(signJobToken(j.id))}`;

    const prev = Math.max(0, Math.floor(Number(j.invoice_reminder_count) || 0));
    let claim = supabase
      .from("jobs")
      .update({ invoice_reminder_count: step, invoice_reminder_at: new Date(now).toISOString() })
      .eq("id", j.id)
      .eq("status", "invoiced");
    claim = prev === 0
      ? claim.or("invoice_reminder_count.is.null,invoice_reminder_count.eq.0")
      : claim.eq("invoice_reminder_count", prev);
    const { data: claimed } = await claim.select("id");
    if (!claimed?.length) { results.push({ job_id: j.id, step, via: "skipped" }); continue; }

    const business = orgName.get(j.org_id) || "";
    const amount = balanceDue(j);
    const to = textRecipient("invoice", j, cust);
    const msg = textBody("invoice", {
      role: pm ? "property_manager" : "customer",
      name: to.ok ? to.name : cust?.name || j.client,
      business,
      property: j.property,
      amount,
      link,
    });

    let via: InvoiceChannel = "owner";
    let error: string | undefined;
    try {
      if (channel === "sms" && to.ok) {
        const r = await sendLoggedSms(supabase, { orgId: j.org_id, jobId: j.id, to: to.phone, body: msg, kind: "invoice", role: to.role });
        if (r.ok) via = "sms"; else error = `SMS: ${r.error}`;
      }
      if (via === "owner" && channel !== "owner" && (cust?.email || "").includes("@")) {
        const r = await sendEmail(cust!.email as string, `Payment reminder from ${business || "us"}`, msg);
        if (r.ok) via = "email"; else error = `${error ? error + "; " : ""}Email: ${r.error}`;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    results.push({ job_id: j.id, step, via, ...(error ? { error } : {}) });

    const who = cust?.name || j.client || "the customer";
    const where = j.property || "a job";
    const ord = `${step} of ${MAX_INVOICE_REMINDERS}`;
    await notifyManagers(supabase, {
      orgId: j.org_id,
      jobId: j.id,
      type: "invoice_reminder",
      title: via === "owner" ? "Invoice reminder needed" : via === "sms" ? "Invoice reminder texted" : "Invoice reminder emailed",
      body: via === "owner"
        ? `$${amount.toFixed(2)} is still due from ${who} for ${where}. It couldn't go out automatically (no text consent or email on file), so reach out yourself.`
        : `${via === "sms" ? "Texted" : "Emailed"} ${who} about the $${amount.toFixed(2)} still due for ${where} (reminder ${ord}).`,
    });
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
