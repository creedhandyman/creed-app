import { NextRequest, NextResponse } from "next/server";
import { getAuthedProfile, serviceClient } from "@/lib/api-auth";
import { smsConfigured } from "@/lib/sms";
import { sendLoggedSms } from "@/lib/sms-log";
import { checkReply, summarizeThreads } from "@/lib/sms-threads";
import { openThread } from "@/lib/sms-threads-server";

export const dynamic = "force-dynamic";

/**
 * POST /api/sms/reply { phone, body }: answer a conversation on the Texts
 * screen from the business number. Always the business number, whatever the
 * Ops "Text and Message customer buttons send from" setting says, because the
 * conversation lives there.
 *
 * The number must already be a conversation the caller can open
 * (lib/sms-threads-server openThread), so this can't text an arbitrary
 * number; replying to an unknown number is fine because they texted first.
 * Same path as every other business text (lib/sms-log sendLoggedSms): the
 * STOP list is checked and the reply is logged on the conversation, on its
 * newest job.
 */
export async function POST(req: NextRequest) {
  let body: { phone?: unknown; body?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const words = checkReply(body.body);
  if (!words.ok) return NextResponse.json({ error: words.error }, { status: 400 });

  const supabase = serviceClient();
  const o = await openThread(supabase, await getAuthedProfile(req), body.phone);
  if (!o.ok) return NextResponse.json({ error: o.error }, { status: o.status });

  if (!smsConfigured()) {
    return NextResponse.json({ error: "Texting isn't set up on the server yet (Twilio settings missing)." }, { status: 503 });
  }
  const { data: org } = await supabase.from("organizations").select("auto_sms_enroute").eq("id", o.viewer.orgId).maybeSingle();
  if ((org as { auto_sms_enroute?: boolean } | null)?.auto_sms_enroute !== true) {
    return NextResponse.json({ error: "Texting from the business number is off. Turn it on in Ops, Business settings, Automatic Texts." }, { status: 409 });
  }

  const [t] = summarizeThreads(o.rows);
  const r = await sendLoggedSms(supabase, {
    orgId: o.viewer.orgId,
    jobId: t.jobId,
    customerId: t.customerId,
    to: o.phone,
    body: words.text,
    kind: "message",
    role: t.role,
    sentBy: o.viewer.userId,
  });
  if (!r.ok) return NextResponse.json({ error: r.error, ...(r.skipped ? { reason: r.skipped } : {}) }, { status: r.status || 500 });
  return NextResponse.json({ ok: true });
}
