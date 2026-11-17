// Grid 603-605 (job 71b12f98): a three-tier quote whose option tags lived only
// on the WORK ORDER — the quote lines had no `tiers`, tierSplit was false and
// tierNames had no base. The PDF read both exclusive shade lines as "in every
// option" and charged both ($1,173.56).
let printed = "";
jest.mock("@/lib/print-template", () => ({
  wrapPrint: (_brand: unknown, body: string) => body,
  openPrint: (html: string) => { printed = html; return true; },
}));

import { openJobQuotePdf } from "@/lib/quote-pdf";
import { readTierRooms, readQuoteSettings } from "@/lib/quote-blob";
import { itemInTier, itemTiers, visibleTiers, TIER_NAME } from "@/lib/tiers";
import { scopeFingerprint } from "@/lib/approval";
import { summaryTasks } from "@/lib/job-summary";
import type { Job, Room } from "@/lib/types";

const blob = () => ({
  tieredQuote: true,
  tierSplit: false,
  tierNames: { better: "Complete", best: "Premium" }, // no base
  tierTotals: { base: 994.6, better: 994.6, best: 1036.68 },
  rooms: [
    { name: "Carpentry", items: [
      { id: "ef410eef", detail: "Unit 603 — Install standard roller shades (6)", condition: "-", comment: "", laborHrs: 4, materials: [{ n: "Roller shade", qty: 6, unitPrice: 60, c: 360 }] },
      { id: "2ef1e754", detail: "Unit 603 — Install blackout cellular shades (6)", condition: "-", comment: "", laborHrs: 4.5, materials: [{ n: "Cellular blackout shade", qty: 6, unitPrice: 65, c: 390 }] },
      { id: "shared01", detail: "Unit 605 — Patch and paint door frame", condition: "-", comment: "", laborHrs: 2, materials: [{ n: "Patch + paint", c: 30 }] },
    ] },
  ],
  workOrder: [
    { room: "Carpentry", detail: "Unit 603 — Install standard roller shades (6)", action: "", pri: "", hrs: 4, done: false, itemId: "ef410eef", tiers: ["base", "better"] },
    { room: "Carpentry", detail: "Unit 603 — Install blackout cellular shades (6)", action: "", pri: "", hrs: 4.5, done: false, itemId: "2ef1e754", tiers: ["best"] },
    { room: "Carpentry", detail: "Unit 605 — Patch and paint door frame", action: "", pri: "", hrs: 2, done: false, itemId: "shared01" },
  ],
});

const items = (rooms: Room[]) => rooms.flatMap((r) => r.items);

describe("readTierRooms", () => {
  it("fills item tiers from the work order (by itemId), shared lines stay in all options", () => {
    const rooms = readTierRooms<Room>(blob());
    const [roller, blackout, shared] = items(rooms);
    expect(roller.tiers).toEqual(["base", "better"]);
    expect(blackout.tiers).toEqual(["best"]);
    expect(shared.tiers).toBeUndefined();
    expect(itemTiers(shared)).toEqual(["base", "better", "best"]);
    // Never both shade options in one option.
    for (const t of ["base", "better", "best"] as const) {
      const shades = items(rooms).filter((it) => itemInTier(it, t) && /shades/.test(it.detail));
      expect(shades).toHaveLength(1);
    }
    expect(visibleTiers(items(rooms))).toEqual(["base", "best"]);
  });

  it("matches by trade + detail when the task has no itemId", () => {
    const b = blob();
    b.workOrder = b.workOrder.map((w) => ({ ...w, itemId: undefined as unknown as string }));
    const [roller, blackout] = items(readTierRooms<Room>(b));
    expect(roller.tiers).toEqual(["base", "better"]);
    expect(blackout.tiers).toEqual(["best"]);
  });

  it("an item's own tags win; a non-tiered quote is returned as saved", () => {
    const b = blob();
    (b.rooms[0].items[0] as { tiers?: string[] }).tiers = ["best"];
    expect(items(readTierRooms<Room>(b))[0].tiers).toEqual(["best"]);
    const plain = { ...blob(), tieredQuote: false };
    expect(readTierRooms(plain)).toBe(plain.rooms);
  });

  it("does not change the approval fingerprint input (saved lines)", () => {
    const b = blob();
    const before = scopeFingerprint(b.rooms as Room[]);
    readTierRooms(b);
    expect(scopeFingerprint(b.rooms as Room[])).toBe(before);
  });

  it("a missing tier name falls back to Essential / Complete / Premium", () => {
    expect(readQuoteSettings(blob()).tierNames).toEqual({ better: "Complete", best: "Premium" });
    expect(TIER_NAME.base).toBe("Essential");
  });

  it("the job summary describes one option, not both", () => {
    expect(summaryTasks(blob()).map((t) => t.task)).toEqual(["Install standard roller shades (6)", "Patch and paint door frame"]);
  });
});

describe("printed quote", () => {
  const job = (): Job => ({
    id: "71b12f98-0000-0000-0000-000000000000",
    property: "Grid 603-605",
    client: "Grid",
    rooms: JSON.stringify(blob()),
    total: 994.6, total_labor: 0, total_mat: 0, total_hrs: 0,
    status: "quoted",
    trade: "Carpentry",
  } as unknown as Job);

  it("renders option columns instead of one stacked total", () => {
    printed = "";
    openJobQuotePdf(job(), { name: "Creed", default_rate: 55, markup_pct: 10, tax_pct: 0, trip_fee: 0, min_labor_hours: 0 });
    expect(printed).toContain("Essential");
    expect(printed).toContain("Premium");
    expect(printed).not.toContain("GRAND TOTAL");
  });
});
