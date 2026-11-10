import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { computeNextFire } from "@/lib/recurring";
import { visitCadence } from "@/lib/memberships";
import { fulfillJobPayment, paymentFromCheckoutSession, recordJobRefund } from "@/lib/payment-fulfillment";
import { stripeExcessRefunder } from "@/lib/stripe-refund";
import { notifyBankPayment } from "@/lib/bank-payment-notify";
import { saveCardFromCheckout, savedCardPaymentFromIntent } from "@/lib/payments/saved-card";
import { findOrgIdForSub, orgUpdateFromSubscription } from "@/lib/stripe-subscription";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Single source of truth for subscription → org sync. Handles both the
 * created and updated lifecycle events so we don't have two near-duplicate
 * code paths drifting from each other. The mapping itself (plan / status /
 * trial, mirrored to the legacy `plan` column) is lib/stripe-subscription.ts,
 * shared with /api/stripe/verify-subscription.
 */
async function syncSubscriptionToOrg(sub: Stripe.Subscription): Promise<void> {
  const orgId = await findOrgIdForSub(supabase, sub);
  if (!orgId) {
    console.warn("[stripe webhook] no org found for subscription", sub.id);
    return;
  }
  await supabase.from("organizations").update(orgUpdateFromSubscription(sub)).eq("id", orgId);
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

/**
 * Record a paid Checkout session against its job (deposit / balance / invoice,
 * card or a cleared bank transfer). Returns a 500 response when the charge went
 * through but couldn't be saved, so Stripe RETRIES the event (it does, for up
 * to 3 days); null otherwise. Retrying is safe: the ledger insert is
 * idempotent on the session id.
 */
async function fulfillCheckoutJobPayment(
  session: Stripe.Checkout.Session,
  stripe: Stripe,
): Promise<NextResponse | null> {
  const meta = (session.metadata as Record<string, string> | null) || {};
  const pay = paymentFromCheckoutSession(session);
  try {
    await fulfillJobPayment(supabase, {
      jobId: meta.job_id,
      expectOrgId: pay.orgId,
      sessionId: pay.sessionId,
      paymentIntentId: pay.paymentIntentId,
      paidNow: pay.paidNow,
      platformFeeCents: pay.platformFeeCents,
      kind: pay.kind,
      tipCents: pay.tipCents,
      source: "webhook",
      refundExcess: stripeExcessRefunder(stripe),
    });
    return null;
  } catch (e) {
    console.error("[webhook] one-time payment fulfillment failed:", e);
    return NextResponse.json({ error: "Payment not recorded yet, retry" }, { status: 500 });
  }
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
        } else if (meta.job_id && session.payment_status === "paid") {
          // One-time job payment (deposit / balance / invoice). Fulfill here TOO,
          // idempotently (via the UNIQUE session id), so a customer who closes
          // the tab before /payment/success runs still gets their payment
          // recorded — the redirect is no longer the only fulfillment path.
          // Unknown job / org mismatch => silently skipped, as before.
          const failed = await fulfillCheckoutJobPayment(session, stripe);
          if (failed) return failed;
          // "Save my card" ticked: keep the card on the customer (best-effort).
          await saveCardFromCheckout(supabase, stripe, session);
        } else if (meta.job_id && session.payment_status === "unpaid") {
          // Bank transfer (ACH): the customer authorized it but the money takes
          // a few business days to clear. Nothing is recorded on the job yet —
          // checkout.session.async_payment_succeeded records it. Tell the owner
          // it's coming so they don't chase the customer meanwhile.
          const pay = paymentFromCheckoutSession(session);
          if (pay.orgId && pay.jobId) {
            await notifyBankPayment(supabase, { jobId: pay.jobId, orgId: pay.orgId, amount: pay.paidNow, stage: "started" });
          }
        }
        break;
      }

      case "checkout.session.async_payment_succeeded": {
        // A bank transfer cleared. Record it exactly like a card payment
        // (idempotent on the session id, so a resent event records once).
        const session = event.data.object as Stripe.Checkout.Session;
        const meta = (session.metadata as Record<string, string> | null) || {};
        if (meta.job_id && session.payment_status === "paid") {
          const failed = await fulfillCheckoutJobPayment(session, stripe);
          if (failed) return failed;
        }
        break;
      }

      case "payment_intent.succeeded": {
        // A saved-card charge from the job screen. The charge route records it
        // itself; this catches one whose request died after Stripe charged.
        // Idempotent on the PaymentIntent id (the route's ledger key too).
        // Checkout's own PaymentIntents carry no card_on_file and are skipped.
        const pi = event.data.object as Stripe.PaymentIntent;
        const pay = savedCardPaymentFromIntent(pi);
        if (pay) {
          try {
            await fulfillJobPayment(supabase, {
              jobId: pay.jobId,
              expectOrgId: pay.orgId,
              sessionId: pi.id,
              paymentIntentId: pi.id,
              paidNow: pay.paidNow,
              platformFeeCents: pay.platformFeeCents,
              kind: pay.kind,
              source: "webhook",
              refundExcess: stripeExcessRefunder(stripe),
            });
          } catch (e) {
            console.error("[webhook] saved-card charge not recorded:", e);
            return NextResponse.json({ error: "Payment not recorded yet, retry" }, { status: 500 });
          }
        }
        break;
      }

      case "checkout.session.async_payment_failed": {
        // A bank transfer didn't go through: nothing was recorded, so the job
        // still owes it. Alert the owner.
        const session = event.data.object as Stripe.Checkout.Session;
        const pay = paymentFromCheckoutSession(session);
        if (pay.jobId && pay.orgId) {
          await notifyBankPayment(supabase, { jobId: pay.jobId, orgId: pay.orgId, amount: pay.paidNow, stage: "failed" });
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
        const orgId = await findOrgIdForSub(supabase, sub);
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
          // Fee proration, the negative ledger row (one per PaymentIntent,
          // upserted) and the paid → invoiced recompute — org-scoped, in
          // lib/payment-fulfillment.ts next to recordJobPayment. The ledger part
          // is best-effort inside it (never fails the webhook).
          await recordJobRefund(supabase, {
            paymentIntentId: piId,
            chargeCents: charge.amount,
            refundedCents: charge.amount_refunded,
            fullyRefunded: charge.refunded,
          });
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
