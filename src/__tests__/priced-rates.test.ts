import { readPricedRates } from "@/lib/quote-blob";
import { pricingInputs } from "@/lib/pricing";

// 2026-11-14: Creed raised its rate $55 → $76 and every saved quote without
// a per-quote rate reopened (editor, PDF, customer page) at $76 — e.g. the
// Holyoke quote. A saved quote keeps the rates it was priced with.
const today = { minHrs: 2, defaultRate: 76, tradeRates: { General: 76, Carpentry: 76 } };
const rooms = [
  { name: "General", items: [{ laborHrs: 5.3 }] },
  { name: "Carpentry", items: [{ laborHrs: 3 }] },
];

describe("readPricedRates", () => {
  it("a quote saved with rates keeps them", () => {
    const b = { rooms, pricedRates: { rate: 55, trades: { General: 55, Bad: -1 } } };
    expect(readPricedRates(b, { totalLabor: 0, ...today })).toEqual({ rate: 55, trades: { General: 55 } });
    expect(readPricedRates(b)).toEqual({ rate: 55, trades: { General: 55 } });
  });

  it("an older quote: the rate that reproduces its saved labor", () => {
    expect(readPricedRates({ rooms }, { totalLabor: 456.5, ...today })).toEqual({ rate: 55, trades: null });
    // labor saved as a numeric string from Postgres
    expect(readPricedRates({ rooms }, { totalLabor: "456.5", ...today })?.rate).toBe(55);
  });

  it("the minimum-hours floor is accounted for", () => {
    // 1 raw hour, 2-hour minimum, billed $110 → $55/hr (not $110)
    expect(readPricedRates({ rooms: [{ name: "General", items: [{ laborHrs: 1 }] }] }, { totalLabor: 110, ...today })?.rate).toBe(55);
  });

  it("null when today's rates still price it, a per-quote rate governs, or nothing to go on", () => {
    expect(readPricedRates({ rooms }, { totalLabor: 8.3 * 76, ...today })).toBeNull();
    expect(readPricedRates({ rooms, laborRate: 55 }, { totalLabor: 456.5, ...today })).toBeNull();
    expect(readPricedRates({ rooms: [] }, { totalLabor: 100, ...today })).toBeNull();
    expect(readPricedRates({ rooms }, { totalLabor: 0, ...today })).toBeNull();
    expect(readPricedRates({ rooms })).toBeNull();
  });

  it("three-tier: inferred from a tier's saved labor over that tier's lines", () => {
    const b = {
      tieredQuote: true,
      rooms: [{ name: "General", items: [{ laborHrs: 5.5 }, { laborHrs: 4, tiers: ["better", "best"] }] }],
      tierBreakdown: { base: { labor: 302.5, hrs: 5.5 }, better: { labor: 522.5, hrs: 9.5 } },
    };
    expect(readPricedRates(b, { totalLabor: 522.5, ...today })?.rate).toBe(55);
  });

  it("pricingInputs prices from the saved rates; a per-quote rate still wins", () => {
    const org = { default_rate: 76, trade_rates: JSON.stringify({ General: 76 }) };
    const priced = { rate: 55, trades: null };
    expect(pricingInputs(org, { priced })).toMatchObject({ defaultRate: 55, rate: 55, tradeRates: null });
    expect(pricingInputs(org, { priced, laborRate: 60 }).rate).toBe(60);
    expect(pricingInputs(org)).toMatchObject({ defaultRate: 76, tradeRates: { General: 76 } });
  });
});
