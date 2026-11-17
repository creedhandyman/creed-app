import {
  applySpec, matchSpecItem, normalizeSpecItems, specDisplayName, specItemsForRequest,
  specMatchCount, specNotes, specPromptBlock, toSellingUnits, normUnit, type SpecItem,
} from "@/lib/material-spec";
import type { Material } from "@/lib/types";

// A Grid-style spec, as Supabase returns it (numerics as strings).
const RAW = [
  { id: "carpet", name: "Infinium carpet tile", brand: "Shaw", model: "5T193", unit: "box", unit_price: "89.50",
    coverage: "24", coverage_unit: "sqft", category: "Carpet tile", trade: "Flooring",
    companions: [{ name: "Shaw 4151 tile adhesive", qty: 1, per: 400, item_id: "adhesive" }], sort: 0 },
  { id: "adhesive", name: "4151 tile adhesive", brand: "Shaw", unit: "pail", unit_price: "142", category: "Adhesive", sort: 1 },
  { id: "base", name: "4in wall base, charcoal", brand: "Roppe", model: "700 Series", unit: "coil",
    unit_price: "114.00", pack_size: "120", pack_label: "120 ft coil", keywords: ["baseboard", "cove base"], category: "Wall base", sort: 2 },
  { id: "paint", name: "Marquee interior satin", brand: "Behr", unit: "gal", unit_price: "52.98",
    coverage: "350", coverage_unit: "sqft", category: "Interior paint", sort: 3 },
  { id: "light", name: "LED-ready wraparound fixture 4ft", brand: "Halco", model: "WRAP4", unit: "ea", unit_price: null,
    companions: [{ name: "T8 LED tube 4ft", qty: 2, per: 1 }], category: "Light fixture", sort: 4 },
  { id: "lever", name: "Elan passage lever", brand: "Schlage", model: "F10 ELA 619", unit: "ea", unit_price: "38", category: "Door lever", sort: 5 },
  { id: "", name: "no id is dropped" },
  { id: "x", name: "   " },
];
const SPEC = normalizeSpecItems(RAW);

const room = (mats: Material[] & Array<Material & { u?: string }>) => [
  { name: "Unit 4B", items: [{ id: "a", detail: "Replace flooring", materials: mats }] },
];

describe("normalizeSpecItems", () => {
  it("coerces numeric strings, keeps sort order, drops rows without id/name", () => {
    expect(SPEC.map((s) => s.id)).toEqual(["carpet", "adhesive", "base", "paint", "light", "lever"]);
    expect(SPEC[0].unit_price).toBe(89.5);
    expect(SPEC[2].pack_size).toBe(120);
    expect(SPEC[4].unit_price).toBeNull();
    expect(SPEC[0].companions).toEqual([{ name: "Shaw 4151 tile adhesive", qty: 1, per: 400, item_id: "adhesive" }]);
  });
  it("parses companions stored as a JSON string and drops bad ones", () => {
    const [it] = normalizeSpecItems([{ id: "a", name: "A", companions: '[{"name":"B","qty":2,"per":1},{"name":"","qty":1,"per":1},{"name":"C","qty":0,"per":1}]' }]);
    expect(it.companions).toEqual([{ name: "B", qty: 2, per: 1 }]);
  });
});

describe("names + units", () => {
  it("adds brand/model only when the name lacks them, plus the pack label", () => {
    expect(specDisplayName(SPEC[2])).toBe("Roppe 4in wall base, charcoal 700 Series (120 ft coil)");
    expect(specDisplayName({ id: "z", name: "Behr Marquee satin", brand: "Behr" })).toBe("Behr Marquee satin");
  });
  it("normalizes common unit spellings", () => {
    expect(normUnit("Sq Ft")).toBe("sqft");
    expect(normUnit("linear feet")).toBe("ft");
    expect(normUnit("Gallons")).toBe("gal");
    expect(normUnit("each")).toBe("ea");
  });
});

describe("toSellingUnits", () => {
  const base = SPEC[2], paint = SPEC[3];
  it("converts a measure-unit quantity to whole packs (150 ft of base = 2 coils)", () => {
    expect(toSellingUnits(150, "ft", base)).toEqual({ units: 2, measure: 150 });
    expect(toSellingUnits(120, "lf", base)).toEqual({ units: 1, measure: 120 });
  });
  it("rounds selling units up (2.3 gal → 3)", () => {
    expect(toSellingUnits(2.3, "gal", paint).units).toBe(3);
    expect(toSellingUnits(1.25, undefined, base).units).toBe(2);
  });
  it("uses coverage for sqft (800 sqft of paint → 3 gal)", () => {
    expect(toSellingUnits(800, "sqft", paint)).toEqual({ units: 3, measure: 800 });
  });
  it("never returns less than one unit", () => {
    expect(toSellingUnits(0, undefined, base).units).toBe(1);
  });
});

describe("matchSpecItem", () => {
  it("matches the exact spec name the AI was told to write", () => {
    expect(matchSpecItem("Roppe 4in wall base, charcoal 700 Series (120 ft coil)", SPEC)?.id).toBe("base");
    expect(matchSpecItem("Shaw Infinium carpet tile", SPEC)?.id).toBe("carpet");
  });
  it("matches by model number", () => {
    expect(matchSpecItem("Passage set F10 ELA 619", SPEC)?.id).toBe("lever");
  });
  it("matches owner keywords", () => {
    expect(matchSpecItem("Rubber cove base", SPEC)?.id).toBe("base");
  });
  it("never matches on ONE shared common word (the 'Drill' bug)", () => {
    expect(matchSpecItem("Interior paint brush", SPEC)).toBeNull();
    expect(matchSpecItem("Carpet pad", SPEC)).toBeNull();
    expect(matchSpecItem("Toilet flapper", SPEC)).toBeNull();
  });
});

describe("applySpec", () => {
  it("takes spec name + price and rounds base to coils", () => {
    const { rooms, stats } = applySpec(room([{ n: "Roppe 4in wall base, charcoal", qty: 150, u: "ft", c: 150 } as Material]), SPEC);
    const m = rooms[0].items[0].materials[0];
    expect(m).toMatchObject({ n: "Roppe 4in wall base, charcoal 700 Series (120 ft coil)", qty: 2, unitPrice: 114, c: 228 });
    expect(m.spec).toEqual({ itemId: "base", brand: "Roppe", model: "700 Series" });
    expect((m as { u?: string }).u).toBeUndefined();
    expect(stats).toMatchObject({ materials: 1, matched: 1, companionsAdded: 0, priceNeeded: [] });
  });

  it("adds companions from the spec (carpet tile → adhesive per 400 sqft)", () => {
    const { rooms, stats } = applySpec(room([{ n: "Shaw Infinium carpet tile", qty: 900, u: "sqft", c: 0 } as Material]), SPEC);
    const [tile, glue] = rooms[0].items[0].materials;
    expect(tile).toMatchObject({ qty: 38, unitPrice: 89.5, c: 3401 }); // 900/24 = 37.5 → 38 boxes
    expect(glue).toMatchObject({ n: "Shaw 4151 tile adhesive", qty: 3, unitPrice: 142, c: 426 }); // 900/400 → 3 pails
    expect(glue.spec).toMatchObject({ itemId: "adhesive", companionOf: "carpet" });
    expect(stats.companionsAdded).toBe(1);
  });

  it("adds non-spec companions with a price-needed flag (fixture → 2 tubes each)", () => {
    const { rooms, stats } = applySpec(room([{ n: "Halco LED-ready wraparound fixture 4ft", qty: 3, unitPrice: 60, c: 180 }]), SPEC);
    const [fx, tubes] = rooms[0].items[0].materials;
    expect(fx).toMatchObject({ qty: 3, unitPrice: 60, c: 180 });
    expect(fx.spec?.priceNeeded).toBe(true);
    expect(tubes).toMatchObject({ n: "T8 LED tube 4ft", qty: 6, c: 0 });
    expect(tubes.spec).toMatchObject({ companionOf: "light", priceNeeded: true });
    expect(stats.priceNeeded).toEqual(["Halco LED-ready wraparound fixture 4ft WRAP4"]);
  });

  it("leaves unmatched materials exactly as they were", () => {
    const mats: Material[] = [{ n: "Toilet flapper", c: 7 }, { n: "Wax ring", qty: 1, unitPrice: 8, c: 8 }];
    const { rooms, stats } = applySpec(room(mats), SPEC);
    expect(rooms[0].items[0].materials).toEqual(mats);
    expect(stats).toMatchObject({ materials: 2, matched: 0 });
  });

  it("is idempotent — a second run changes nothing and adds no companions", () => {
    const once = applySpec(room([{ n: "Shaw Infinium carpet tile", qty: 900, u: "sqft", c: 0 } as Material]), SPEC);
    const twice = applySpec(once.rooms, SPEC);
    expect(twice.rooms).toEqual(once.rooms);
    expect(twice.stats.companionsAdded).toBe(0);
  });

  it("replaces a companion the AI wrote itself instead of doubling it", () => {
    const { rooms } = applySpec(room([
      { n: "Shaw Infinium carpet tile", qty: 400, u: "sqft", c: 0 } as Material,
      { n: "Shaw 4151 tile adhesive", qty: 5, c: 700 },
    ]), SPEC);
    const glue = rooms[0].items[0].materials.filter((m) => m.spec?.itemId === "adhesive");
    expect(glue).toHaveLength(1);
    expect(glue[0].qty).toBe(1);
  });

  it("does nothing without spec items", () => {
    const r = room([{ n: "Shaw Infinium carpet tile", c: 10 }]);
    expect(applySpec(r, []).rooms).toBe(r);
  });

  it("counts matches for the quote header, ignoring companions and placeholders", () => {
    const { rooms } = applySpec(room([
      { n: "Shaw Infinium carpet tile", qty: 48, u: "sqft", c: 0 } as Material,
      { n: "Carpet pad", c: 40 },
      { n: "Materials", c: 0 },
    ]), SPEC);
    expect(specMatchCount(rooms)).toEqual({ matched: 1, total: 2 });
  });
});

describe("prompt block", () => {
  it("lists every item of a small spec with price, coverage and companions", () => {
    const p = specPromptBlock(SPEC, "Replace baseboard in unit 4B", "Grid Property Management");
    expect(p).toContain("CLIENT MATERIAL SPEC — Grid Property Management requires these exact products");
    expect(p).toContain("- Roppe 4in wall base, charcoal 700 Series (120 ft coil) | $114/coil | 1 coil = 120 (120 ft coil) | Wall base");
    expect(p).toContain("- Behr Marquee interior satin | $52.98/gal | 1 gal covers 350 sqft | Interior paint");
    expect(p).toContain("price? per ea");
    expect(p).toContain("+ companions added automatically");
  });
  it("is empty with no spec", () => {
    expect(specPromptBlock([], "anything")).toBe("");
  });
  it("sends only request-matched items (and their categories) for a big spec", () => {
    const big: SpecItem[] = Array.from({ length: 300 }, (_, i) => ({ id: `f${i}`, name: `Filler widget model ${i}`, category: "Misc" }));
    big.push({ id: "b1", name: "Rubber wall base charcoal", category: "Wall base" });
    big.push({ id: "b2", name: "Rubber wall base black", category: "Wall base" });
    const picked = specItemsForRequest(big, "Install new rubber wall base charcoal in hallway");
    expect(picked.map((p) => p.id)).toEqual(["b1", "b2"]);
  });
});

describe("specNotes", () => {
  it("summarizes matches and missing prices", () => {
    expect(specNotes({ materials: 4, matched: 3, companionsAdded: 1, priceNeeded: ["Halco fixture"] }, "Grid")).toEqual([
      "Client spec: 3 of 4 materials use Grid's spec products (+1 companion item).",
      "No price on the spec for: Halco fixture. The cost shown is an estimate — check it.",
    ]);
  });
});
