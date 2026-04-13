import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("account_id");
  const orgId = req.nextUrl.searchParams.get("org_id");
  const origin = new URL(req.url).origin;

  if (!accountId || !orgId) {
    return NextResponse.redirect(new URL("/?stripe=error&reason=missing_params", origin));
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.redirect(new URL("/?stripe=error&reason=no_stripe_key", origin));
    }
    const stripe = new Stripe(stripeKey);

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return NextResponse.redirect(new URL("/?stripe=error&reason=no_service_key", origin));
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey
    );

    const account = await stripe.accounts.retrieve(accountId);
    const connected = !!account.charges_enabled;

    const { error } = await supabase
      .from("organizations")
      .update({ stripe_account_id: accountId, stripe_connected: connected })
      .eq("id", orgId);

    if (error) {
      console.error("Supabase update error:", error);
      return NextResponse.redirect(new URL(`/?stripe=error&reason=db_update_failed`, origin));
    }

    return NextResponse.redirect(new URL(`/?stripe=${connected ? "success" : "pending"}`, origin));
  } catch (e) {
    console.error("Stripe callback error:", e);
    return NextResponse.redirect(new URL("/?stripe=error&reason=exception", origin));
  }
}
