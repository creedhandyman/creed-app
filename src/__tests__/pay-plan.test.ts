import { payPlan } from "../lib/pay-plan";

const base = { total: 1000, paid: 0, orgDepositPct: 50, billing: false, pick: null as number | null };

describe("before the work (a deposit request)", () => {
  it("defaults to the deposit and offers deposit or the whole thing", () => {
    const p = payPlan(base);
    expect(p).toMatchObject({ balanceDue: 1000, options: [50, 100], pct: 50, amount: 500, remaining: 500, canChoose: true });
  });
  it("pay in full when picked", () => {
    expect(payPlan({ ...base, pick: 100 })).toMatchObject({ pct: 100, amount: 1000, remaining: 0 });
  });
  it("a business that takes no deposits only offers the whole thing", () => {
    for (const orgDepositPct of [0, 100]) {
      expect(payPlan({ ...base, orgDepositPct })).toMatchObject({ options: [100], pct: 100, amount: 1000, canChoose: false });
    }
  });
  it("ignores a pick that isn't on offer", () => {
    expect(payPlan({ ...base, pick: 25 })).toMatchObject({ pct: 50, amount: 500 });
  });
});

describe("after the work (complete / invoiced) — the payment-plan case", () => {
  const bill = { ...base, billing: true };
  it("still defaults to paying the whole balance", () => {
    expect(payPlan(bill)).toMatchObject({ pct: 100, amount: 1000, remaining: 0, options: [50, 100], canChoose: true });
  });
  it("but lets the customer pay the deposit part now", () => {
    expect(payPlan({ ...bill, pick: 50 })).toMatchObject({ pct: 50, amount: 500, remaining: 500 });
  });
  it("with no deposits taken it's just the balance", () => {
    expect(payPlan({ ...bill, orgDepositPct: 0 })).toMatchObject({ options: [100], amount: 1000, canChoose: false });
  });
});

describe("after a deposit was already paid", () => {
  it("offers only the balance once what's left is no more than the deposit amount", () => {
    for (const billing of [false, true]) {
      const p = payPlan({ ...base, paid: 500, billing });
      expect(p).toMatchObject({ balanceDue: 500, options: [100], pct: 100, amount: 500, remaining: 0, canChoose: false });
    }
  });
  it("a smaller earlier payment still leaves a real choice", () => {
    const p = payPlan({ ...base, paid: 200, billing: true });
    expect(p).toMatchObject({ balanceDue: 800, options: [50, 100], pct: 100, amount: 800 });
    expect(payPlan({ ...base, paid: 200, billing: true, pick: 50 })).toMatchObject({ amount: 500, remaining: 300 });
  });
  it("never charges more than is owed", () => {
    expect(payPlan({ ...base, paid: 900, billing: true }).amount).toBe(100);
    expect(payPlan({ ...base, paid: 1000 })).toMatchObject({ balanceDue: 0, amount: 0, canChoose: false });
    expect(payPlan({ ...base, paid: 1200 }).balanceDue).toBe(0);
  });
});

describe("rounding and bad input", () => {
  it("rounds to cents", () => {
    const p = payPlan({ ...base, total: 1168.03, pick: 50, billing: true });
    expect(p.amount).toBe(584.02); // 50% of 1168.03 = 584.015
    expect(p.remaining).toBe(584.01);
    expect(p.amount + p.remaining).toBeCloseTo(1168.03, 2);
  });
  it("tolerates junk totals", () => {
    expect(payPlan({ ...base, total: NaN as unknown as number }).amount).toBe(0);
    expect(payPlan({ ...base, total: -5 }).balanceDue).toBe(0);
  });
});
