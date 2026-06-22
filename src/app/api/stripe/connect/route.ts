import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/stripe/connect
 *
 * Starts Stripe Connect onboarding for the caller's OWN org (owner/manager
 * only; org resolved from the session, not the body). The created account is
 * stamped with metadata.org_id so /api/stripe/callback can verify the returning
 * account genuinely belongs to this org — without that, anyone could rebind a
 * victim org's payout account to an attacker's.
 *
 * Body: { orgName?, email?, returnUrl? }   Returns: { accountId, url }
 */
export async function POST(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;
  const orgId = prof.orgId!;

  try {
    const { orgName, email, returnUrl } = (await req.json().catch(() => ({}))) as {
      orgName?: string;
      email?: string;
      returnUrl?: string;
    };

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    const account = await stripe.accounts.create({
      type: "standard",
      email: email || prof.email || undefined,
      business_profile: { name: orgName || undefined },
      metadata: { org_id: orgId },
    });

    const origin = returnUrl || req.headers.get("origin") || "http://localhost:3000";
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${origin}/api/stripe/refresh?account_id=${account.id}&org_id=${orgId}`,
      return_url: `${origin}/api/stripe/callback?account_id=${account.id}&org_id=${orgId}`,
      type: "account_onboarding",
    });

    return NextResponse.json({ accountId: account.id, url: accountLink.url });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
