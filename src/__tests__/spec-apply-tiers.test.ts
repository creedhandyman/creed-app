import {
  applySpec, applySpecPicked, isSpecAlternate, matchSpecItem, normalizeSpecItems, planSpec, specConflict, specPlanDelta,
} from "@/lib/material-spec";
import type { Material } from "@/lib/types";

// Grid's real spec rows (customer a6804a1f), the carpet / base / VCT / toilet part.
const SPEC = normalizeSpecItems([
  { id: "shaw", category: "Carpet", name: "Shaw Profusion carpet tile 24 in, Infinium Tile, Plethora 00520 (Philadelphia Commercial), glue down",
    brand: "Shaw", model: "7L98100520", unit: "sf", unit_price: "3.28",
    keywords: ["carpet", "carpet tile", "carpet squares", "carpet square", "glue down carpet", "shaw", "infinium", "plethora"], sort: 0 },
  { id: "vct", category: "VCT", name: "Armstrong Standard Excelon Imperial Texture VCT 12 in, Sterling 51904", brand: "Armstrong",
    model: "51904031", unit: "sf", unit_price: "2.04", pack_size: "45", pack_label: "45 sf case",
    keywords: ["vct", "vinyl composition tile", "vinyl tile", "armstrong", "excelon"], sort: 1 },
  { id: "roppe", category: "Base", name: "Roppe 4 in thermoplastic rubber wall base, Charcoal", brand: "Roppe", model: "C40C73P123",
    unit: "lf", unit_price: "1.23", pack_size: "120", pack_label: "120 ft coil ($148.06)",
    keywords: ["vinyl base", "cove base", "rubber base", "wall base", "base", "roppe"], sort: 2 },
  { id: "toilet", category: "Toilet", name: "Glacier Bay 12 in rough-in two-piece 1.28 GPF elongated toilet, white, seat included",
    brand: "Glacier Bay", model: "N2428E", unit: "each", unit_price: "99.00", keywords: ["toilet", "replace toilet", "new toilet", "commode"], sort: 3 },
  { id: "tp", category: "Toilet paper holder", name: "Franklin Brass Futura recessed toilet paper holder, polished chrome",
    brand: "Franklin Brass", model: "D2497PC", unit: "each", unit_price: "19.98", keywords: ["toilet paper holder", "tp holder", "paper holder"], sort: 4 },
]);

const mat = (n: string, qty: number, unitPrice: number): Material => ({ n, qty, unitPrice, c: Math.round(qty * unitPrice * 100) / 100 });

/** Grid 606 carpet job eb5985e2 as saved: one line per option + base in all three. */
const carpetJob = () => [{
  name: "Flooring",
  items: [
    { id: "ess", tiers: ["base"], detail: "Carpet (Essential) — Remove carpet, pad and base, haul off; glue-down commercial level-loop roll carpet, no pad, charcoal close to Grid's tile spec, two 12 ft drops, one seam ~864 sf",
      comment: "Glue-down roll carpet, no pad, charcoal close to Grid's tile spec",
      materials: [mat("Commercial level-loop roll carpet sf (allowance)", 864, 1.75), mat("Multipurpose carpet adhesive pail", 2, 55), mat("Seam tape and seam sealer", 1, 30), mat("Dump fee", 1, 40)] },
    { id: "comp", tiers: ["better"], detail: "Carpet (Complete) — Remove carpet, pad and base, haul off; same roll carpet stretched in over new pad with tack strip, two 12 ft drops, one seam ~864 sf",
      comment: "Same roll carpet stretched in over new pad with tack strip",
      materials: [mat("Commercial level-loop roll carpet sf (allowance)", 864, 1.75), mat("Carpet pad sf (allowance)", 864, 0.55), mat("Tack strip (allowance)", 1, 60), mat("Seam tape", 1, 30), mat("Dump fee", 1, 40)] },
    { id: "prem", tiers: ["best"], detail: "Carpet (Premium) — Remove carpet, pad and base, haul off; glue-down Shaw Infinium carpet tile, Plethora 00520, per Grid's spec ~697 sf + 10%",
      comment: "Glue-down Shaw Infinium carpet tile per Grid's spec",
      materials: [mat("Shaw carpet tile sf (Grid spec)", 767, 3.0), mat("Carpet tile adhesive pail", 2, 55), mat("Dump fee", 1, 40)] },
    { id: "base", tiers: ["base", "better", "best"], detail: "Carpet — Roppe 4 in charcoal vinyl base ~100 lf, one 120 ft coil (Grid spec), all three options",
      comment: "",
      materials: [mat("Roppe 4 in charcoal base, 120 ft coil", 1, 140), mat("Cove base adhesive", 2, 15)] },
  ],
}];

describe("matching: a generic word is not enough", () => {
  it.each([
    "Commercial level-loop roll carpet sf (allowance)",
    "Carpet pad sf (allowance)",
    "Carpet pad",
    "Tack strip (allowance)",
    "Multipurpose carpet adhesive pail",
    "Carpet tile adhesive pail",
    "Seam tape and seam sealer",
    "Cove base adhesive",
    "Toilet wax ring",
    "Toilet supply line",
  ])("%s → no spec item", (n) => {
    expect(matchSpecItem(n, SPEC)).toBeNull();
  });

  it("still finds the real spec products", () => {
    expect(matchSpecItem("Shaw carpet tile sf (Grid spec)", SPEC)?.id).toBe("shaw");
    expect(matchSpecItem("Carpet squares", SPEC)?.id).toBe("shaw");
    expect(matchSpecItem("Carpet", SPEC)?.id).toBe("shaw");
    expect(matchSpecItem("Roppe 4 in charcoal base, 120 ft coil", SPEC)?.id).toBe("roppe");
    expect(matchSpecItem("Rubber cove base 4 in", SPEC)?.id).toBe("roppe");
    expect(matchSpecItem("Toilet", SPEC)?.id).toBe("toilet");
    expect(matchSpecItem("Toilet paper holder", SPEC)?.id).toBe("tp");
    expect(matchSpecItem("Excelon VCT tile", SPEC)?.id).toBe("vct");
  });

  it("roll carpet is a different form from carpet tile", () => {
    expect(specConflict("Broadloom carpet", SPEC[0])).toBe(true);
    expect(specConflict("Glue down carpet tile", SPEC[0])).toBe(false);
  });
});

describe("alternates", () => {
  it("allowances and lines written as non-spec alternates", () => {
    const job = carpetJob()[0].items;
    expect(isSpecAlternate(job[0], { n: "Multipurpose carpet adhesive pail" })).toBe(true); // "close to Grid's tile spec"
    expect(isSpecAlternate(job[1], { n: "Carpet pad sf (allowance)" })).toBe(true);
    expect(isSpecAlternate(job[2], { n: "Shaw carpet tile sf (Grid spec)" })).toBe(false);
    expect(isSpecAlternate({ detail: "Bath — Budget option, non-spec faucet" }, { n: "Faucet" })).toBe(true);
  });
});

describe("Apply client spec on the carpet job", () => {
  it("leaves Essential and Complete alone and only touches spec lines", () => {
    const rooms = carpetJob();
    const { rooms: out } = applySpec(rooms, SPEC);
    const [ess, comp, prem, base] = out[0].items;
    expect(ess.materials).toEqual(rooms[0].items[0].materials);
    expect(comp.materials).toEqual(rooms[0].items[1].materials);
    // Premium: the spec tile takes the spec name + price; its adhesive is untouched.
    expect(prem.materials[0]).toMatchObject({ qty: 767, unitPrice: 3.28, c: 2515.76, spec: { itemId: "shaw" } });
    expect(prem.materials[1]).toEqual(rooms[0].items[2].materials[1]);
    // Base (all three options): Roppe coil at spec price; cove base adhesive untouched.
    expect(base.materials[0]).toMatchObject({ qty: 1, unitPrice: 1.23, spec: { itemId: "roppe" } });
    expect(base.materials[1]).toEqual(rooms[0].items[3].materials[1]);
  });

  it("the preview lists every option's changes and changes nothing", () => {
    const rooms = carpetJob();
    const snapshot = JSON.stringify(rooms);
    const plan = planSpec(rooms, SPEC);
    expect(JSON.stringify(rooms)).toBe(snapshot);
    expect(plan.map((c) => [c.lineId, c.before.n, c.after.n, c.alternate])).toEqual([
      ["prem", "Shaw carpet tile sf (Grid spec)", expect.stringContaining("Shaw Profusion carpet tile"), false],
      ["base", "Roppe 4 in charcoal base, 120 ft coil", expect.stringContaining("Roppe 4 in thermoplastic rubber wall base"), false],
    ]);
    expect(plan[0].tiers).toEqual(["best"]);
    expect(plan[1].tiers).toEqual(["base", "better", "best"]);
  });

  it("applies only what was ticked", () => {
    const rooms = carpetJob();
    const plan = planSpec(rooms, SPEC);
    const picked = new Set([plan[1].key]); // base only
    const { rooms: out } = applySpecPicked(rooms, SPEC, picked);
    expect(out[0].items[2].materials).toEqual(rooms[0].items[2].materials); // Premium tile untouched
    expect(out[0].items[3].materials[0].spec?.itemId).toBe("roppe");
    expect(specPlanDelta(plan, picked)).toBeCloseTo(1.23 - 140, 2);
    expect(specPlanDelta(plan, new Set())).toBe(0);
  });

  it("an alternate is offered unticked but can be applied when picked", () => {
    const rooms = [{ name: "Flooring", items: [{ id: "x", detail: "Office — Carpet tile, budget alternate to spec", materials: [mat("Carpet tile", 100, 2.5)] }] }];
    const plan = planSpec(rooms, SPEC);
    expect(plan).toHaveLength(1);
    expect(plan[0].alternate).toBe(true);
    expect(applySpec(rooms, SPEC).rooms[0].items[0].materials).toEqual(rooms[0].items[0].materials);
    const picked = applySpecPicked(rooms, SPEC, new Set([plan[0].key])).rooms[0].items[0].materials[0];
    expect(picked).toMatchObject({ unitPrice: 3.28, spec: { itemId: "shaw" } });
  });

  it("re-running after apply proposes nothing", () => {
    const once = applySpec(carpetJob(), SPEC).rooms;
    expect(planSpec(once, SPEC)).toEqual([]);
  });
});
