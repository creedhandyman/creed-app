import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// User needs to re-do onboarding (link expired)
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("account_id");
  const orgId = req.nextUrl.searchParams.get("org_id");

  if (!accountId || !orgId) {
    return NextResponse.redirect(new URL("/?stripe=error", req.url));
  }

  try {
    const origin = req.headers.get("origin") || new URL(req.url).origin;
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/api/stripe/refresh?account_id=${accountId}&org_id=${orgId}`,
      return_url: `${origin}/api/stripe/callback?account_id=${accountId}&org_id=${orgId}`,
      type: "account_onboarding",
    });

    return NextResponse.redirect(accountLink.url);
  } catch {
    return NextResponse.redirect(new URL("/?stripe=error", req.url));
  }
}
