import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * POST /api/stripe/create-checkout-session
 *
 * Starts a Stripe Checkout Session for the new-customer signup flow.
 * The org row already exists at this point (created by /signup); we
 * look up or create the Stripe Customer, then hand off to Stripe with
 * a 30-day trial attached to the subscription.
 *
 * Body: { orgId: string, plan: "solo" | "crew" | "pro", returnUrl?: string }
 * Returns: { url: string } — redirect target the client opens.
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_PRICE_SOLO, STRIPE_PRICE_CREW, STRIPE_PRICE_PRO
 */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Plan = "solo" | "crew" | "pro";

const PRICE_ENV: Record<Plan, string> = {
  solo: "STRIPE_PRICE_SOLO",
  crew: "STRIPE_PRICE_CREW",
  pro:  "STRIPE_PRICE_PRO",
};

export async function POST(req: NextRequest) {
  try {
    const { orgId, plan, returnUrl } = (await req.json()) as {
      orgId?: string;
      plan?: Plan;
      returnUrl?: string;
    };

    if (!orgId) {
      return NextResponse.json({ error: "Missing orgId" }, { status: 400 });
    }
    if (!plan || !(plan in PRICE_ENV)) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }
    const priceId = process.env[PRICE_ENV[plan]];
    if (!priceId) {
      return NextResponse.json(
        { error: `Missing env ${PRICE_ENV[plan]} — set it in Vercel before this plan is purchasable` },
        { status: 500 },
      );
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    // Fetch the org so we can attach name + email to the Stripe Customer
    // and reuse an existing stripe_customer_id if one is already on file.
    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .select("id, name, email, stripe_customer_id, stripe_subscription_id")
      .eq("id", orgId)
      .single();

    if (orgErr || !org) {
      return NextResponse.json({ error: "Org not found" }, { status: 404 });
    }

    let customerId = org.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: org.email || undefined,
        name: org.name || undefined,
        metadata: { org_id: orgId },
      });
      customerId = customer.id;
      await supabase
        .from("organizations")
        .update({ stripe_customer_id: customerId })
        .eq("id", orgId);
    }

    const origin = returnUrl || req.headers.get("origin") || "https://www.creedhm.com";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      // 30-day trial. Card required upfront — `payment_method_collection`
      // defaults to "always" for subscription mode but we set it
      // explicitly so anyone reading the call knows what to expect.
      payment_method_collection: "always",
      subscription_data: {
        trial_period_days: 30,
        metadata: { org_id: orgId, plan },
      },
      // Stripe-recommended toggle: lets the customer remove and re-add
      // the discount field even if no promo code applied, which makes
      // upgrading from /pricing's referral codes cleaner later.
      allow_promotion_codes: true,
      // Mirror the metadata on the session itself so the
      // `checkout.session.completed` webhook can still recover org_id
      // even if the subscription metadata round-trip lags.
      metadata: { org_id: orgId, plan },
      success_url: `${origin}/onboarding/done?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/onboarding?step=plan&plan=${plan}`,
    });

    if (!session.url) {
      return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 502 });
    }

    return NextResponse.json({ url: session.url });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
