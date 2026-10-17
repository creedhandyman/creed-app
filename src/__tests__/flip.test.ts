import { analyzeFlip, RULE_70, THIN_PROFIT } from "@/lib/flip";

const base = {
  arv: 300000,
  purchase_price: 150000,
  rehab_budget: 40000,
  holding_monthly: 2000,
  holding_months: 5,
  selling_pct: 6,
  down_pct: 15,
  financing_cost: 0,
  contingency: 0,
};

describe("analyzeFlip", () => {
  it("good deal: solid profit and passes the 70% rule", () => {
    const a = analyzeFlip(base);
    expect(a.holding).toBe(10000);
    expect(a.selling).toBeCloseTo(18000);
    expect(a.allIn).toBe(200000);
    expect(a.netSale).toBeCloseTo(282000);
    expect(a.profit).toBeCloseTo(82000);
    expect(a.maxBuy).toBeCloseTo(170000);
    expect(a.passes70).toBe(true);
    expect(a.verdict).toBe("good");
  });

  it("warn when profit is thin (between 0 and THIN_PROFIT)", () => {
    // A big contingency eats the profit without touching the 70% max (it's
    // ARV × 0.70 − rehab only), so only the thin branch fires.
    const a = analyzeFlip({ ...base, contingency: 70000 });
    expect(a.profit).toBeGreaterThan(0);
    expect(a.profit).toBeLessThan(THIN_PROFIT);
    expect(a.passes70).toBe(true);
    expect(a.verdict).toBe("warn");
  });

  it("warn when the purchase is over the 70% max even with good profit", () => {
    const a = analyzeFlip({ ...base, purchase_price: 171000 });
    expect(a.passes70).toBe(false);
    expect(a.profit).toBeGreaterThan(THIN_PROFIT);
    expect(a.verdict).toBe("warn");
  });

  it("purchase exactly at maxBuy passes", () => {
    const a = analyzeFlip({ ...base, purchase_price: 300000 * RULE_70 - 40000 });
    expect(a.passes70).toBe(true);
  });

  it("bad when profit is zero or negative", () => {
    expect(analyzeFlip({ ...base, purchase_price: 280000 }).verdict).toBe("bad");
    // profit exactly 0 is still bad
    const zero = analyzeFlip({ arv: 100000, purchase_price: 100000 });
    expect(zero.profit).toBe(0);
    expect(zero.verdict).toBe("bad");
  });

  it("cash-in = down payment + rehab + holding + financing + contingency, ROI off it", () => {
    const a = analyzeFlip({ ...base, financing_cost: 3000, contingency: 5000 });
    expect(a.cashIn).toBeCloseTo(150000 * 0.15 + 40000 + 10000 + 3000 + 5000);
    expect(a.roi).toBeCloseTo(a.profit / a.cashIn);
  });

  it("ROI is 0 when no cash is in (divide-by-zero guard)", () => {
    const a = analyzeFlip({ arv: 200000 });
    expect(a.cashIn).toBe(0);
    expect(a.roi).toBe(0);
  });

  it("maxBuy = ARV × 0.70 − rehab", () => {
    expect(analyzeFlip({ arv: 250000, rehab_budget: 35000 }).maxBuy).toBeCloseTo(250000 * 0.7 - 35000);
  });

  it("treats missing / null / NaN inputs as 0", () => {
    const a = analyzeFlip({ arv: undefined, purchase_price: NaN, rehab_budget: null as unknown as number });
    expect(a.allIn).toBe(0);
    expect(a.profit).toBe(0);
    expect(a.verdict).toBe("bad");
  });
});
