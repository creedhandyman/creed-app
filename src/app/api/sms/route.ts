import { NextRequest, NextResponse } from "next/server";
import { getAuthedProfile, requireAuth, serviceClient } from "@/lib/api-auth";
import { sendSms, smsConfigured } from "@/lib/sms";
import { sendLoggedSms } from "@/lib/sms-log";
import { pickedRecipient, textRecipient, type MessagePick, type SmsKind } from "@/lib/sms-recipient";
import { textBody } from "@/lib/sms-templates";
import { signJobToken } from "@/lib/job-token";
import { siteOrigin } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * Server-side Twilio SMS send (logged-in staff only). Two shapes:
 *
 * 1. Job text (the one-tap On the way / Running late / Job done buttons):
 *      { jobId, kind: "enroute" | "late" | "complete", body?, minutes? }
 *    The SERVER picks the number (lib/sms-recipient: the resident on a
 *    property-manager job, else the customer) so the phone can't aim a text
 *    anywhere. `body` is the owner's edited draft; without it the server
 *    writes the text (lib/sms-templates). Requires the business's
 *    "Text from the business number" switch (organizations.auto_sms_enroute).
 *    Skips numbers that replied STOP and logs to sms_messages (lib/sms-log).
 *
 * 2. Job message (the job card's Text chip and the Message customer button):
 *      { jobId, kind: "message", recipient: "client" | "resident", body }
 *    The owner's own words, sent to the contact they picked in the send
 *    strip. The number still comes from the job (lib/sms-recipient
 *    pickedRecipient), never from the phone. Same switch, STOP check and log.
 *
 * 3. Legacy { to, body }: kept for the share-card and customer screens.
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID
 * (or TWILIO_FROM_NUMBER).
 */
const JOB_KINDS: SmsKind[] = ["enroute", "late", "complete"];

interface Body {
  to?: string;
  body?: string;
  jobId?: string;
  kind?: string;
  minutes?: number;
  recipient?: string;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  if (body.jobId && body.kind) return jobText(req, body);

  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await sendSms(body.to || "", body.body || "");
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, sid: result.sid });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("sms error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function jobText(req: NextRequest, body: Body): Promise<NextResponse> {
  const prof = await getAuthedProfile(req);
  if (!prof || !prof.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isMessage = body.kind === "message";
  const kind = body.kind as SmsKind;
  if (!isMessage && !JOB_KINDS.includes(kind)) return NextResponse.json({ error: "Unknown text type" }, { status: 400 });
  const pick: MessagePick = body.recipient === "resident" ? "resident" : "client";
  const draft = typeof body.body === "string" ? body.body.trim().slice(0, 1000) : "";
  if (isMessage && !draft) return NextResponse.json({ error: "Write a message first" }, { status: 400 });
  if (!smsConfigured()) {
    return NextResponse.json({ error: "Texting isn't set up on the server yet (Twilio settings missing)." }, { status: 503 });
  }

  const supabase = serviceClient();
  const { data: org, error: oErr } = await supabase
    .from("organizations").select("id, name, auto_sms_enroute").eq("id", prof.orgId).maybeSingle();
  if (oErr || !org) {
    return NextResponse.json({ error: "Run the automatic texts migration first (see CLAUDE.md)." }, { status: 409 });
  }
  if ((org as { auto_sms_enroute?: boolean }).auto_sms_enroute !== true) {
    return NextResponse.json({ error: "Texting from the business number is off. Turn it on in Ops, Business settings, Automatic Texts." }, { status: 409 });
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("id, org_id, property, client, customer_id, rooms, total")
    .eq("id", String(body.jobId))
    .eq("org_id", prof.orgId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { data: customer } = job.customer_id
    ? await supabase.from("customers").select("type, name, phone, email").eq("id", job.customer_id).eq("org_id", prof.orgId).maybeSingle()
    : { data: null };

  const to = isMessage ? pickedRecipient(pick, job, customer) : textRecipient(kind, job, customer);
  if (!to.ok) return NextResponse.json({ error: to.message, reason: to.reason }, { status: 422 });

  let link = "";
  if (!isMessage && to.role !== "resident") {
    try {
      link = `${siteOrigin()}/status?job=${encodeURIComponent(job.id)}&t=${encodeURIComponent(signJobToken(job.id))}`;
    } catch {
      link = "";
    }
  }
  const text = draft || textBody(kind, {
    role: to.role,
    name: to.name,
    business: (org as { name?: string | null }).name,
    property: job.property,
    minutes: Number(body.minutes) || undefined,
    amount: Number(job.total) || 0,
    link,
  });

  const r = await sendLoggedSms(supabase, {
    orgId: prof.orgId,
    jobId: job.id,
    to: to.phone,
    body: text,
    kind: isMessage ? "message" : kind,
    role: to.role,
    sentBy: prof.userId,
  });
  if (!r.ok) return NextResponse.json({ error: r.error, ...(r.skipped ? { reason: r.skipped } : {}) }, { status: r.status || 500 });
  return NextResponse.json({ ok: true, role: to.role, name: to.name, last4: to.phone.slice(-4) });
}
