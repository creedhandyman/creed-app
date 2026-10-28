import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import {
  findOrgIdForSub,
  orgUpdateFromSubscription,
  planFromSubscription,
  statusFromStripe,
} from "@/lib/stripe-subscription";

export const dynamic = "force-dynamic";

/**
 * POST /api/stripe/verify-subscription
 *
 * Webhook-INDEPENDENT subscription activation. Called by the
 * /onboarding/done success page with the Checkout session_id right
 * after the customer finishes paying.
 *
 * Why this exists: subscription activation used to depend entirely on
 * the customer.subscription.* + checkout.session.completed webhooks.
 * If webhook delivery fails (e.g. the endpoint URL is on the wrong
 * domain and Stripe can't complete the TLS handshake), the org never
 * gets subscription_status / stripe_subscription_id / trial_ends_at
 * written, and billing silently breaks when the trial converts.
 *
 * This mirrors the proven /api/verify-payment pattern for job
 * payments: server-side retrieve the session + subscription from
 * Stripe (source of truth) and sync the org directly. Idempotent —
 * safe to call alongside the webhook; whichever lands first wins and
 * the other is a harmless no-op write.
 *
 * Body: { sessionId: string }
 * Returns: { ok: true, status, plan } | { error }
 */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// The subscription → org mapping is shared with the webhook handler via
// src/lib/stripe-subscription.ts, so the two can't drift.

export async function POST(req: NextRequest) {
  try {
    const { sessionId } = (await req.json()) as { sessionId?: string };
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    // Pull the completed Checkout Session and expand the subscription so
    // we have its status/plan/trial in one round-trip.
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });

    if (!session.subscription) {
      // Not a subscription checkout (or not finished). Nothing to sync.
      return NextResponse.json({ ok: false, reason: "no-subscription" });
    }

    const sub =
      typeof session.subscription === "string"
        ? await stripe.subscriptions.retrieve(session.subscription)
        : (session.subscription as Stripe.Subscription);

    // Session metadata is the most reliable — we stamped it ourselves in
    // create-checkout-session and it's available right here.
    const sessionOrgId = (session.metadata as Record<string, string> | null)?.org_id;
    const orgId = await findOrgIdForSub(supabase, sub, sessionOrgId);
    if (!orgId) {
      console.warn("[verify-subscription] no org found for session", sessionId);
      return NextResponse.json({ error: "Org not found for session" }, { status: 404 });
    }

    const status = statusFromStripe(sub.status);
    const plan = planFromSubscription(sub);
    const update = orgUpdateFromSubscription(sub);

    // Also persist the customer id if we somehow don't have it yet.
    if (sub.customer) {
      update.stripe_customer_id =
        typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    }

    await supabase.from("organizations").update(update).eq("id", orgId);

    return NextResponse.json({ ok: true, status, plan });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("verify-subscription error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
