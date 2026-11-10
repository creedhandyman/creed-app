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

test("a bank transfer is started, not received, and says not to pay again", () => {
  const c = paymentSuccessCopy({ result: { paidNow: 1000, balance: 1000, fullyPaid: false, workDone: true, pending: true } });
  expect(c.title).toBe("Bank payment started");
  expect(c.body).toMatch(/\$1000\.00 is on its way/);
  expect(c.body).toMatch(/don't pay again/);
  expect(c.body).not.toMatch(/received/);
});

test("a tip is thanked separately and named on a pending bank payment", () => {
  const paid = paymentSuccessCopy({ result: { paidNow: 1000, balance: 0, fullyPaid: true, workDone: true, tipPaid: 150 } });
  expect(paid.body).toBe("Thank you! We received $1000.00 and your invoice is paid in full. Thanks also for the $150.00 tip!");
  const bank = paymentSuccessCopy({ result: { paidNow: 1000, pending: true, tipPaid: 150 } });
  expect(bank.body).toMatch(/\$1000\.00, plus your \$150\.00 tip, is on its way/);
});
