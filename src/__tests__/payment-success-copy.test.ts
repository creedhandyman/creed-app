import { isWorkDone, paymentSuccessCopy } from "@/lib/payment-success-copy";

test("a balance left on a finished job is due now", () => {
  const c = paymentSuccessCopy({ result: { paidNow: 584.02, balance: 584.01, fullyPaid: false, workDone: true } });
  expect(c.title).toBe("Payment received");
  expect(c.body).toBe("Thank you! We received $584.02. Remaining balance: $584.01, due now.");
  expect(c.body).not.toMatch(/when the work is complete/);
});

test("a deposit before the work still says due when the work is complete", () => {
  const c = paymentSuccessCopy({ result: { paidNow: 100, balance: 300, fullyPaid: false, workDone: false } });
  expect(c.body).toBe("Thank you! We received $100.00. Remaining balance: $300.00, due when the work is complete.");
});

test("paid in full is unchanged", () => {
  const c = paymentSuccessCopy({ result: { paidNow: 1.38, balance: 0, fullyPaid: true, workDone: true } });
  expect(c.title).toBe("Paid in full");
  expect(c.body).toBe("Thank you! We received $1.38 and your invoice is paid in full.");
});

test("an unconfirmed payment never says it went through", () => {
  const pending = paymentSuccessCopy({ error: { notPaid: false } });
  const failed = paymentSuccessCopy({ error: { notPaid: true } });
  for (const c of [pending, failed]) {
    expect(`${c.title} ${c.body}`).not.toMatch(/went through|received/i);
    expect(c.icon).toBe("!");
  }
  expect(pending.title).toBe("Confirming your payment");
  expect(pending.body).toMatch(/don't pay again/);
  expect(failed.title).toBe("Payment not completed");
  expect(failed.body).toMatch(/didn't go through/);
});

test("finished-work statuses match the job page's billing view", () => {
  expect(isWorkDone("complete")).toBe(true);
  expect(isWorkDone("invoiced")).toBe(true);
  expect(isWorkDone("paid")).toBe(true);
  expect(isWorkDone("scheduled")).toBe(false);
  expect(isWorkDone("accepted")).toBe(false);
  expect(isWorkDone(null)).toBe(false);
});
