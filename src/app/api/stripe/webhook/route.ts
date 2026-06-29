import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { computeNextFire } from "@/lib/recurring";
import { visitCadence } from "@/lib/memberships";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Resolve a Stripe price ID back to one of our plan names. We compare
 * against the three STRIPE_PRICE_* env vars Bernard sets on Vercel.
 * Falls back to the subscription's metadata.plan when the env-var
 * comparison fails (e.g. price IDs were rotated since the trial start).
 */
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

/**
 * Map Stripe subscription.status to our org.subscription_status.
 * - trialing  → "trialing"   (during the 30-day free trial)
 * - active    → "active"
 * - past_due  → "past_due"
 * - unpaid    → "past_due"   (treat the same way — billing failed)
 * - canceled  → "canceled"
 * - incomplete / incomplete_expired / paused → "past_due"
 *
 * Kept narrow on purpose: the BillingGate component reads these strings,
 * so adding a status here means adding a case there too.
 */
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

/**
 * Find an org id for a subscription event using whatever identifier
 * we have. Tries metadata first (cheapest, fired by us), then
 * subscription_id, then customer_id. Returns null if nothing matches —
 * the caller logs and skips the write.
 */
async function findOrgIdForSub(sub: Stripe.Subscription): Promise<string | null> {
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

/**
 * Single source of truth for subscription → org sync. Handles both the
 * created and updated lifecycle events so we don't have two near-duplicate
 * code paths drifting from each other.
 */
async function syncSubscriptionToOrg(sub: Stripe.Subscription): Promise<void> {
  const orgId = await findOrgIdForSub(sub);
  if (!orgId) {
    console.warn("[stripe webhook] no org found for subscription", sub.id);
    return;
  }

  const status = statusFromStripe(sub.status);
  const plan = planFromSubscription(sub);
  const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;

  // Mirror to legacy `plan` column too — old UI (BillingGate paywall plan
  // cards, the Operations admin dashboard) still reads `plan` rather than
  // `subscription_plan`. Writing both keeps a single source of truth
  // until the legacy reads are migrated.
  const update: Record<string, unknown> = {
    subscription_status: status,
    stripe_subscription_id: sub.id,
  };
  if (plan) {
    update.subscription_plan = plan;
    update.plan = plan;
  }
  if (trialEnd !== null) update.trial_ends_at = trialEnd;

  await supabase.from("organizations").update(update).eq("id", orgId);
}

// ── Memberships (customer service plans) ────────────────────────────────────
// Membership subscriptions are DESTINATION charges on the platform account, so
// they fire the SAME events as the org's own billing subscription. We tag them
// with metadata.membership === "1" so the two never cross wires.

function isMembershipSub(sub: Stripe.Subscription): boolean {
  return (sub.metadata as Record<string, string> | undefined)?.membership === "1";
}

function membershipStatusFromSub(sub: Stripe.Subscription): "active" | "past_due" | "paused" | "cancelled" {
  if (sub.pause_collection) return "paused";
  switch (sub.status) {
    case "active":
    case "trialing":
      return "active";
    case "canceled":
      return "cancelled";
    default:
      return "past_due";
  }
}

/** Tolerant accessor — current_period_end moved from the subscription to its
 *  items across Stripe API versions. */
function subPeriodEnd(sub: Stripe.Subscription): string | null {
  const top = (sub as unknown as { current_period_end?: number }).current_period_end;
  const item = (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
  const ts = typeof top === "number" ? top : item;
  return typeof ts === "number" ? new Date(ts * 1000).toISOString() : null;
}

function invoiceSubId(invoice: Stripe.Invoice): string | null {
  const sub = (invoice as unknown as { subscription?: string | { id: string } | null }).subscription;
  if (!sub) return null;
  return typeof sub === "string" ? sub : sub.id;
}

/** Idempotent (by subscription id) upsert of the customer_memberships row from a
 *  membership subscription — used on checkout.session.completed + subscription.updated. */
async function syncMembership(sub: Stripe.Subscription): Promise<void> {
  const meta = (sub.metadata as Record<string, string> | undefined) || {};
  const { org_id: orgId, plan_id: planId, customer_id: customerId } = meta;
  if (!orgId || !planId || !customerId) {
    console.warn("[stripe webhook] membership sub missing metadata", sub.id);
    return;
  }
  const status = membershipStatusFromSub(sub);
  const nextBill = subPeriodEnd(sub);

  const { data: existing } = await supabase
    .from("customer_memberships")
    .select("id")
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();

  if (existing) {
    const upd: Record<string, unknown> = { status };
    if (nextBill) upd.next_bill_at = nextBill;
    await supabase.from("customer_memberships").update(upd).eq("id", (existing as { id: string }).id);
    return;
  }

  // First activation — schedule the first auto-visit one cadence out.
  let nextVisit: string | null = null;
  try {
    const { data: plan } = await supabase
      .from("membership_plans")
      .select("visits_per_year")
      .eq("id", planId)
      .maybeSingle();
    const vpy = (plan as { visits_per_year?: number } | null)?.visits_per_year ?? 12;
    nextVisit = computeNextFire(new Date(), visitCadence(vpy)).toISOString();
  } catch {
    /* best-effort — the cron treats a null next_visit_at as due */
  }

  await supabase.from("customer_memberships").insert({
    org_id: orgId,
    customer_id: customerId,
    plan_id: planId,
    status,
    stripe_subscription_id: sub.id,
    started_at: new Date().toISOString(),
    next_bill_at: nextBill,
    next_visit_at: nextVisit,
  });
}

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
        const session = event.data.object as Stripe.Checkout.Session;
        const meta = (session.metadata as Record<string, string> | null) || {};
        if (session.subscription) {
          const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          // Pull the full subscription so we can sync plan/period in one place.
          const sub = await stripe.subscriptions.retrieve(subId);
          if (meta.membership === "1" || isMembershipSub(sub)) {
            await syncMembership(sub);
          } else if (meta.org_id) {
            await syncSubscriptionToOrg(sub);
          }
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        if (isMembershipSub(sub)) await syncMembership(sub);
        else await syncSubscriptionToOrg(sub);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        if (isMembershipSub(sub)) {
          await supabase
            .from("customer_memberships")
            .update({ status: "cancelled" })
            .eq("stripe_subscription_id", sub.id);
          break;
        }
        const orgId = await findOrgIdForSub(sub);
        if (orgId) {
          await supabase
            .from("organizations")
            .update({ subscription_status: "canceled" })
            .eq("id", orgId);
        }
        break;
      }

      case "invoice.paid":
      case "invoice.payment_succeeded": {
        // A membership renewal cleared — ensure it's marked active (recovers a
        // prior past_due). next_bill_at is refreshed by subscription.updated.
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoiceSubId(invoice);
        if (subId) {
          await supabase
            .from("customer_memberships")
            .update({ status: "active" })
            .eq("stripe_subscription_id", subId)
            .neq("status", "cancelled");
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoiceSubId(invoice);
        if (subId) {
          const { data: m } = await supabase
            .from("customer_memberships")
            .select("id")
            .eq("stripe_subscription_id", subId)
            .maybeSingle();
          if (m) {
            await supabase
              .from("customer_memberships")
              .update({ status: "past_due" })
              .eq("id", (m as { id: string }).id);
            break;
          }
        }
        // Org-billing fallback (existing behavior).
        const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        if (customerId) {
          const { data: org } = await supabase
            .from("organizations")
            .select("id")
            .eq("stripe_customer_id", customerId)
            .single();
          if (org) {
            await supabase
              .from("organizations")
              .update({ subscription_status: "past_due" })
              .eq("id", org.id);
          }
        }
        break;
      }

      case "charge.refunded": {
        // When a customer payment is refunded, reverse the platform fee
        // proportionally so the cap headroom is restored correctly.
        // Full refund → platform_fee_cents = 0.
        // Partial refund → prorate: keep fee × (1 − refundedFraction).
        const charge = event.data.object as Stripe.Charge;
        const piId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id;
        if (piId) {
          const { data: job } = await supabase
            .from("jobs")
            .select("id, platform_fee_cents")
            .eq("stripe_payment_intent_id", piId)
            .maybeSingle();
          if (job) {
            const isFullRefund = charge.refunded && charge.amount_refunded >= charge.amount;
            let newFeeCents: number;
            if (isFullRefund) {
              newFeeCents = 0;
            } else {
              // Prorate: preserve fee proportional to the amount NOT yet refunded.
              const keptFraction = (charge.amount - charge.amount_refunded) / charge.amount;
              newFeeCents = Math.round((Number(job.platform_fee_cents) || 0) * keptFraction);
            }
            await supabase
              .from("jobs")
              .update({ platform_fee_cents: newFeeCents })
              .eq("id", job.id);
          }
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
