import type Stripe from "stripe";
import type { FulfillPaymentInput } from "./payment-fulfillment";

/**
 * The overpayment refunder handed to fulfillJobPayment by the two card paths
 * (/api/verify-payment and the Stripe webhook). Job charges are DESTINATION
 * charges (checkout routes them to the org's connected account), so the refund
 * pulls the money back from that account (reverse_transfer) and returns
 * Creed's fee on the refunded part (refund_application_fee). The idempotency
 * key is per Checkout session, so a retried webhook can't refund twice.
 * The charge.refunded webhook that follows writes the negative ledger row.
 */
export function stripeExcessRefunder(stripe: Stripe): NonNullable<FulfillPaymentInput["refundExcess"]> {
  return async ({ paymentIntentId, amountCents, idempotencyKey, jobId }) => {
    await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: amountCents,
        reverse_transfer: true,
        refund_application_fee: true,
        reason: "duplicate",
        metadata: { job_id: jobId, creed_reason: "overpayment" },
      },
      { idempotencyKey },
    );
    return true;
  };
}
