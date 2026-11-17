// parser.ts imports the Supabase client, which throws without env vars.
jest.mock("@/lib/supabase", () => ({ db: {}, supabase: {} }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));

import { bestTrade, overrideTrade, pickTrade, rescueTrade, scoreTrades } from "@/lib/trade-classify";
import { validateQuote } from "@/lib/parser";
import type { Room, RoomItem } from "@/lib/types";

const item = (detail: string, comment = "", mats: string[] = [], extra: Partial<RoomItem> = {}): RoomItem => ({
  id: Math.random().toString(36).slice(2, 10),
  detail,
  condition: "-",
  comment,
  laborHrs: 1,
  materials: mats.map((n) => ({ n, c: 10 })),
  ...extra,
});

/** Grid 606 water-damage job (eabb353f), lines exactly as the AI bucketed them. */
const grid606 = {
  floodCut: item(
    "Water damage — Flood cut east wall 2 ft x ~15 lf (incl. 9 in rotted hole), pull wet insulation, mold treat, moisture check before closing",
    "Flood cut east wall 2 ft x ~15 lf (incl. 9 in rotted hole), pull wet insulation, mold treat, moisture check before closing",
    ["Mold killer spray", "Plastic sheeting/disposal bags"],
  ),
  drywall: item(
    "Water damage — Moisture-resistant drywall 2 ft x 15 lf, tape, 3 coats, texture to match, Zinsser Cover Stain, Behr Marquee Ultra Pure White",
    "Moisture-resistant drywall 2 ft x 15 lf, tape, 3 coats, texture to match, Zinsser Cover Stain, Behr Marquee Ultra Pure White",
    ["1/2 in moisture-resistant drywall 4x8", "Mud, tape and screws", "Zinsser Cover Stain primer, 1 gal (Grid spec)", "Behr Marquee satin Ultra Pure White, qt"],
  ),
  slab: item(
    "Water damage — Outside: seal slab cracks and slab-to-wall joint on 606's east side, backer rod and self-leveling sealant",
    "Outside: seal slab cracks and slab-to-wall joint on 606's east side, backer rod and self-leveling sealant",
    ["Self-leveling concrete sealant", "Backer rod"],
  ),
  regrade: item(
    "Water damage — Outside: pull back rock, regrade soil to slope away from east wall, reset rock",
    "Outside: pull back rock, regrade soil to slope away from east wall, reset rock",
    ["Fill dirt bag"],
  ),
  gaskets: item("Water damage — Reseal gasket gaps on the first two front windows", "Reseal gasket gaps on the first two front windows", ["Glazing gasket/sealant"]),
};

describe("Grid 606 water-damage lines", () => {
  it("never lands in Plumbing", () => {
    expect(pickTrade(grid606.floodCut, "Plumbing")).toBe("Carpentry");
    expect(pickTrade(grid606.drywall, "Painting")).toBe("Carpentry");
    expect(pickTrade(grid606.slab, "Painting")).toBe("General");
    expect(pickTrade(grid606.regrade, "General")).toBe("General");
    expect(pickTrade(grid606.gaskets, "Carpentry")).toBe("Carpentry");
    for (const it of Object.values(grid606)) expect(scoreTrades(it).Plumbing).toBe(0);
  });

  it("the whole quote re-buckets through validateQuote", () => {
    const rooms: Room[] = [
      { name: "Plumbing", items: [grid606.floodCut] },
      { name: "Carpentry", items: [grid606.gaskets] },
      { name: "Painting", items: [grid606.drywall, grid606.slab] },
      { name: "General", items: [grid606.regrade] },
    ];
    const out = validateQuote(JSON.parse(JSON.stringify(rooms)), { skipCaps: true });
    expect(out.map((r) => r.name)).not.toContain("Plumbing");
    const tradeOf = (d: string) => out.find((r) => r.items.some((i) => i.detail.includes(d)))?.name;
    expect(tradeOf("Flood cut")).toBe("Carpentry");
    expect(tradeOf("Moisture-resistant drywall")).toBe("Carpentry");
    expect(tradeOf("seal slab cracks")).toBe("General");
  });
});

describe("damage words alone are not plumbing", () => {
  it.each([
    "Bedroom — Repair water-damaged drywall below window",
    "Hallway — Leak repair on drywall ceiling, tape and texture",
    "Basement — Remove wet carpet pad after flood",
    "Kitchen — Moisture check behind base cabinet",
  ])("%s", (d) => {
    expect(scoreTrades(item(d)).Plumbing).toBe(0);
  });

  it("but a plumbing object still is", () => {
    expect(bestTrade(item("Kitchen — Repair leaking supply line under sink")).trade).toBe("Plumbing");
    expect(bestTrade(item("Bathroom — Replace leaking faucet cartridge")).trade).toBe("Plumbing");
    expect(bestTrade(item("Laundry — Replace corroded shut-off valve")).trade).toBe("Plumbing");
    expect(bestTrade(item("Whole property — [T&M] Assess hot water tank")).trade).toBe("Plumbing");
    expect(bestTrade(item("Downstairs — Emergency access clean outs")).trade).toBe("Plumbing");
  });

  it("word-bounded plumbing nouns: drainage, caulk tube, disposal bags, paint sprayer", () => {
    expect(scoreTrades(item("Yard — Regrade for drainage away from foundation")).Plumbing).toBe(0);
    expect(scoreTrades(item("Garage — Clean up", "", ["Caulk tube", "Disposal bags"])).Plumbing).toBe(0);
    expect(scoreTrades(item("Bedroom — Spray ceiling with paint sprayer")).Plumbing).toBe(0);
  });
});

describe("real misses from saved quotes (AI bucket rescued)", () => {
  it.each<[string, string, string, string]>([
    ["Plumbing", "Kitchen — Upgrade outlet to GFCI", "Switch outlet to GFCI as required. Install GFCI outlet at kitchen location per code.", "Electrical"],
    ["Plumbing", "Laundry Room — Re-secure loose cabinet handles", "Handles on cabinets are loose and need to be re-secured.", "Carpentry"],
    ["Plumbing", "Appliances — [T&M] Vacuum water from refrigerator and determine source of pooling", "Water pooling inside new refrigerator.", "General"],
    ["Painting", "Kitchen ceiling — Install new drywall patch, tape and mud", "Add backing as needed and hang a new 1/2 in drywall section, cut in around the existing vent opening.", "Carpentry"],
    ["Painting", "Water-damaged wall/ceiling area — Remove and replace two 4x8 drywall panels, replace insulation, hang and finish", "Tear out the water-stained drywall, replace the wet insulation behind it.", "Carpentry"],
    ["Painting", "Hallway — Patch fist-size drywall hole and match texture", "Cut out damaged area, install drywall backing and patch, tape and mud.", "Carpentry"],
  ])("%s → %s", (bucket, detail, comment, want) => {
    expect(pickTrade(item(detail, comment), bucket)).toBe(want);
  });

  it("keeps the AI bucket when the line gives no clear evidence", () => {
    expect(pickTrade(item("Kitchen — [T&M] Investigate active leak in kitchen ceiling"), "Plumbing")).toBe("Plumbing");
    expect(pickTrade(item("Recreation Room — Touch up stained walls after drywall repair", "Touch-up paint on stained walls"), "Painting")).toBe("Painting");
    // Faucet swap that also patches the wall behind it — plumbing wins the bucket.
    expect(pickTrade(item("Kitchen — Replace faucet and patch drywall behind sink"), "Plumbing")).toBe("Plumbing");
  });
});

describe("overrides kept from the old classifier", () => {
  it.each<[string, string]>([
    ["Kitchen — Replace laminate countertop", "Carpentry"],
    ["Bathroom — Demo rotten shower wall framing", "Carpentry"],
    ["Living Room — Replace large windows (new, full replacement)", "Carpentry"],
    ["Bedroom — Paint new six-panel door", "Painting"],
    ["Bathroom — Caulk baseboards", "Painting"],
    ["Front door — Remove wasp nest at door", "General"],
  ])("%s → %s", (d, want) => {
    expect(pickTrade(item(d), "General")).toBe(want);
  });

  it("caulk on concrete / masonry is General, not Painting", () => {
    expect(overrideTrade(item("Driveway — Caulk expansion joints in concrete"))).toBe("General");
    expect(overrideTrade(item("Bathroom — Re-caulk window trim"))).toBe("Painting");
  });
});

describe("the owner's pick sticks", () => {
  it("userClassified keeps the bucket even against strong evidence", () => {
    expect(pickTrade(item("Bathroom — Replace toilet", "", [], { userClassified: true }), "Carpentry")).toBe("Carpentry");
    const rooms: Room[] = [{ name: "Plumbing", items: [item("Water damage — Flood cut wall", "", [], { userClassified: true })] }];
    expect(validateQuote(rooms, { skipCaps: true })[0].name).toBe("Plumbing");
  });

  it("a non-trade bucket falls to the scorer", () => {
    expect(pickTrade(item("Replace kitchen faucet"), "Kitchen")).toBe("Plumbing");
    expect(pickTrade(item("Something vague"), "Kitchen")).toBe("General");
  });

  it("rescue needs real evidence", () => {
    expect(rescueTrade(item("Look at it"), "Plumbing")).toBeNull();
  });
});
