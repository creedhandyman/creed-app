/**
 * Payment layer, Stripe adapter: builds the Checkout session for a customer's
 * job payment (deposit / balance / invoice). PURE — no Stripe client, no I/O —
 * so the money rules are tested and the route stays a thin shell.
 *
 * Why a layer: Creed takes job payments through Stripe today, but a second
 * processor (for example Banccard's split payments) may come later. Anything
 * processor-specific about a job checkout lives here; the rules that are NOT
 * processor-specific stay outside it (platform fee: lib/platform-fee.ts, tips:
 * lib/tips.ts, what's owed: /api/checkout + lib/pay-plan.ts). A second
 * processor would add its own builder beside this one and record
 * payments.provider accordingly.
 *
 * Money rules enforced here:
 *  - The tip is its own line item and its own metadata field (tip_cents). The
 *    platform fee is computed by the caller on the JOB amount only and passed
 *    in, so it's never taken on a tip.
 *  - Bank transfer (us_bank_account) is offered only when the business turned
 *    it on. A bank payment finishes with payment_status "unpaid" and settles
 *    days later (checkout.session.async_payment_succeeded), so the metadata
 *    carries everything fulfillment needs then.
 */

export const PAYMENT_PROVIDER_STRIPE = "stripe";

export interface JobCheckoutInput {
  job: { id: string; org_id: string; property?: string | null; client?: string | null };
  orgName: string;
  /** Connected account that receives the money (from the job's org, never the body). */
  destinationAccountId: string;
  /** What this payment charges for the job, in cents (already clamped to the balance). */
  amountCents: number;
  /** Tip in cents (0 = none). Kept apart from amountCents. */
  tipCents: number;
  /** Creed's fee on amountCents (0 = none: Pro plan or monthly cap reached). */
  platformFeeCents: number;
  /** deposit | balance | payment — the ledger classification. */
  kind: string;
  /** Offer bank transfer (ACH) as well as card. */
  allowBankTransfer: boolean;
  /** The customer ticked "save my card" (card on file, lib/payments/saved-card.ts).
   *  stripeCustomerId = their existing Stripe Customer, if any; otherwise
   *  Checkout creates one. Only the card is saved, never a bank account. */
  saveCard?: { customerId: string; stripeCustomerId?: string | null; consentVersion: string } | null;
  successUrl: string;
  cancelUrl: string;
  /** Unix seconds. */
  expiresAt: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StripeSessionParams = Record<string, any>;

export function buildJobCheckoutParams(i: JobCheckoutInput): StripeSessionParams {
  const amountCents = Math.max(0, Math.round(i.amountCents));
  const tipCents = Math.max(0, Math.round(i.tipCents));
  const feeCents = Math.max(0, Math.round(i.platformFeeCents));

  const lineItems: StripeSessionParams[] = [
    {
      price_data: {
        currency: "usd",
        product_data: {
          name: `Property Repairs — ${i.job.property || "Job"}`,
          description: `${i.orgName} · Invoice for ${i.job.client || "Client"}`,
        },
        unit_amount: amountCents,
      },
      quantity: 1,
    },
  ];
  if (tipCents > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: { name: "Tip", description: `Thank you for tipping ${i.orgName}` },
        unit_amount: tipCents,
      },
      quantity: 1,
    });
  }

  const params: StripeSessionParams = {
    payment_method_types: i.allowBankTransfer ? ["card", "us_bank_account"] : ["card"],
    line_items: lineItems,
    mode: "payment",
    expires_at: i.expiresAt,
    success_url: i.successUrl,
    cancel_url: i.cancelUrl,
    metadata: {
      job_id: i.job.id,
      org_id: i.job.org_id,
      property: i.job.property || "",
      client: i.job.client || "",
      // Stored so fulfillment can record the fee without recomputing.
      platform_fee_cents: String(feeCents),
      // The JOB part of the charge. Fulfillment subtracts tip_cents from
      // Stripe's amount_total, and falls back to this.
      amount_cents: String(amountCents),
      tip_cents: String(tipCents),
      kind: i.kind,
      provider: PAYMENT_PROVIDER_STRIPE,
    },
    // Route the money to the business's connected account. application_fee_amount
    // is omitted entirely when 0: Stripe rejects a 0 fee on destination charges.
    payment_intent_data: {
      transfer_data: { destination: i.destinationAccountId },
      ...(feeCents > 0 ? { application_fee_amount: feeCents } : {}),
    },
  };

  if (i.allowBankTransfer) {
    // Instant verification through the customer's bank login, falling back to
    // micro-deposits; Stripe's default, stated so it's visible.
    params.payment_method_options = {
      us_bank_account: { verification_method: "automatic" },
    };
  }

  if (i.saveCard?.customerId) {
    // Save the CARD for later off-session charges. Set on the card option, not
    // the whole PaymentIntent, so a bank transfer is never saved.
    params.payment_method_options = {
      ...(params.payment_method_options || {}),
      card: { setup_future_usage: "off_session" },
    };
    if (i.saveCard.stripeCustomerId) params.customer = i.saveCard.stripeCustomerId;
    else params.customer_creation = "always";
    params.metadata.save_card = "1";
    params.metadata.customer_id = i.saveCard.customerId;
    params.metadata.card_consent_version = i.saveCard.consentVersion;
    params.metadata.org_name = i.orgName;
  }

  return params;
}
