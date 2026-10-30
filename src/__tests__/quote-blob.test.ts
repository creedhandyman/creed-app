import {
  readDiscount, readLaborRate, readMinLaborHours, readTaxMode, readMaterialTax,
  readTierNames, readCrewSize, readEstDays, readQuoteSettings,
} from "../lib/quote-blob";

describe("readDiscount", () => {
  it("accepts a percent or fixed discount with a positive value", () => {
    expect(readDiscount({ type: "percent", value: 10 })).toEqual({ type: "percent", value: 10, label: undefined });
    expect(readDiscount({ type: "fixed", value: 25.5, label: "Repeat client" })).toEqual({ type: "fixed", value: 25.5, label: "Repeat client" });
  });
  it("drops a non-string label", () => {
    expect(readDiscount({ type: "percent", value: 5, label: 7 })?.label).toBeUndefined();
  });
  it("is null for anything that isn't a real discount", () => {
    for (const bad of [null, undefined, {}, { type: "percent" }, { type: "percent", value: 0 }, { type: "percent", value: -5 },
      { type: "bogus", value: 10 }, { type: "fixed", value: "10" }, { type: "fixed", value: NaN }, "10%", 10]) {
      expect(readDiscount(bad)).toBeNull();
    }
  });
});

describe("override readers", () => {
  it("labor rate: positive numbers only", () => {
    expect(readLaborRate(85)).toBe(85);
    for (const bad of [0, -1, "85", null, undefined, NaN]) expect(readLaborRate(bad)).toBeNull();
  });
  it("min hours: zero is valid (floor off), negative / non-numbers are not", () => {
    expect(readMinLaborHours(0)).toBe(0);
    expect(readMinLaborHours(2.5)).toBe(2.5);
    for (const bad of [-1, "2", null, undefined, NaN]) expect(readMinLaborHours(bad)).toBeNull();
  });
  it("tax mode: the three known values only", () => {
    for (const ok of ["total", "materials", "none"] as const) expect(readTaxMode(ok)).toBe(ok);
    for (const bad of ["TOTAL", "", null, undefined, 1]) expect(readTaxMode(bad)).toBeNull();
  });
  it("crew size rounds, and must be positive", () => {
    expect(readCrewSize(2)).toBe(2);
    expect(readCrewSize(2.6)).toBe(3);
    for (const bad of [0, -1, "2", null, undefined]) expect(readCrewSize(bad)).toBeNull();
  });
  it("est days: positive numbers only (not rounded)", () => {
    expect(readEstDays(1.5)).toBe(1.5);
    for (const bad of [0, -2, "3", null, undefined]) expect(readEstDays(bad)).toBeNull();
  });
});

describe("readMaterialTax", () => {
  it("keeps a saved 0% distinct from 'no rate saved'", () => {
    expect(readMaterialTax({ materialTaxPct: 0 })).toEqual({ pct: 0, zip: "" });
    expect(readMaterialTax({})).toBeNull();
    expect(readMaterialTax(null)).toBeNull();
  });
  it("carries the zip it was priced for", () => {
    expect(readMaterialTax({ materialTaxPct: 7.5, materialTaxZip: "67202" })).toEqual({ pct: 7.5, zip: "67202" });
    expect(readMaterialTax({ materialTaxPct: 7.5, materialTaxZip: 67202 })).toEqual({ pct: 7.5, zip: "" });
  });
  it("ignores a negative or non-numeric rate", () => {
    expect(readMaterialTax({ materialTaxPct: -1 })).toBeNull();
    expect(readMaterialTax({ materialTaxPct: "7.5" })).toBeNull();
  });
});

describe("readTierNames", () => {
  it("defaults blanks and non-strings to Better / Best", () => {
    expect(readTierNames(undefined)).toEqual({ better: "Better", best: "Best" });
    expect(readTierNames({ better: "  ", best: 3 })).toEqual({ better: "Better", best: "Best" });
  });
  it("keeps real names (untrimmed, as saved)", () => {
    expect(readTierNames({ better: "Standard", best: "Premium" })).toEqual({ better: "Standard", best: "Premium" });
    expect(readTierNames({ better: "Standard" })).toEqual({ better: "Standard", best: "Best" });
  });
});

describe("readQuoteSettings", () => {
  it("is all-defaults for an empty, missing or hostile blob", () => {
    const empty = {
      discount: null, laborRate: null, minLaborHours: null, taxMode: null, materialTax: null,
      tieredQuote: false, tierNames: { better: "Better", best: "Best" }, crewSize: null, estDays: null,
    };
    expect(readQuoteSettings({})).toEqual(empty);
    expect(readQuoteSettings(null)).toEqual(empty);
    expect(readQuoteSettings(undefined)).toEqual(empty);
    expect(readQuoteSettings({ discount: "x", laborRate: "x", minLaborHours: {}, taxMode: [], tieredQuote: "true", crewSize: "2" })).toEqual(empty);
  });

  it("reads a fully populated quote", () => {
    const s = readQuoteSettings({
      discount: { type: "percent", value: 10, label: "Promo" }, laborRate: 90, minLaborHours: 0, taxMode: "materials",
      materialTaxPct: 7.5, materialTaxZip: "67202", tieredQuote: true, tierNames: { better: "Plus", best: "Max" },
      crewSize: 2.4, estDays: 3,
    });
    expect(s).toEqual({
      discount: { type: "percent", value: 10, label: "Promo" }, laborRate: 90, minLaborHours: 0, taxMode: "materials",
      materialTax: { pct: 7.5, zip: "67202" }, tieredQuote: true, tierNames: { better: "Plus", best: "Max" },
      crewSize: 2, estDays: 3,
    });
  });

  it("tieredQuote is true only for a literal true", () => {
    expect(readQuoteSettings({ tieredQuote: true }).tieredQuote).toBe(true);
    for (const v of [1, "true", null]) expect(readQuoteSettings({ tieredQuote: v }).tieredQuote).toBe(false);
  });
});
