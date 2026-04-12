import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const { action, orgId, orgName, email, plan, returnUrl } = await req.json();

    if (action === "create-checkout") {
      // Create or get Stripe customer
      let customerId = "";
      const { data: org } = await supabase.from("organizations").select("stripe_customer_id").eq("id", orgId).single();

      if (org?.stripe_customer_id) {
        customerId = org.stripe_customer_id;
      } else {
        const customer = await stripe.customers.create({
          email,
          name: orgName,
          metadata: { org_id: orgId },
        });
        customerId = customer.id;
        await supabase.from("organizations").update({ stripe_customer_id: customerId }).eq("id", orgId);
      }

      // Price IDs — create these in Stripe Dashboard
      // For now, use dynamic pricing
      const plans: Record<string, { name: string; amount: number; users: string }> = {
        solo: { name: "Solo", amount: 4900, users: "1 user" },
        team: { name: "Team", amount: 9900, users: "up to 5 users" },
        business: { name: "Business", amount: 14900, users: "up to 10 users" },
      };
      const p = plans[plan] || plans.solo;

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: `Creed App — ${p.name} Plan (${p.users})` },
            unit_amount: p.amount,
            recurring: { interval: "month" },
          },
          quantity: 1,
        }],
        mode: "subscription",
        success_url: `${returnUrl || "http://localhost:3000"}/?billing=success`,
        cancel_url: `${returnUrl || "http://localhost:3000"}/?billing=cancel`,
        metadata: { org_id: orgId },
      });

      return NextResponse.json({ url: session.url });
    }

    if (action === "create-portal") {
      const { data: org } = await supabase.from("organizations").select("stripe_customer_id").eq("id", orgId).single();
      if (!org?.stripe_customer_id) {
        return NextResponse.json({ error: "No billing account found" }, { status: 400 });
      }

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: org.stripe_customer_id,
        return_url: returnUrl || "http://localhost:3000",
      });

      return NextResponse.json({ url: portalSession.url });
    }

    if (action === "check-status") {
      const { data: org } = await supabase
        .from("organizations")
        .select("trial_start,subscription_status,billing_enforced,plan")
        .eq("id", orgId)
        .single();

      if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 });

      const trialStart = new Date(org.trial_start);
      const trialEnd = new Date(trialStart);
      trialEnd.setDate(trialEnd.getDate() + 30);
      const trialDaysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

      return NextResponse.json({
        status: org.subscription_status || "trial",
        trialDaysLeft,
        trialEnd: trialEnd.toISOString().split("T")[0],
        plan: org.plan || "solo",
        enforced: org.billing_enforced || false,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
