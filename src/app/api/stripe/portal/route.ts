import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * POST /api/stripe/portal
 *
 * Mints a Stripe Customer Portal session URL for the logged-in org
 * owner. Used by the Settings → Billing "Manage subscription" button
 * to let the owner swap payment methods, see invoices, change plan,
 * and cancel/resume — without us implementing any of that UI.
 *
 * Body: { orgId: string, returnUrl?: string }
 * Returns: { url: string }
 */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { orgId, returnUrl } = (await req.json()) as {
      orgId?: string;
      returnUrl?: string;
    };

    if (!orgId) {
      return NextResponse.json({ error: "Missing orgId" }, { status: 400 });
    }

    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .select("stripe_customer_id")
      .eq("id", orgId)
      .single();

    if (orgErr || !org) {
      return NextResponse.json({ error: "Org not found" }, { status: 404 });
    }
    if (!org.stripe_customer_id) {
      return NextResponse.json(
        { error: "No billing account on file — subscribe first to enable the portal." },
        { status: 400 },
      );
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    const origin = returnUrl || req.headers.get("origin") || "https://www.creedhm.com";

    const portal = await stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: origin,
    });

    return NextResponse.json({ url: portal.url });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
