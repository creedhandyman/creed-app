import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import { membershipFeePercent } from "@/lib/platform-fee";
import { stripeRecurring } from "@/lib/memberships";
import { siteOrigin } from "@/lib/site-url";
import type { MembershipPlan, Customer, Organization } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/memberships/checkout  { customerId, planId }
 *
 * Owner-initiated enrollment. Creates a Stripe SUBSCRIPTION Checkout session
 * (hosted card capture — never in-app) for the customer to pay through. The
 * subscription is a DESTINATION charge: it lives on the platform account but
 * routes each payment to the org's connected account via transfer_data, with
 * the Creed application fee (0.5%, 0 for Pro) — the same money model as the
 * one-time job-payment flow. The customer_memberships row is created by the
 * webhook on checkout.session.completed.
 */
export async function POST(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;
  const orgId = prof.orgId!;
  try {
    const { customerId, planId } = (await req.json()) as { customerId?: string; planId?: string };
    if (!customerId || !planId) {
      return NextResponse.json({ error: "Missing customerId or planId" }, { status: 400 });
    }
    const supabase = serviceClient();

    const { data: orgRow } = await supabase
      .from("organizations")
      .select("id, name, stripe_account_id, subscription_plan")
      .eq("id", orgId)
      .single();
    const org = orgRow as Organization | null;
    const stripeAccountId = org?.stripe_account_id || "";
    if (!stripeAccountId) {
      return NextResponse.json(
        { error: "Connect your Stripe account (Operations → Billing) before selling memberships." },
        { status: 400 },
      );
    }

    const { data: planRow } = await supabase
      .from("membership_plans")
      .select("id, org_id, name, price, interval, is_active, stripe_price_id")
      .eq("id", planId)
      .eq("org_id", orgId)
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
      .eq("id", customerId)
      .eq("org_id", orgId)
      .single();
    const customer = custRow as Customer | null;
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    // Reuse the plan's Stripe Price, or create the Product + recurring Price
    // once. Stripe Prices are immutable, so the plan editor clears
    // stripe_price_id whenever price/interval changes → a fresh Price here.
    let priceId = plan.stripe_price_id || "";
    if (!priceId) {
      const product = await stripe.products.create({
        name: plan.name || "Service plan",
        metadata: { org_id: orgId, plan_id: plan.id },
      });
      const price = await stripe.prices.create({
        product: product.id,
        currency: "usd",
        unit_amount: Math.round(Number(plan.price) * 100),
        recurring: stripeRecurring(plan.interval),
        metadata: { org_id: orgId, plan_id: plan.id },
      });
      priceId = price.id;
      await supabase.from("membership_plans").update({ stripe_price_id: priceId }).eq("id", plan.id);
    }

    const feePercent = membershipFeePercent(org?.subscription_plan ?? null);
    const origin = siteOrigin();
    const meta = { membership: "1", org_id: orgId, plan_id: plan.id, customer_id: customer.id };

    const session = await stripe.checkout.sessions.create({
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
      success_url: `${origin}/membership/thanks?plan=${encodeURIComponent(plan.name || "")}`,
      cancel_url: `${origin}/membership/thanks?canceled=1`,
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
