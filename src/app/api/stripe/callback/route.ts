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
    // Treat "onboarding finished" as connected for UI purposes — charges_enabled
    // can lag a few minutes while Stripe verifies. details_submitted means the
    // user finished the onboarding flow, which is what the UI should react to.
    const detailsDone = !!account.details_submitted;
    const chargesReady = !!account.charges_enabled;
    const connected = detailsDone || chargesReady;

    const { error } = await supabase
      .from("organizations")
      .update({ stripe_account_id: accountId, stripe_connected: connected })
      .eq("id", orgId);

    if (error) {
      console.error("Supabase update error:", error);
      return NextResponse.redirect(new URL(`/?stripe=error&reason=db_update_failed`, origin));
    }

    // Success when charges are live; pending when onboarding done but verification
    // still in progress; error/restart if they bailed early.
    const status = chargesReady ? "success" : detailsDone ? "pending" : "error";
    return NextResponse.redirect(new URL(`/?stripe=${status}`, origin));
  } catch (e) {
    console.error("Stripe callback error:", e);
    return NextResponse.redirect(new URL("/?stripe=error&reason=exception", origin));
  }
}
