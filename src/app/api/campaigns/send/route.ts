import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import { isAudience, renderCampaignEmail } from "@/lib/campaigns";
import {
  ORG_CAMPAIGN_COLS,
  campaignFrom,
  queueCampaign,
  resendConfigured,
  sendBlockers,
  type OrgForCampaign,
} from "@/lib/campaigns-server";
import { sendEmail } from "@/lib/email";
import { siteOrigin } from "@/lib/site-url";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/campaigns/send { id, test?: true, scheduledFor?: ISO }
 *
 * test: emails ONE copy to the signed-in owner's own address (subject starts
 *   "[Test]"), so they can see it in a real inbox. Customers get nothing.
 * otherwise: builds the recipient list now and queues it; the cron at
 *   /api/campaigns/dispatch sends it at scheduledFor (default: now, picked up
 *   within 15 minutes). Needs campaigns turned on, a business address and
 *   Resend set up. Owner/manager only.
 */
export async function POST(req: NextRequest) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  const b = (await req.json().catch(() => ({}))) as { id?: unknown; test?: unknown; scheduledFor?: unknown };
  if (typeof b.id !== "string" || !b.id) return NextResponse.json({ error: "Missing campaign" }, { status: 400 });

  const sb = serviceClient();
  const { data: c } = await sb.from("campaigns").select("*").eq("id", b.id).eq("org_id", auth.orgId!).maybeSingle();
  if (!c) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  const { data: orgRow } = await sb.from("organizations").select(ORG_CAMPAIGN_COLS).eq("id", auth.orgId!).maybeSingle();
  const org = orgRow as OrgForCampaign | null;
  if (!org) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  if (b.test === true) {
    if (!resendConfigured()) return NextResponse.json({ error: "Email sending isn't set up on the server yet (RESEND_API_KEY)." }, { status: 400 });
    if (!auth.email) return NextResponse.json({ error: "Your login has no email to send the test to." }, { status: 400 });
    const businessName = (org.name || "").trim() || "Your contractor";
    const mail = renderCampaignEmail({
      subject: c.subject || "(no subject)",
      body: c.body || "",
      customerName: "Alex Sample",
      businessName,
      address: org.address || "(your business address goes here)",
      unsubscribeUrl: `${siteOrigin()}/u/test`,
      referralLink: org.referrals_enabled && org.site_slug ? `${siteOrigin()}/lead/${org.site_slug}?ref=sample123` : undefined,
    });
    const r = await sendEmail(auth.email, `[Test] ${mail.subject}`, mail.text, mail.html, {
      from: campaignFrom(businessName),
      replyTo: org.email && org.email.includes("@") ? org.email : undefined,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    return NextResponse.json({ ok: true, test: true, to: auth.email });
  }

  if (c.status !== "draft") return NextResponse.json({ error: "This campaign was already sent or scheduled." }, { status: 409 });
  if (!isAudience(c.audience)) return NextResponse.json({ error: "Pick who it goes to." }, { status: 400 });
  const blockers = sendBlockers(org, c);
  if (blockers.length) return NextResponse.json({ error: blockers[0], problems: blockers }, { status: 400 });

  let when = new Date();
  if (typeof b.scheduledFor === "string" && b.scheduledFor) {
    const t = new Date(b.scheduledFor);
    if (Number.isNaN(t.getTime())) return NextResponse.json({ error: "That send time isn't a date." }, { status: 400 });
    if (t.getTime() > Date.now() + 90 * 86400_000) return NextResponse.json({ error: "Pick a time in the next 90 days." }, { status: 400 });
    if (t.getTime() > when.getTime()) when = t;
  }
  try {
    const { count } = await queueCampaign(sb, { orgId: auth.orgId!, campaignId: c.id, audience: c.audience, scheduledFor: when.toISOString() });
    if (!count) {
      await sb.from("campaigns").update({ status: "sent", sent_at: new Date().toISOString(), recipient_count: 0 }).eq("id", c.id);
    }
    return NextResponse.json({ ok: true, count, scheduledFor: when.toISOString() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't queue the campaign" }, { status: 500 });
  }
}
