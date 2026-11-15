import { rowTier, tierRowTotals, sendRowPatch, jobMoney } from "@/lib/quote-totals";
import { visibleTiers, tierPriceLine, sendTierChoices } from "@/lib/tiers";

const tiered = (over: Record<string, unknown> = {}) => ({
  tieredQuote: true,
  rooms: [{ name: "Plumbing", items: [{ id: "1", detail: "a", laborHrs: 2, materials: [], tiers: ["base", "better", "best"] }] }],
  tierTotals: { base: 300, better: 500, best: 900 },
  tierBreakdown: {
    base: { labor: 200, mat: 100, hrs: 2 },
    better: { labor: 350, mat: 150, hrs: 4 },
    best: { labor: 600, mat: 300, hrs: 8 },
  },
  ...over,
});

describe("which tier the job row carries", () => {
  test("accepted, else the one tier it was sent as, else Complete", () => {
    expect(rowTier(tiered())).toBe("better");
    expect(rowTier(tiered({ sentTier: "base" }))).toBe("base");
    expect(rowTier(tiered({ sentTier: "base", acceptedTier: "best" }))).toBe("best");
    expect(rowTier(tiered({ sentTier: "bogus" }))).toBe("better");
  });

  test("sent as Essential only: the job card and invoice show Essential, not Complete", () => {
    const job = { rooms: JSON.stringify(tiered()), total: 500, total_labor: 350, total_mat: 150, total_hrs: 4 };
    expect(sendRowPatch(job, "base")).toEqual({ total: 300, total_labor: 200, total_mat: 100, total_hrs: 2 });
    // Sent again with all tiers: back to the recommended tier.
    const sentBase = { rooms: JSON.stringify(tiered({ sentTier: "base" })), total: 300, total_labor: 200, total_mat: 100, total_hrs: 2 };
    expect(sendRowPatch(sentBase, null)).toEqual({ total: 500, total_labor: 350, total_mat: 150, total_hrs: 4 });
    // Nothing to write when the row already matches, or the quote isn't tiered.
    expect(sendRowPatch(job, null)).toBeNull();
    expect(sendRowPatch({ rooms: JSON.stringify({ rooms: [] }), total: 80 }, "base")).toBeNull();
    expect(tierRowTotals({ tieredQuote: false })).toBeNull();
  });

  test("an accepted quote stays on the accepted tier whatever is sent later", () => {
    const job = { rooms: JSON.stringify(tiered({ acceptedTier: "best" })), total: 900, total_labor: 600, total_mat: 300, total_hrs: 8 };
    expect(sendRowPatch(job, "base")).toBeNull();
  });
});

describe("what the Jobs screen shows for money", () => {
  test("a saved quote shows its row numbers", () => {
    expect(jobMoney({ total: 480, total_labor: 300, total_mat: 180, total_hrs: 4, rooms: "{}" }))
      .toEqual({ total: 480, labor: 300, mat: 180, hrs: 4, state: "quote" });
  });
  test("a lead with an unsaved AI draft shows the draft, not $0 labor and materials", () => {
    const rooms = JSON.stringify({ leadDescription: "x", leadDraft: { rooms: [{ items: [{ laborHrs: 3 }] }], total: 480, labor: 300, materials: 180, hours: 3 } });
    expect(jobMoney({ total: 0, total_labor: 0, total_mat: 0, total_hrs: 0, rooms })).toEqual({ total: 480, labor: 300, mat: 180, hrs: 3, state: "draft" });
    // A draft from before labor/materials were stored: dashes for those, hours from its lines.
    const old = JSON.stringify({ leadDraft: { rooms: [{ items: [{ laborHrs: 3 }] }], total: 480 } });
    expect(jobMoney({ total: 0, rooms: old })).toEqual({ total: 480, labor: null, mat: null, hrs: 3, state: "draft" });
  });
  test("no quote built yet says so, whatever the status", () => {
    expect(jobMoney({ total: 0, rooms: JSON.stringify({ leadDescription: "leak" }) }).state).toBe("none");
    expect(jobMoney({ total: 0, rooms: "not json" })).toMatchObject({ labor: null, mat: null, state: "none" });
    // A real quote that prices to $0 is still a quote.
    expect(jobMoney({ total: 0, rooms: JSON.stringify({ rooms: [{ name: "x", items: [{ id: "1" }] }] }) }).state).toBe("quote");
  });
});

describe("a tier with no work in it is never offered", () => {
  const items = [
    { tiers: ["better", "best"] as ("base" | "better" | "best")[] },
    { tiers: ["best"] as ("base" | "better" | "best")[] },
  ];
  test("an empty Essential is hidden on the customer page, the send menu and the price line", () => {
    expect(visibleTiers(items)).toEqual(["better", "best"]);
    const tt = { base: 49, better: 500, best: 900 }; // base = just the trip fee
    expect(sendTierChoices(items, tt)?.map((c) => c.key)).toEqual(["all", "better", "best"]);
    expect(tierPriceLine(tt, visibleTiers(items))).toBe("Complete $500.00 (recommended) · Premium $900.00");
  });
  test("normal quotes are unchanged", () => {
    const normal = [{ tiers: ["base", "better", "best"] as ("base" | "better" | "best")[] }, { tiers: ["better", "best"] as ("base" | "better" | "best")[] }];
    expect(visibleTiers(normal)).toEqual(["base", "better"]);
  });
});
