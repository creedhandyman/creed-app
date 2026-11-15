// parser.ts imports the Supabase client, which throws without env vars.
jest.mock("@/lib/supabase", () => ({ db: {}, supabase: {} }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));

import { parseTierBuild, quoteHasTierSplit, tierBuildUserMessage, appendRooms, MAX_TIER_ADDS_PER_LEVEL } from "@/lib/tier-build";
import { validateQuote } from "@/lib/parser";
import { sendTierChoices, sentTierValue } from "@/lib/tiers";
import { readSentTier } from "@/lib/quote-blob";
import { applyApproval } from "@/lib/approve-job";
import { applyAssistOps } from "@/lib/assist-ops";
import type { Room } from "@/lib/types";

// The 2026-11-14 patio quote: both lines must-fix → three identical prices.
const patio = (): Room[] => [
  { name: "Carpentry", items: [{ id: "a", detail: "Patio — Build wood frame border", condition: "-", comment: "", laborHrs: 3, materials: [{ n: "Lumber", c: 114 }], tiers: ["base", "better", "best"] }] },
  { name: "General", items: [{ id: "b", detail: "Patio — Prep and install gravel bed", condition: "-", comment: "", laborHrs: 9, materials: [{ n: "Gravel", c: 412.5 }], tiers: ["base", "better", "best"] }] },
] as Room[];

describe("tier builder", () => {
  it("an all-must-fix quote has no split; a recommended line makes one", () => {
    expect(quoteHasTierSplit(patio())).toBe(false);
    expect(quoteHasTierSplit([{ items: [{}, {}] }])).toBe(false); // untagged = Essential
    expect(quoteHasTierSplit([{ items: [{}, { tiers: ["better", "best"] }] }])).toBe(true);
  });

  it("parses recommended / upgrade add-ons into cumulative tier sets", () => {
    const r = parseTierBuild(`Sure: {"add":[
      {"trade":"General","detail":"Patio — Landscape fabric under gravel","laborHrs":1,"materials":[{"n":"Fabric","c":45}],"level":"recommended"},
      {"trade":"Carpentry","detail":"Patio — Upgrade border to cedar","laborHrs":0.5,"materials":[{"n":"Cedar difference","c":60}],"level":"upgrade"}
    ],"tooSmall":false,"reason":""}`);
    expect(r.tooSmall).toBe(false);
    expect(r.adds.map((a) => a.tiers)).toEqual([["better", "best"], ["best"]]);
    expect(r.adds[0]).toMatchObject({ trade: "General", laborHrs: 1, condition: "-", materials: [{ n: "Fabric", c: 45 }] });
  });

  it("merging the adds gives real price differences and leaves the existing lines alone", () => {
    const r = parseTierBuild(`{"add":[{"trade":"General","detail":"Patio — Landscape fabric","laborHrs":1,"materials":[{"n":"Fabric","c":45}],"level":"recommended"}]}`);
    let n = 0;
    const out = applyAssistOps(patio(), { add: r.adds }, { newId: () => `n${++n}`, defaultAddTiers: null }).rooms;
    expect(quoteHasTierSplit(out)).toBe(true);
    const items = out.flatMap((x) => x.items);
    expect(items.find((i) => i.id === "a")).toEqual(patio()[0].items[0]);
    expect(items.find((i) => i.id === "n1")?.tiers).toEqual(["better", "best"]);
  });

  it("fresh builder lines get the AI caps; existing lines are appended to untouched", () => {
    const r = parseTierBuild(`{"add":[
      {"trade":"General","detail":"Patio — Steel edging upgrade","laborHrs":250,"materials":[{"n":"Edging","c":80}],"level":"upgrade"},
      {"trade":"Landscaping","detail":"Patio — Weed barrier","laborHrs":1,"materials":[{"n":"Fabric","c":45}],"level":"recommended"}
    ]}`);
    let n = 0;
    const fresh = validateQuote(applyAssistOps([], { add: r.adds }, { newId: () => `n${++n}`, defaultAddTiers: null }).rooms);
    const out = appendRooms(patio(), fresh);
    const items = out.flatMap((x) => x.items);
    expect(items.find((i) => i.id === "n1")!.laborHrs).toBe(100); // runaway hours capped like a parsed line
    expect(out.slice(0, 2).map((x) => x.items[0])).toEqual(patio().map((x) => x.items[0]));
    // existing line first, the new ones after it ("Landscaping" folds into a canonical trade)
    expect(out.find((x) => x.name === "General")!.items[0].id).toBe("b");
    expect(items.map((i) => i.id).sort()).toEqual(["a", "b", "n1", "n2"]);
  });

  it("too small: no usable lines reads as tooSmall with the AI's reason", () => {
    expect(parseTierBuild(`{"add":[],"tooSmall":true,"reason":"A single faucet swap."}`)).toEqual({ adds: [], tooSmall: true, reason: "A single faucet swap." });
    expect(parseTierBuild("not json").tooSmall).toBe(true);
    // free lines, unknown levels and blank details are dropped
    const r = parseTierBuild(`{"add":[
      {"detail":"Free thing","laborHrs":0,"materials":[],"level":"upgrade"},
      {"detail":"Mystery","laborHrs":1,"materials":[],"level":"maybe"},
      {"detail":"","laborHrs":1,"materials":[],"level":"upgrade"}
    ],"reason":"x"}`);
    expect(r).toEqual({ adds: [], tooSmall: true, reason: "x" });
  });

  it("caps the adds per level", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ detail: `U${i}`, laborHrs: 1, materials: [], level: "upgrade" }));
    expect(parseTierBuild(JSON.stringify({ add: many })).adds).toHaveLength(MAX_TIER_ADDS_PER_LEVEL);
  });

  it("the prompt lists the existing lines read-only", () => {
    const m = tierBuildUserMessage(patio(), "4417 E 104 St");
    expect(m).toContain("4417 E 104 St");
    expect(m).toContain("Patio — Prep and install gravel bed");
    expect(m).toContain("read-only");
  });
});

describe("sending one tier", () => {
  const items = [{}, { tiers: ["better", "best"] as const }, { tiers: ["best"] as const }].map((x) => ({ ...x, tiers: x.tiers ? [...x.tiers] : undefined }));
  const tt = { base: 480, better: 725, best: 1040 };

  it("offers All tiers + each tier the customer would see", () => {
    expect(sendTierChoices(items, tt)).toEqual([
      { key: "all", total: null }, { key: "base", total: 480 }, { key: "better", total: 725 }, { key: "best", total: 1040 },
    ]);
    // no Premium-only line → no Premium choice
    expect(sendTierChoices(items.slice(0, 2), { base: 480, better: 725, best: 725 })?.map((c) => c.key)).toEqual(["all", "base", "better"]);
  });

  it("nothing to choose when the quote is one price", () => {
    expect(sendTierChoices([{}, {}], { base: 480, better: 480, best: 480 })).toBeNull();
    expect(sendTierChoices(items, null)).toBeNull();
  });

  it("all = null on the blob, one tier = that key", () => {
    expect(sentTierValue("all")).toBeNull();
    expect(sentTierValue(null)).toBeNull();
    expect(sentTierValue("base")).toBe("base");
  });

  it("readSentTier needs a tiered quote that priced that tier", () => {
    expect(readSentTier({ tieredQuote: true, sentTier: "base", tierTotals: tt })).toBe("base");
    expect(readSentTier({ tieredQuote: false, sentTier: "base", tierTotals: tt })).toBeNull();
    expect(readSentTier({ tieredQuote: true, sentTier: "nope", tierTotals: tt })).toBeNull();
    expect(readSentTier({ tieredQuote: true, sentTier: "best", tierTotals: { base: 1 } })).toBeNull();
  });

  const job = (sentTier: string | null) => ({
    status: "quoted",
    total: 725,
    rooms: JSON.stringify({ tieredQuote: true, tierTotals: tt, sentTier, rooms: [{ name: "General", items: [{ id: "a", detail: "x", laborHrs: 1, materials: [] }] }] }),
  });

  it("an online approval of a one-tier send locks to that tier", () => {
    const { patch, blob } = applyApproval(job("base"), { signature: "Jane", tier: "better", nowIso: "2026-11-14T12:00:00Z", via: "online" });
    expect(patch.total).toBe(480);
    expect(blob!.acceptedTier).toBe("base");
  });

  it("an owner-recorded approval can still pick any tier; all-tier sends are unchanged", () => {
    expect(applyApproval(job("base"), { signature: "J", tier: "best", nowIso: "2026-11-14T12:00:00Z", via: "in_person" }).patch.total).toBe(1040);
    expect(applyApproval(job(null), { signature: "J", tier: "better", nowIso: "2026-11-14T12:00:00Z", via: "online" }).patch.total).toBe(725);
  });
});
