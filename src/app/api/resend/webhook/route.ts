import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { EVENT_COLUMN, verifySvix } from "@/lib/resend-webhook";

export const dynamic = "force-dynamic";

/**
 * Resend webhook (set up in Resend → Webhooks, pointing here, with the
 * signing secret in RESEND_WEBHOOK_SECRET). Fails closed: no secret or a bad
 * signature = 401. Stamps delivered / opened / clicked / bounced /
 * complained on the campaign email it's about (matched by Resend's email id).
 * A spam complaint also marks that customer "don't email" so they never get
 * another campaign. Emails that aren't campaigns are ignored.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const ok = verifySvix({
    secret: process.env.RESEND_WEBHOOK_SECRET,
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
    body,
  });
  if (!ok) return NextResponse.json({ error: "Bad signature" }, { status: 401 });

  let evt: { type?: string; created_at?: string; data?: { email_id?: string } };
  try { evt = JSON.parse(body); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }
  const col = EVENT_COLUMN[String(evt.type)];
  const emailId = evt.data?.email_id;
  if (!col || !emailId) return NextResponse.json({ ok: true, ignored: true });

  const sb = serviceClient();
  const at = evt.created_at && !Number.isNaN(Date.parse(evt.created_at)) ? evt.created_at : new Date().toISOString();
  const { data: rows } = await sb
    .from("campaign_sends").update({ [col]: at }).eq("resend_id", emailId).is(col, null).select("customer_id");
  if (evt.type === "email.complained" && rows?.length) {
    const ids = (rows as { customer_id: string }[]).map((r) => r.customer_id);
    await sb.from("customers").update({ email_unsubscribed_at: at }).in("id", ids).is("email_unsubscribed_at", null);
  }
  return NextResponse.json({ ok: true });
}
