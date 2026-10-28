import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

/**
 * Stripe subscription → org mapping for the ORG's own plan billing. Shared by
 * the webhook (customer.subscription.* / checkout.session.completed) and the
 * webhook-independent /api/stripe/verify-subscription, so the two can't drift.
 */

/**
 * Resolve a Stripe price ID back to one of our plan names. We compare
 * against the three STRIPE_PRICE_* env vars Bernard sets on Vercel.
 * Falls back to the subscription's metadata.plan when the env-var
 * comparison fails (e.g. price IDs were rotated since the trial start).
 */
export function planFromSubscription(sub: Stripe.Subscription): string | null {
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

/**
 * Map Stripe subscription.status to our org.subscription_status.
 * - trialing  → "trialing"   (rest of the free trial — see lib/trial.ts)
 * - active    → "active"
 * - past_due  → "past_due"
 * - unpaid    → "past_due"   (treat the same way — billing failed)
 * - canceled  → "canceled"
 * - incomplete / incomplete_expired / paused → "past_due"
 *
 * Kept narrow on purpose: the BillingGate component reads these strings,
 * so adding a status here means adding a case there too.
 */
export function statusFromStripe(s: Stripe.Subscription.Status): string {
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

/**
 * The organizations patch a subscription implies: status + sub id, the plan
 * (mirrored to the legacy `plan` column — old UI still reads it) when it maps,
 * and trial_ends_at when the sub has a trial.
 */
export function orgUpdateFromSubscription(sub: Stripe.Subscription): Record<string, unknown> {
  const update: Record<string, unknown> = {
    subscription_status: statusFromStripe(sub.status),
    stripe_subscription_id: sub.id,
  };
  const plan = planFromSubscription(sub);
  if (plan) {
    update.subscription_plan = plan;
    update.plan = plan;
  }
  if (sub.trial_end) update.trial_ends_at = new Date(sub.trial_end * 1000).toISOString();
  return update;
}

/**
 * Find an org id for a subscription using whatever identifier we have:
 * the Checkout session's org_id (verify-subscription has it), the sub's
 * metadata (stamped by us), then stripe_subscription_id, then
 * stripe_customer_id. null = nothing matches — the caller logs and skips.
 */
export async function findOrgIdForSub(
  supabase: SupabaseClient,
  sub: Stripe.Subscription,
  sessionOrgId?: string | null,
): Promise<string | null> {
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
