import { shouldOfferTiers, tiersDefaultOn, RECOMMENDED_TIER, TIER_NAME } from "@/lib/tiers";
import { readQuoteSettings, readTierNames } from "@/lib/quote-blob";

const room = (n: number, tagged = false) => ({
  items: Array.from({ length: n }, (_, i) => (tagged && i === n - 1 ? { tiers: ["best" as const] } : {})),
});

describe("three tiers are the default on new quotes (2026-11-14)", () => {
  it("2+ items get tiers, even when the AI tagged nothing (all must-fix)", () => {
    expect(shouldOfferTiers([room(2)])).toBe(true);
    expect(shouldOfferTiers([room(1), room(1)])).toBe(true);
    expect(shouldOfferTiers([room(22, true)])).toBe(true);
  });

  it("a single-item job stays one price", () => {
    expect(shouldOfferTiers([room(1)])).toBe(false);
    expect(shouldOfferTiers([room(0), room(1)])).toBe(false);
    expect(shouldOfferTiers([])).toBe(false);
  });

  it("the business switch turns the default off", () => {
    expect(shouldOfferTiers([room(5)], false)).toBe(false);
  });

  it("the business switch is ON unless explicitly false", () => {
    expect(tiersDefaultOn(null)).toBe(true);
    expect(tiersDefaultOn({})).toBe(true);
    expect(tiersDefaultOn({ tiered_quotes_default: null })).toBe(true);
    expect(tiersDefaultOn({ tiered_quotes_default: true })).toBe(true);
    expect(tiersDefaultOn({ tiered_quotes_default: false })).toBe(false);
  });

  it("Complete is the recommended tier, between Essential and Premium", () => {
    expect(RECOMMENDED_TIER).toBe("better");
    expect(TIER_NAME).toEqual({ base: "Essential", better: "Complete", best: "Premium" });
  });

  it("old saved Better / Best names never override Complete / Premium", () => {
    expect(readTierNames({ better: "Better", best: "Best" })).toEqual({ better: "Complete", best: "Premium" });
    // e.g. the Grid Suite 606 quote's blob (saved before e051c09 deployed)
    const q = readQuoteSettings({ tieredQuote: false, tierSplit: false, tierNames: { better: "Better", best: "Best" } } as never);
    expect(q.tierNames).toEqual({ better: "Complete", best: "Premium" });
    expect(q.tieredQuote).toBe(false); // existing quotes keep their saved setting
  });
});
