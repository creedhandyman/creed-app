import { buildJobCheckoutParams, type JobCheckoutInput } from "@/lib/payments/stripe-checkout";

const input = (over: Partial<JobCheckoutInput> = {}): JobCheckoutInput => ({
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

test("card only by default, one line, fee to the platform, money to the business", () => {
  const p = buildJobCheckoutParams(input());
  expect(p.payment_method_types).toEqual(["card"]);
  expect(p.payment_method_options).toBeUndefined();
  expect(p.line_items).toHaveLength(1);
  expect(p.line_items[0].price_data.unit_amount).toBe(100000);
  expect(p.payment_intent_data).toEqual({ transfer_data: { destination: "acct_123" }, application_fee_amount: 500 });
  expect(p.metadata).toMatchObject({
    job_id: "job-1", org_id: "org-1", amount_cents: "100000", tip_cents: "0", platform_fee_cents: "500", kind: "balance", provider: "stripe",
  });
});

test("bank transfer is offered only when the business turned it on", () => {
  const p = buildJobCheckoutParams(input({ allowBankTransfer: true }));
  expect(p.payment_method_types).toEqual(["card", "us_bank_account"]);
  expect(p.payment_method_options).toEqual({ us_bank_account: { verification_method: "automatic" } });
});

test("a tip is its own line and metadata, and the fee isn't taken on it", () => {
  const p = buildJobCheckoutParams(input({ tipCents: 15000 }));
  expect(p.line_items).toHaveLength(2);
  expect(p.line_items[1].price_data).toMatchObject({ unit_amount: 15000, product_data: { name: "Tip" } });
  expect(p.metadata.tip_cents).toBe("15000");
  expect(p.metadata.amount_cents).toBe("100000");
  expect(p.payment_intent_data.application_fee_amount).toBe(500);
});

test("a zero fee is left out (Stripe rejects 0 on destination charges)", () => {
  const p = buildJobCheckoutParams(input({ platformFeeCents: 0 }));
  expect(p.payment_intent_data).toEqual({ transfer_data: { destination: "acct_123" } });
  expect(p.metadata.platform_fee_cents).toBe("0");
});

test("bad numbers are clamped and rounded", () => {
  const p = buildJobCheckoutParams(input({ amountCents: 1000.6, tipCents: -50, platformFeeCents: -1 }));
  expect(p.line_items[0].price_data.unit_amount).toBe(1001);
  expect(p.line_items).toHaveLength(1);
  expect(p.metadata.tip_cents).toBe("0");
});
