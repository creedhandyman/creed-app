import { quoteSections, pricingInputs } from "@/lib/pricing";

// The customer's quote page (/status) and the printed quote share this
// breakdown. The page used to price a section as hrs × org default + RAW
// materials, so trade rates, the materials purchase tax and the markup were
// missing and its sections didn't add up to the quote.
const rooms = [
  { name: "Plumbing", items: [{ detail: "Kitchen — Replace faucet", laborHrs: 2, materials: [{ c: 100 }], tiers: ["base", "better", "best"] }] },
  { name: "Drywall", items: [{ detail: "Kitchen — Patch ceiling", laborHrs: 4, materials: [{ c: 50 }, { c: 50 }] }] },
  { name: "plumbing", items: [{ detail: "Bath — Reseat toilet", laborHrs: 1, materials: [], tiers: ["best"] }] },
  { name: "Empty", items: [] },
];
const org = { default_rate: 76, trade_rates: JSON.stringify({ Plumbing: 95 }), markup_pct: 10 };

describe("quoteSections", () => {
  it("folds trades, bills each at its trade rate, and bills materials with tax + markup", () => {
    const p = pricingInputs(org);
    const s = quoteSections(rooms, { rate: p.rate, tradeRates: p.tradeRates, materialTaxPct: 7.5, markupPct: p.markupPct });
    expect(s.map((x) => x.name)).toEqual(["Plumbing", "Drywall"]);
    const plumbing = s[0];
    expect(plumbing.count).toBe(2);
    expect(plumbing.labor).toBe(3 * 95);
    expect(plumbing.mat).toBeCloseTo(100 * 1.075 * 1.1, 2);
    expect(s[1].labor).toBe(4 * 76);
    expect(s[1].mat).toBeCloseTo(100 * 1.075 * 1.1, 2);
    expect(plumbing.details).toEqual(["Kitchen — Replace faucet", "Bath — Reseat toilet"]);
  });

  it("a per-quote rate override beats the trade rates (the $55 Holyoke-style quote)", () => {
    const p = pricingInputs(org, { laborRate: 55 });
    const s = quoteSections(rooms, { rate: p.rate, override: 55, tradeRates: p.tradeRates });
    expect(s[0].labor).toBe(3 * 55);
    expect(s[1].labor).toBe(4 * 55);
  });

  it("keep() limits the breakdown to one tier and drops trades left empty", () => {
    const p = pricingInputs(org);
    const s = quoteSections(rooms, { rate: p.rate, tradeRates: p.tradeRates }, (it) => {
      const t = (it as { tiers?: string[] }).tiers;
      return !t || t.includes("base");
    });
    expect(s.map((x) => [x.name, x.count])).toEqual([["Plumbing", 1], ["Drywall", 1]]);
  });
});
