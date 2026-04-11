import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("account_id");
  const orgId = req.nextUrl.searchParams.get("org_id");

  if (!accountId || !orgId) {
    return NextResponse.redirect(new URL("/?stripe=error", req.url));
  }

  try {
    // Verify the account is set up
    const account = await stripe.accounts.retrieve(accountId);

    if (account.charges_enabled) {
      // Account is ready — save to org
      await supabase
        .from("organizations")
        .update({ stripe_account_id: accountId, stripe_connected: true })
        .eq("id", orgId);

      return NextResponse.redirect(new URL("/?stripe=success", req.url));
    } else {
      // Account setup incomplete — save ID but mark not connected
      await supabase
        .from("organizations")
        .update({ stripe_account_id: accountId, stripe_connected: false })
        .eq("id", orgId);

      return NextResponse.redirect(new URL("/?stripe=pending", req.url));
    }
  } catch {
    return NextResponse.redirect(new URL("/?stripe=error", req.url));
  }
}
