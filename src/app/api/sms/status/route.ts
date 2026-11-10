import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { recordOptOut, TWILIO_UNSUBSCRIBED } from "@/lib/sms-log";
import { formParams, validTwilioSignature } from "@/lib/twilio-signature";
import { siteOrigin } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * Twilio delivery updates for texts sent through lib/sms-log (each send asks
 * for this callback). Updates sms_messages.status (queued, sent, delivered,
 * undelivered, failed) by Twilio's message id. A 21610 error means the number
 * replied STOP, so it goes on sms_opt_outs. Signature-checked.
 */
export async function POST(req: NextRequest) {
  const params = formParams(await req.text());
  const url = `${siteOrigin()}/api/sms/status`;
  if (!validTwilioSignature(process.env.TWILIO_AUTH_TOKEN, req.headers.get("x-twilio-signature"), url, params)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 403 });
  }
  const sid = params.MessageSid || params.SmsSid;
  const status = params.MessageStatus || params.SmsStatus;
  if (!sid || !status) return NextResponse.json({ ok: true });

  const supabase = serviceClient();
  const errorCode = Number(params.ErrorCode) || 0;
  const { data } = await supabase
    .from("sms_messages")
    .update({
      status,
      ...(errorCode ? { error: `Twilio error ${errorCode}` } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("twilio_sid", sid)
    .select("org_id, to_phone");
  if (errorCode === TWILIO_UNSUBSCRIBED && data?.[0]?.to_phone) {
    await recordOptOut(supabase, data[0].to_phone as string, "twilio_21610", (data[0].org_id as string) || null);
  }
  return NextResponse.json({ ok: true });
}
