import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { PAYMENT_PROVIDER_STRIPE } from "./stripe-checkout";

/**
 * Card on file, Stripe adapter. A customer ticks "save my card" at checkout;
 * Stripe keeps the card on Creed's PLATFORM account (a Stripe Customer with a
 * saved PaymentMethod) and Creed stores only brand / last 4 / expiry for
 * display, plus what the customer agreed to. The owner or a manager can then
 * charge it for what's owed on a job: an off-session DESTINATION charge to the
 * business's connected account, the same money routing and platform fee as a
 * checkout payment.
 *
 * Rules:
 *  - Only when the business turned it on (organizations.card_on_file_enabled).
 *  - Only cards are saved (setup_future_usage on the card option), never a
 *    bank account.
 *  - A charge is never more than the job's balance, and is idempotent per
 *    (job, amount, paid-to-date): a double tap or a retry can't charge twice.
 *  - A decline or a card that needs the customer to confirm falls back to a
 *    pay link; nothing retries on its own.
 */

export const CARD_CONSENT_VERSION = "2026-11-09";

/** What the customer agrees to; shown beside the box and stored with the card. */
export function cardConsentText(orgName: string): string {
  const who = (orgName || "").trim() || "this business";
  return `Save my card with ${who} so they can charge it for work I've approved. I can ask them to remove it at any time.`;
}

export interface SavedCardInfo {
  paymentMethodId: string;
  brand: string;
  last4: string;
  exp: string;
}

/** Display details of a saved card, or null for anything that isn't a card. */
export function savedCardFromPaymentMethod(pm: unknown): SavedCardInfo | null {
  const p = pm as { id?: string; type?: string; card?: { brand?: string; last4?: string; exp_month?: number; exp_year?: number } } | null;
  if (!p || typeof p !== "object" || !p.id || p.type !== "card" || !p.card?.last4) return null;
  const mm = String(p.card.exp_month ?? "").padStart(2, "0");
  const yy = String(p.card.exp_year ?? "").slice(-2);
  return {
    paymentMethodId: p.id,
    brand: String(p.card.brand || "card"),
    last4: String(p.card.last4),
    exp: mm && yy ? `${mm}/${yy}` : "",
  };
}

/** "Visa ••4242" style label for a saved card. */
export function savedCardLabel(brand?: string | null, last4?: string | null): string {
  if (!last4) return "";
  const b = String(brand || "card");
  const nice = b === "amex" ? "Amex" : b.charAt(0).toUpperCase() + b.slice(1);
  return `${nice} ••${last4}`;
}

/**
 * After a paid checkout where the customer ticked "save my card": read the
 * card off the PaymentIntent and store it on the customer row. Best-effort and
 * never throws: the payment is already recorded, a failed save only means the
 * card isn't on file.
 */
export async function saveCardFromCheckout(
  supabase: SupabaseClient,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  try {
    const meta = (session.metadata as Record<string, string> | null) || {};
    if (meta.save_card !== "1" || !meta.customer_id || !meta.org_id) return false;
    const stripeCustomerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!stripeCustomerId || !piId) return false;

    const pi = await stripe.paymentIntents.retrieve(piId, { expand: ["payment_method"] });
    const card = savedCardFromPaymentMethod(pi.payment_method);
    if (!card) return false; // paid by bank transfer, or no card attached

    // The card it replaces, so it can be detached in Stripe (best-effort).
    const { data: prev } = await supabase
      .from("customers").select("card_payment_method_id")
      .eq("id", meta.customer_id).eq("org_id", meta.org_id).maybeSingle();
    const oldPm = (prev as { card_payment_method_id?: string | null } | null)?.card_payment_method_id;

    const { error } = await supabase
      .from("customers")
      .update({
        stripe_customer_id: stripeCustomerId,
        card_payment_method_id: card.paymentMethodId,
        card_brand: card.brand,
        card_last4: card.last4,
        card_exp: card.exp,
        card_saved_at: new Date().toISOString(),
        card_consent: {
          version: meta.card_consent_version || CARD_CONSENT_VERSION,
          text: cardConsentText(meta.org_name || ""),
          session_id: session.id,
          accepted_at: new Date((Number(session.created) || Date.now() / 1000) * 1000).toISOString(),
        },
      })
      .eq("id", meta.customer_id)
      .eq("org_id", meta.org_id);
    if (error) {
      console.error("[saved-card] couldn't store the card:", error.message);
      return false;
    }
    if (oldPm && oldPm !== card.paymentMethodId) {
      await stripe.paymentMethods.detach(oldPm).catch(() => { /* already gone */ });
    }
    return true;
  } catch (e) {
    console.error("[saved-card] save failed:", e);
    return false;
  }
}

/**
 * Forget a customer's saved card: detach it in Stripe (so it can't be charged
 * again) and clear it from the customer row. Org-scoped.
 */
export async function removeSavedCard(
  supabase: SupabaseClient,
  stripe: Stripe | null,
  orgId: string,
  customerId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase
    .from("customers").select("id, card_payment_method_id")
    .eq("id", customerId).eq("org_id", orgId).maybeSingle();
  if (error) return { ok: false, error: "Card on file isn't set up yet." };
  if (!data) return { ok: false, error: "Customer not found" };
  const pm = (data as { card_payment_method_id?: string | null }).card_payment_method_id;
  if (pm && stripe) {
    try {
      await stripe.paymentMethods.detach(pm);
    } catch (e) {
      // Already detached is fine; anything else means it could still be
      // charged, so keep the row as it is and say so.
      const code = (e as { code?: string })?.code;
      if (code !== "resource_missing" && !/not attached/i.test(String((e as Error)?.message))) {
        console.error("[saved-card] detach failed:", e);
        return { ok: false, error: "Couldn't remove the card just now. Please try again." };
      }
    }
  }
  const { error: upErr } = await supabase
    .from("customers")
    .update({
      card_payment_method_id: null, card_brand: null, card_last4: null, card_exp: null,
      card_saved_at: null, card_consent: null,
    })
    .eq("id", customerId).eq("org_id", orgId);
  if (upErr) return { ok: false, error: "Couldn't remove the card just now. Please try again." };
  return { ok: true };
}

export interface SavedCardChargeInput {
  job: { id: string; org_id: string; property?: string | null; client?: string | null };
  orgName: string;
  destinationAccountId: string;
  stripeCustomerId: string;
  paymentMethodId: string;
  amountCents: number;
  platformFeeCents: number;
  kind: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StripeIntentParams = Record<string, any>;

/** PaymentIntent for charging a saved card off-session. Pure. */
export function buildSavedCardChargeParams(i: SavedCardChargeInput): StripeIntentParams {
  const amountCents = Math.max(0, Math.round(i.amountCents));
  const feeCents = Math.max(0, Math.round(i.platformFeeCents));
  return {
    amount: amountCents,
    currency: "usd",
    customer: i.stripeCustomerId,
    payment_method: i.paymentMethodId,
    off_session: true,
    confirm: true,
    description: `${i.orgName} · ${i.job.property || "Job"}`,
    transfer_data: { destination: i.destinationAccountId },
    ...(feeCents > 0 ? { application_fee_amount: feeCents } : {}),
    metadata: {
      job_id: i.job.id,
      org_id: i.job.org_id,
      property: i.job.property || "",
      client: i.job.client || "",
      platform_fee_cents: String(feeCents),
      amount_cents: String(amountCents),
      tip_cents: "0",
      kind: i.kind,
      provider: PAYMENT_PROVIDER_STRIPE,
      card_on_file: "1",
    },
  };
}

/**
 * One key per (job, amount, paid-to-date): a double tap or a retry after a
 * save failure returns the same charge, while the next real charge (paid-to-
 * date has moved) gets a new key.
 */
export function savedCardChargeKey(jobId: string, amountCents: number, paidCents: number): string {
  return `card-on-file:${jobId}:${Math.round(amountCents)}:${Math.round(paidCents)}`;
}

/** Plain words for the owner when a saved-card charge doesn't go through. */
export function savedCardFailureMessage(err: unknown): string {
  const e = err as { code?: string; decline_code?: string; type?: string } | null;
  if (e?.code === "authentication_required") {
    return "The customer's bank wants them to confirm this charge. Send them a pay link instead.";
  }
  if (e?.code === "expired_card") return "The saved card has expired. Send the customer a pay link instead.";
  if (e?.type === "StripeCardError" || e?.code === "card_declined") {
    return "The card was declined. Send the customer a pay link instead.";
  }
  return "Couldn't charge the card just now. Trying again won't charge twice, or send the customer a pay link.";
}
