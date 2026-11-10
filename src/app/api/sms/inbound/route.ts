import { after, NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { normalizePhone } from "@/lib/sms";
import { clearOptOut, isOptedOut, recordOptOut } from "@/lib/sms-log";
import { isYes, keywordOf, photosFrom } from "@/lib/sms-inbound";
import { alertOptOut, alertReply, matchInbound, saveInbound, savePhotos } from "@/lib/sms-inbound-server";
import { formParams, validTwilioSignature } from "@/lib/twilio-signature";
import { siteOrigin } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * Twilio "A message comes in" webhook (set it on the Messaging Service to
 * https://www.creedhm.com/api/sms/inbound, HTTP POST).
 *
 *  - Rejects anything without a valid X-Twilio-Signature.
 *  - Works out whose text it is (lib/sms-inbound pickMatch: the business that
 *    texted that number, else a customer or resident with that number) and
 *    saves it on sms_messages as direction 'in' (migration
 *    20261110_text_replies.sql). Twilio retries are saved once (by MessageSid).
 *  - STOP words: the number goes on sms_opt_outs (Twilio also blocks it and
 *    sends its own confirmation, so we reply with nothing) + a bell note.
 *  - START words: the number comes off sms_opt_outs ("Yes" only counts from
 *    a number that opted out; from anyone else it's an ordinary reply).
 *  - HELP: replies with the business name and how to stop.
 *  - Anything else: after replying to Twilio, photos are copied into storage
 *    and onto the job, and owners, managers and the job's crew get a bell
 *    notification + app push (never a text). One alert per 5-minute burst.
 * Before the migration runs nothing is saved, but the alert still goes out.
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
  const to = normalizePhone(params.To);
  const text = (params.Body || "").trim();
  const sid = params.MessageSid || params.SmsSid || "";
  const photos = photosFrom(params);
  if (!from) return twiml();

  const supabase = serviceClient();
  // "Yes" is START only from a number that opted out; otherwise it's a reply.
  const keyword = keywordOf(text, isYes(text) && (await isOptedOut(supabase, from)));
  const match = await matchInbound(supabase, from);
  const saved = await saveInbound(supabase, { sid, from, to, body: text, kind: keyword || "reply", match });
  if (saved.duplicate) return twiml(); // Twilio retry of a text we already handled

  if (keyword === "stop") {
    await recordOptOut(supabase, from, "stop_reply", match.orgId);
    after(() => alertOptOut(supabase, from, match));
    return twiml();
  }
  if (keyword === "start") {
    await clearOptOut(supabase, from);
    return twiml();
  }
  if (keyword === "help") {
    let business = "";
    if (match.orgId) {
      const { data: org } = await supabase.from("organizations").select("name").eq("id", match.orgId).maybeSingle();
      business = (org as { name?: string | null } | null)?.name || "";
    }
    return twiml(`${business || "This number"} sends job updates and reminders. Reply STOP to stop texts.`);
  }

  if (text || photos.length) {
    after(async () => {
      const stored = await savePhotos(supabase, {
        sid,
        messageId: saved.id,
        orgId: match.orgId,
        jobId: match.jobId,
        photos,
      });
      await alertReply(supabase, { from, text, photoCount: stored.length || photos.length, match, messageId: saved.id });
    });
  }
  return twiml();
}
