import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifySession, PORTAL_COOKIE_NAME } from "@/lib/portal-session";
import { membershipFeePercent } from "@/lib/platform-fee";
import { stripeRecurring } from "@/lib/memberships";
import { siteOrigin } from "@/lib/site-url";
import type { MembershipPlan, Customer, Organization } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/membership-checkout  { planId }
 *
 * Customer SELF-SERVE enrollment from the portal's "Join" upsell card.
 * Mirrors the owner-initiated /api/memberships/checkout (hosted subscription
 * Checkout, destination charge to the org's connected account, identical
 * metadata so the existing webhook creates the customer_memberships row) —
 * but authed by the portal-session cookie: the customer enrolls THEMSELVES,
 * and customer_id comes from the session, never the request body.
 */
export async function POST(req: NextRequest) {
  const session = verifySession(req.cookies.get(PORTAL_COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const { planId } = (await req.json()) as { planId?: string };
    if (!planId) return NextResponse.json({ error: "Missing planId" }, { status: 400 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // One live membership per customer — the upsell only renders with none,
    // but re-check server-side so a stale tab can't double-enroll.
    const { data: existing } = await supabase
      .from("customer_memberships")
      .select("id")
      .eq("customer_id", session.customer_id)
      .eq("org_id", session.org_id)
      .neq("status", "cancelled")
      .limit(1);
    if (existing?.length) {
      return NextResponse.json({ error: "You already have a membership — manage it from the portal." }, { status: 400 });
    }

    const { data: orgRow } = await supabase
      .from("organizations")
      .select("id, name, stripe_account_id, subscription_plan")
      .eq("id", session.org_id)
      .single();
    const org = orgRow as Organization | null;
    const stripeAccountId = org?.stripe_account_id || "";
    if (!stripeAccountId) {
      return NextResponse.json({ error: "This business isn't set up for online membership payments yet." }, { status: 400 });
    }

    const { data: planRow } = await supabase
      .from("membership_plans")
      .select("id, org_id, name, price, interval, is_active, stripe_price_id")
      .eq("id", planId)
      .eq("org_id", session.org_id)
      .single();
    const plan = planRow as MembershipPlan | null;
    if (!plan || plan.is_active === false) {
      return NextResponse.json({ error: "Plan not found or inactive" }, { status: 404 });
    }
    if (!(Number(plan.price) > 0)) {
      return NextResponse.json({ error: "Plan price must be greater than $0" }, { status: 400 });
    }

    const { data: custRow } = await supabase
      .from("customers")
      .select("id, org_id, name, email")
      .eq("id", session.customer_id)
      .eq("org_id", session.org_id)
      .single();
    const customer = custRow as Customer | null;
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    // Reuse the plan's Stripe Price, or lazily create Product + Price once —
    // same logic as /api/memberships/checkout (kept in sync by hand; the plan
    // editor clears stripe_price_id on price/interval edits either way).
    let priceId = plan.stripe_price_id || "";
    if (!priceId) {
      const product = await stripe.products.create({
        name: plan.name || "Service plan",
        metadata: { org_id: session.org_id, plan_id: plan.id },
      });
      const price = await stripe.prices.create({
        product: product.id,
        currency: "usd",
        unit_amount: Math.round(Number(plan.price) * 100),
        recurring: stripeRecurring(plan.interval),
        metadata: { org_id: session.org_id, plan_id: plan.id },
      });
      priceId = price.id;
      await supabase.from("membership_plans").update({ stripe_price_id: priceId }).eq("id", plan.id);
    }

    const feePercent = membershipFeePercent(org?.subscription_plan ?? null);
    const origin = siteOrigin();
    const meta = { membership: "1", org_id: session.org_id, plan_id: plan.id, customer_id: session.customer_id };

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: customer.email && customer.email.includes("@") ? customer.email : undefined,
      payment_method_collection: "always",
      subscription_data: {
        transfer_data: { destination: stripeAccountId },
        metadata: meta,
        ...(feePercent > 0 ? { application_fee_percent: feePercent } : {}),
      },
      metadata: meta,
      success_url: `${origin}/portal?joined=1`,
      cancel_url: `${origin}/portal`,
    });

    if (!checkout.url) {
      return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 502 });
    }
    return NextResponse.json({ url: checkout.url });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("portal/membership-checkout error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
