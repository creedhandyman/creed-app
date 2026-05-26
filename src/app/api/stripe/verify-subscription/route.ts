import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

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
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Keep these mappings IDENTICAL to the webhook handler
// (src/app/api/stripe/webhook/route.ts). If you change one, change both.
function planFromSubscription(sub: Stripe.Subscription): string | null {
  const priceId = sub.items?.data?.[0]?.price?.id;
  if (priceId) {
    if (priceId === process.env.STRIPE_PRICE_SOLO) return "solo";
    if (priceId === process.env.STRIPE_PRICE_CREW) return "crew";
    if (priceId === process.env.STRIPE_PRICE_PRO)  return "pro";
  }
  const fromMeta = (sub.metadata as Record<string, string> | undefined)?.plan;
  if (fromMeta === "solo" || fromMeta === "crew" || fromMeta === "pro") return fromMeta;
  return null;
}

function statusFromStripe(s: Stripe.Subscription.Status): string {
  switch (s) {
    case "active":   return "active";
    case "trialing": return "trialing";
    case "canceled": return "canceled";
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "incomplete_expired":
    case "paused":
      return "past_due";
    default: return "active";
  }
}

async function findOrgIdForSub(
  sub: Stripe.Subscription,
  sessionOrgId?: string | null
): Promise<string | null> {
  // Session metadata is the most reliable — we stamped it ourselves in
  // create-checkout-session and it's available right here.
  if (sessionOrgId) return sessionOrgId;
  const fromMeta = (sub.metadata as Record<string, string> | undefined)?.org_id;
  if (fromMeta) return fromMeta;

  const { data: bySubId } = await supabase
    .from("organizations")
    .select("id")
    .eq("stripe_subscription_id", sub.id)
    .single();
  if (bySubId) return bySubId.id;

  if (sub.customer) {
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const { data: byCust } = await supabase
      .from("organizations")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .single();
    if (byCust) return byCust.id;
  }
  return null;
}

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

    const sessionOrgId = (session.metadata as Record<string, string> | null)?.org_id;
    const orgId = await findOrgIdForSub(sub, sessionOrgId);
    if (!orgId) {
      console.warn("[verify-subscription] no org found for session", sessionId);
      return NextResponse.json({ error: "Org not found for session" }, { status: 404 });
    }

    const status = statusFromStripe(sub.status);
    const plan = planFromSubscription(sub);
    const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;

    const update: Record<string, unknown> = {
      subscription_status: status,
      stripe_subscription_id: sub.id,
    };
    if (plan) {
      update.subscription_plan = plan;
      update.plan = plan;
    }
    if (trialEnd !== null) update.trial_ends_at = trialEnd;

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
