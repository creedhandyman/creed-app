import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { normalizePhone } from "@/lib/sms";
import { clearOptOut, HELP_WORDS, OPT_IN_WORDS, OPT_OUT_WORDS, recordOptOut } from "@/lib/sms-log";
import { formParams, validTwilioSignature } from "@/lib/twilio-signature";
import { notifyManagers } from "@/lib/notify-server";
import { siteOrigin } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * Twilio "A message comes in" webhook (set it on the Messaging Service to
 * https://www.creedhm.com/api/sms/inbound, HTTP POST).
 *
 *  - Rejects anything without a valid X-Twilio-Signature.
 *  - STOP words: the number goes on sms_opt_outs (Twilio also blocks it and
 *    sends its own confirmation, so we reply with nothing).
 *  - START words: the number comes off sms_opt_outs.
 *  - HELP: replies with the business name and how to stop.
 *  - Anything else: the owner/managers of the business that last texted that
 *    number get an in-app notification with the reply, linked to the job.
 */
const twiml = (msg?: string) =>
  new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${escapeXml(msg)}</Message>` : ""}</Response>`,
    { status: 200, headers: { "Content-Type": "text/xml" } },
  );

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string);
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const params = formParams(raw);
  const url = `${siteOrigin()}/api/sms/inbound`;
  if (!validTwilioSignature(process.env.TWILIO_AUTH_TOKEN, req.headers.get("x-twilio-signature"), url, params)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 403 });
  }

  const from = normalizePhone(params.From);
  const text = (params.Body || "").trim();
  const word = text.toUpperCase().replace(/[^A-Z]/g, "");
  if (!from) return twiml();

  const supabase = serviceClient();
  // The business that last texted this number (sms_messages), for routing.
  const { data: last } = await supabase
    .from("sms_messages")
    .select("org_id, job_id")
    .eq("to_phone", from)
    .order("created_at", { ascending: false })
    .limit(1);
  const orgId = (last?.[0]?.org_id as string | undefined) || null;
  const jobId = (last?.[0]?.job_id as string | undefined) || null;

  if (OPT_OUT_WORDS.includes(word)) {
    await recordOptOut(supabase, from, "stop_reply", orgId);
    return twiml();
  }
  if (OPT_IN_WORDS.includes(word)) {
    await clearOptOut(supabase, from);
    return twiml();
  }

  let business = "";
  if (orgId) {
    const { data: org } = await supabase.from("organizations").select("name").eq("id", orgId).maybeSingle();
    business = (org as { name?: string | null } | null)?.name || "";
  }
  if (HELP_WORDS.includes(word)) {
    return twiml(`${business || "This number"} sends job updates and reminders. Reply STOP to stop texts.`);
  }

  if (orgId && text) {
    await notifyManagers(supabase, {
      orgId,
      jobId,
      type: "text_reply",
      title: "Customer texted back",
      body: `From the number ending ${from.slice(-4)}: ${text.slice(0, 300)}`,
    });
  }
  return twiml();
}
