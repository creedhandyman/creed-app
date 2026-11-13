import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import { availableCreditCents, referralLink, type CustomerReferral } from "@/lib/referrals";
import { siteOrigin } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * GET  /api/customers/marketing?id=<customerId>
 *   → the customer page's Email & referrals card: unsubscribed or not, how
 *     many campaigns they got, their referral link, who they referred, and
 *     the credit they have waiting.
 * POST /api/customers/marketing { id, action: "dont_email" }
 *   → mark them "don't email" (the owner's button). Can't be undone here,
 *     the same as the customer's own unsubscribe.
 * Owner/manager only, scoped to their business.
 */
export async function GET(req: NextRequest) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "Missing customer" }, { status: 400 });
  const sb = serviceClient();
  const { data: cust } = await sb
    .from("customers").select("id, email_unsubscribed_at, referral_code").eq("id", id).eq("org_id", auth.orgId!).maybeSingle();
  if (!cust) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  const { data: org } = await sb
    .from("organizations").select("referrals_enabled, site_slug, site_published").eq("id", auth.orgId!).maybeSingle();
  const o = org as { referrals_enabled?: boolean; site_slug?: string | null; site_published?: boolean | null } | null;

  const [{ count: campaignsReceived }, { data: given }, { data: received }] = await Promise.all([
    sb.from("campaign_sends").select("id", { count: "exact", head: true }).eq("customer_id", id).eq("status", "sent"),
    sb.from("customer_referrals").select("*").eq("org_id", auth.orgId!).eq("referrer_customer_id", id).order("created_at", { ascending: false }),
    sb.from("customer_referrals").select("referrer_customer_id").eq("org_id", auth.orgId!).eq("referred_customer_id", id).limit(1),
  ]);
  const rows = (given || []) as CustomerReferral[];
  const nameIds = Array.from(new Set([
    ...rows.map((r) => r.referred_customer_id),
    ...((received || []) as { referrer_customer_id: string }[]).map((r) => r.referrer_customer_id),
  ]));
  const names: Record<string, string> = {};
  if (nameIds.length) {
    const { data: ns } = await sb.from("customers").select("id, name").in("id", nameIds);
    for (const n of (ns || []) as { id: string; name: string | null }[]) names[n.id] = n.name || "Customer";
  }
  const referredBy = (received || [])[0] as { referrer_customer_id: string } | undefined;
  return NextResponse.json({
    unsubscribed_at: cust.email_unsubscribed_at,
    campaigns_received: campaignsReceived || 0,
    referrals_enabled: !!o?.referrals_enabled,
    link: o?.referrals_enabled && o ? referralLink(siteOrigin(), o, cust.referral_code) : null,
    referrals: rows.map((r) => ({ ...r, referred_name: names[r.referred_customer_id] || "Customer" })),
    credit_cents: availableCreditCents(rows),
    referred_by: referredBy ? { id: referredBy.referrer_customer_id, name: names[referredBy.referrer_customer_id] || "Customer" } : null,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  const b = (await req.json().catch(() => ({}))) as { id?: unknown; action?: unknown };
  if (typeof b.id !== "string" || b.action !== "dont_email") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const sb = serviceClient();
  const { data, error } = await sb
    .from("customers")
    .update({ email_unsubscribed_at: new Date().toISOString() })
    .eq("id", b.id).eq("org_id", auth.orgId!).is("email_unsubscribed_at", null)
    .select("id, email_unsubscribed_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await sb.from("campaign_sends").update({ status: "skipped", error: "Unsubscribed" })
    .eq("customer_id", b.id).eq("org_id", auth.orgId!).eq("status", "queued");
  return NextResponse.json({ ok: true, unsubscribed_at: data?.[0]?.email_unsubscribed_at ?? null });
}
