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

    const body = await req.text();
    const sig = req.headers.get("stripe-signature");

    if (!sig) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("STRIPE_WEBHOOK_SECRET not configured — rejecting webhook");
      return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
    }

    // Always verify the signature — no dev-mode bypass.
    // For local testing, use `stripe listen --forward-to localhost:3000/api/stripe/webhook`
    // which sets STRIPE_WEBHOOK_SECRET via the CLI.
    const event = stripe.webhooks.constructEvent(body, sig, webhookSecret);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const orgId = session.metadata?.org_id;
        if (orgId && session.subscription) {
          await supabase.from("organizations").update({
            subscription_status: "active",
            stripe_subscription_id: session.subscription,
          }).eq("id", orgId);
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        // Find org by subscription ID or customer ID
        const status = sub.status; // active, past_due, canceled, unpaid, etc.
        const mapped = status === "active" ? "active"
          : status === "past_due" ? "past_due"
          : status === "canceled" ? "canceled"
          : status === "unpaid" ? "past_due"
          : "active";

        // Try by subscription ID first
        const { data: bySubId } = await supabase
          .from("organizations")
          .select("id")
          .eq("stripe_subscription_id", sub.id)
          .single();

        if (bySubId) {
          await supabase.from("organizations").update({
            subscription_status: mapped,
          }).eq("id", bySubId.id);
        } else {
          // Fallback: find by customer ID
          const { data: byCust } = await supabase
            .from("organizations")
            .select("id")
            .eq("stripe_customer_id", sub.customer)
            .single();
          if (byCust) {
            await supabase.from("organizations").update({
              subscription_status: mapped,
              stripe_subscription_id: sub.id,
            }).eq("id", byCust.id);
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const { data: org } = await supabase
          .from("organizations")
          .select("id")
          .eq("stripe_subscription_id", sub.id)
          .single();
        if (org) {
          await supabase.from("organizations").update({
            subscription_status: "canceled",
          }).eq("id", org.id);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const { data: org } = await supabase
          .from("organizations")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();
        if (org) {
          await supabase.from("organizations").update({
            subscription_status: "past_due",
          }).eq("id", org.id);
        }
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Webhook error:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
