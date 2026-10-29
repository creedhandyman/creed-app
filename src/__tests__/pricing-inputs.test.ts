import { pricingInputs, parseTradeRates, priceCascade, rateForRoom } from "../lib/pricing";

describe("pricingInputs — org defaults", () => {
  it("falls back to $55, min 1 hr, no fee/tax/markup, tax mode total", () => {
    expect(pricingInputs(null)).toEqual({
      defaultRate: 55, rate: 55, tradeRates: null,
      markupPct: 0, taxPct: 0, taxMode: "total", tripFee: 0, minHrs: 1,
    });
    expect(pricingInputs({})).toEqual(pricingInputs(undefined));
  });

  it("reads the org's settings", () => {
    const p = pricingInputs({
      default_rate: 70, markup_pct: 15, tax_pct: 7.5, tax_mode: "materials",
      trip_fee: 25, min_labor_hours: 2, trade_rates: '{"plumbing":90}',
    });
    expect(p).toEqual({
      defaultRate: 70, rate: 70, tradeRates: { plumbing: 90 },
      markupPct: 15, taxPct: 7.5, taxMode: "materials", tripFee: 25, minHrs: 2,
    });
  });

  it("treats a bad tax_mode as total", () => {
    expect(pricingInputs({ tax_mode: "bogus" }).taxMode).toBe("total");
    expect(pricingInputs({ tax_mode: "none" }).taxMode).toBe("none");
  });
});

describe("pricingInputs — per-quote overrides win", () => {
  it("labor rate override beats the org rate, but only when > 0", () => {
    expect(pricingInputs({ default_rate: 70 }, { laborRate: 95 }).rate).toBe(95);
    expect(pricingInputs({ default_rate: 70 }, { laborRate: 0 }).rate).toBe(70);
    expect(pricingInputs({ default_rate: 70 }, { laborRate: null }).rate).toBe(70);
    // defaultRate stays the org's — the override only changes the non-trade rate
    expect(pricingInputs({ default_rate: 70 }, { laborRate: 95 }).defaultRate).toBe(70);
  });

  it("min hours: override → org → 1, and an override of 0 is honored", () => {
    expect(pricingInputs({ min_labor_hours: 2 }, { minLaborHours: 3 }).minHrs).toBe(3);
    expect(pricingInputs({ min_labor_hours: 2 }, { minLaborHours: 0 }).minHrs).toBe(0);
    expect(pricingInputs({ min_labor_hours: 2 }, { minLaborHours: null }).minHrs).toBe(2);
    expect(pricingInputs({ min_labor_hours: 0 }).minHrs).toBe(0); // org may turn it off too
    expect(pricingInputs({}).minHrs).toBe(1);
  });

  it("ignores a negative min-hours value at either level", () => {
    expect(pricingInputs({ min_labor_hours: 2 }, { minLaborHours: -1 }).minHrs).toBe(2);
    expect(pricingInputs({ min_labor_hours: -4 }).minHrs).toBe(1);
  });

  it("tax mode override beats the org's", () => {
    expect(pricingInputs({ tax_mode: "materials" }, { taxMode: "none" }).taxMode).toBe("none");
    expect(pricingInputs({ tax_mode: "materials" }, { taxMode: null }).taxMode).toBe("materials");
  });
});

describe("parseTradeRates", () => {
  it("parses an object, and is null for anything unusable", () => {
    expect(parseTradeRates('{"a":1}')).toEqual({ a: 1 });
    for (const bad of [null, undefined, "", "not json", "[1,2]", "5", "null", 7, {}]) {
      expect(parseTradeRates(bad)).toBeNull();
    }
  });
});

describe("feeds the cascade the way the callers do", () => {
  it("a floor + trip fee + tax quote prices from the resolved inputs", () => {
    const p = pricingInputs({ default_rate: 60, trip_fee: 20, min_labor_hours: 2, tax_pct: 10, tax_mode: "total" });
    const r = priceCascade({
      laborRaw: 30, hoursRaw: 0.5, materials: 10, rate: p.rate,
      minHrs: p.minHrs, tripFee: p.tripFee, discount: null,
      taxPct: p.taxPct, taxMode: p.taxMode, subtotalRaw: 40,
    });
    // floor: 2 hr × $60 = 120 labor; subtotal 130; + trip 20 = 150; tax 10% = 15
    expect(r.minApplies).toBe(true);
    expect(r.grandTotal).toBe(165);
  });

  it("trade rates resolve per room via rateForRoom", () => {
    const p = pricingInputs({ default_rate: 60, trade_rates: '{"plumbing":90}' });
    expect(rateForRoom("Plumbing — kitchen", { defaultRate: p.defaultRate, tradeRates: p.tradeRates })).toBe(90);
    expect(rateForRoom("Paint", { defaultRate: p.defaultRate, tradeRates: p.tradeRates })).toBe(60);
  });
});
// The lead-draft total's use of these inputs is pinned in lead-draft.test.ts
// (draftTotal: org rate, trade rates, min-hours floor, trip fee, tax).
