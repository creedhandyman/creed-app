import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("account_id");
  const orgId = req.nextUrl.searchParams.get("org_id");
  const origin = new URL(req.url).origin;

  if (!accountId || !orgId) {
    return NextResponse.redirect(new URL("/?stripe=error", origin));
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    // Only re-issue onboarding links for an account we created for THIS org.
    const account = await stripe.accounts.retrieve(accountId);
    if (account.metadata?.org_id !== orgId) {
      return NextResponse.redirect(new URL("/?stripe=error", origin));
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/api/stripe/refresh?account_id=${accountId}&org_id=${orgId}`,
      return_url: `${origin}/api/stripe/callback?account_id=${accountId}&org_id=${orgId}`,
      type: "account_onboarding",
    });

    return NextResponse.redirect(accountLink.url);
  } catch {
    return NextResponse.redirect(new URL("/?stripe=error", origin));
  }
}
