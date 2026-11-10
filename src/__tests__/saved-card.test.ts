import { buildJobCheckoutParams, type JobCheckoutInput } from "@/lib/payments/stripe-checkout";
import {
  buildSavedCardChargeParams,
  cardConsentText,
  cardSaveIsCurrent,
  savedCardPaymentFromIntent,
  savedCardChargeKey,
  savedCardFailureMessage,
  savedCardFromPaymentMethod,
  savedCardLabel,
} from "@/lib/payments/saved-card";

const checkout = (over: Partial<JobCheckoutInput> = {}): JobCheckoutInput => ({
  job: { id: "job-1", org_id: "org-1", property: "12 Elm St", client: "Pat" },
  orgName: "Creed HM",
  destinationAccountId: "acct_123",
  amountCents: 100000,
  tipCents: 0,
  platformFeeCents: 500,
  kind: "balance",
  allowBankTransfer: false,
  successUrl: "https://x/success",
  cancelUrl: "https://x/cancel",
  expiresAt: 1700000000,
  ...over,
});

test("no save box ticked: checkout is unchanged", () => {
  const p = buildJobCheckoutParams(checkout());
  expect(p.customer).toBeUndefined();
  expect(p.customer_creation).toBeUndefined();
  expect(p.metadata.save_card).toBeUndefined();
});

test("save my card: only the card is saved, on a new Stripe customer", () => {
  const p = buildJobCheckoutParams(checkout({
    allowBankTransfer: true,
    saveCard: { customerId: "cust-1", stripeCustomerId: null, consentVersion: "v1" },
  }));
  expect(p.payment_method_options).toEqual({
    us_bank_account: { verification_method: "automatic" },
    card: { setup_future_usage: "off_session" },
  });
  expect(p.payment_intent_data.setup_future_usage).toBeUndefined();
  expect(p.customer_creation).toBe("always");
  expect(p.metadata).toMatchObject({ save_card: "1", customer_id: "cust-1", card_consent_version: "v1", org_name: "Creed HM" });
});

test("save my card reuses the customer's existing Stripe customer", () => {
  const p = buildJobCheckoutParams(checkout({ saveCard: { customerId: "cust-1", stripeCustomerId: "cus_9", consentVersion: "v1" } }));
  expect(p.customer).toBe("cus_9");
  expect(p.customer_creation).toBeUndefined();
});

test("card details come off a card PaymentMethod, nothing else", () => {
  expect(savedCardFromPaymentMethod({ id: "pm_1", type: "card", card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2028 } }))
    .toEqual({ paymentMethodId: "pm_1", brand: "visa", last4: "4242", exp: "04/28" });
  expect(savedCardFromPaymentMethod({ id: "pm_2", type: "us_bank_account" })).toBeNull();
  expect(savedCardFromPaymentMethod("pm_3")).toBeNull();
  expect(savedCardFromPaymentMethod(null)).toBeNull();
});

test("labels and consent read plainly", () => {
  expect(savedCardLabel("visa", "4242")).toBe("Visa ••4242");
  expect(savedCardLabel("amex", "0005")).toBe("Amex ••0005");
  expect(savedCardLabel("visa", null)).toBe("");
  expect(cardConsentText("Creed HM")).toMatch(/^Save my card with Creed HM so they can charge it for work I've approved\./);
  expect(cardConsentText("")).toMatch(/with this business/);
});

test("an off-session charge goes to the business, with the fee, and never more than asked", () => {
  const p = buildSavedCardChargeParams({
    job: { id: "job-1", org_id: "org-1", property: "12 Elm St", client: "Pat" },
    orgName: "Creed HM",
    destinationAccountId: "acct_123",
    stripeCustomerId: "cus_9",
    paymentMethodId: "pm_1",
    amountCents: 58401.4,
    platformFeeCents: 292,
    kind: "balance",
  });
  expect(p).toMatchObject({
    amount: 58401, currency: "usd", customer: "cus_9", payment_method: "pm_1",
    off_session: true, confirm: true,
    transfer_data: { destination: "acct_123" }, application_fee_amount: 292,
  });
  expect(p.metadata).toMatchObject({ job_id: "job-1", org_id: "org-1", amount_cents: "58401", tip_cents: "0", kind: "balance", card_on_file: "1" });
  const noFee = buildSavedCardChargeParams({ ...p, job: { id: "j", org_id: "o" }, orgName: "x", destinationAccountId: "a", stripeCustomerId: "c", paymentMethodId: "pm", amountCents: 100, platformFeeCents: 0, kind: "payment" });
  expect("application_fee_amount" in noFee).toBe(false);
});

test("the charge key holds for a retry and moves once the balance does", () => {
  expect(savedCardChargeKey("job-1", 58401, 0)).toBe(savedCardChargeKey("job-1", 58401, 0));
  expect(savedCardChargeKey("job-1", 58401, 0)).not.toBe(savedCardChargeKey("job-1", 58401, 58401));
});

test("a failed charge always points to a pay link", () => {
  expect(savedCardFailureMessage({ code: "authentication_required" })).toMatch(/confirm this charge.*pay link/);
  expect(savedCardFailureMessage({ type: "StripeCardError", code: "card_declined" })).toMatch(/declined.*pay link/);
  expect(savedCardFailureMessage({ code: "expired_card", type: "StripeCardError" })).toMatch(/expired.*pay link/);
  expect(savedCardFailureMessage(new Error("socket hang up"))).toMatch(/won't charge twice/);
});

test("a late or resent checkout webhook never puts back an old card", () => {
  const attached = { id: "pm_a", customer: "cus_1" };
  const t = Date.parse("2026-11-09T12:00:00Z") / 1000;
  expect(cardSaveIsCurrent(attached, null, t)).toBe(true);
  expect(cardSaveIsCurrent(attached, "2026-11-09T11:00:00Z", t)).toBe(true);
  // A newer save is already on the row.
  expect(cardSaveIsCurrent(attached, "2026-11-09T13:00:00Z", t)).toBe(false);
  // Replaced or removed since: Stripe has detached it.
  expect(cardSaveIsCurrent({ id: "pm_a", customer: null }, null, t)).toBe(false);
  expect(cardSaveIsCurrent(null, null, t)).toBe(false);
});

test("the webhook can record a saved-card charge from its own metadata", () => {
  const params = buildSavedCardChargeParams({
    job: { id: "job-1", org_id: "org-1" }, orgName: "Creed HM", destinationAccountId: "acct_1",
    stripeCustomerId: "cus_1", paymentMethodId: "pm_1", amountCents: 25000, platformFeeCents: 125, kind: "balance",
  });
  const pi = { id: "pi_1", status: "succeeded", amount: 25000, metadata: params.metadata } as unknown as Parameters<typeof savedCardPaymentFromIntent>[0];
  expect(savedCardPaymentFromIntent(pi)).toEqual({ jobId: "job-1", orgId: "org-1", paidNow: 250, platformFeeCents: 125, kind: "balance" });
  // Checkout's PaymentIntents, and anything not succeeded, are left alone.
  expect(savedCardPaymentFromIntent({ ...pi, metadata: {} } as typeof pi)).toBeNull();
  expect(savedCardPaymentFromIntent({ ...pi, status: "processing" } as typeof pi)).toBeNull();
});
