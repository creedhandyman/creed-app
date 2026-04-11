import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { orgId, orgName, email, returnUrl } = await req.json();

    if (!orgId) {
      return NextResponse.json({ error: "Missing org ID" }, { status: 400 });
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    const account = await stripe.accounts.create({
      type: "standard",
      email: email || undefined,
      business_profile: {
        name: orgName || undefined,
      },
    });

    const origin = returnUrl || req.headers.get("origin") || "http://localhost:3000";
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${origin}/api/stripe/refresh?account_id=${account.id}&org_id=${orgId}`,
      return_url: `${origin}/api/stripe/callback?account_id=${account.id}&org_id=${orgId}`,
      type: "account_onboarding",
    });

    return NextResponse.json({
      accountId: account.id,
      url: accountLink.url,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
