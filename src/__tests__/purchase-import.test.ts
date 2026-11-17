import { parseCsv } from "@/lib/spec-import";
import {
  classifyLine, cleanPurchaseLines, currentPriceRow, detectPurchaseSheet, historyRow, historyRows, lineHash, matchSpecItems,
  newestPerProduct, normStore, parseDate, parseMoney, planPriceChanges, productKey, sheetToPurchases, specPricePatch,
  type PurchaseLine, type SpecPriceTarget,
} from "@/lib/purchase-import";

// Shaped exactly like a real Home Depot Pro "Purchase Tracking" item export
// (preamble, misleading price columns, a return, a tool, a discount).
const HD_ITEMS = [
  "Company Name,TEST CO",
  "Phone Number,555-555-0100",
  "Source,Purchase Tracking",
  "Date Range,01/01/26 to 07/04/26",
  "Export Date,July 3 2026 21:53:29",
  " ",
  "Date,Store Number,Transaction ID,Register Number,Job Name,SKU Number,SKU Description,Quantity,Unit Price,Department Name,Class Name,Subclass Name,Program Discount Amount,Program Discount Indicator,Other Discount Amount,Extended Retail (before discount),Net Unit Price,Internet SKU,Order Number,Invoice Number",
  "2026-07-03,2204,5650,0,140533,1012094373,6.75 in. Rain Repair Roof Collar Flashing,2,,BLDG. MATERIALS,,,$0.00,,$1.80,$16.16,$17.96,331181638,H2204-333871,2905184",
  "2026-07-03,2204,5650,0,140533,250905,1 qt. Ultra Pure White Ceiling Flat Interior Paint & Primer,1,,PAINT,INTERIOR PAINT,QUARTS,$0.00,,$0.00,$16.48,$16.48,100178852,H2204-333871,2905184",
  "2026-07-02,2205,7792,0,13973-1,644368,1 gal. Pure White Base 1 Semi-Gloss Interior Paint,1,,PAINT,INTERIOR PAINT,GLIDDEN PREMIUM,$0.00,,$0.00,$34.98,$34.98,206755807,H2205-296416,3904152",
  "2026-07-01,2204,5266,0,,1012262787,,5,,WALL&FLOOR COVER.,LAMINATE FLOORING,UNATTACHED BACK,$0.00,,$7.95,-$150.65,-$158.60,0,H2204-330080,4173516",
  "2026-06-20,2204,5100,0,140500,644368,1 gal. Pure White Base 1 Semi-Gloss Interior Paint,2,,PAINT,INTERIOR PAINT,GLIDDEN PREMIUM,$0.00,,$0.00,$63.96,$63.96,206755807,H2205-296416,3904152",
  "2026-04-15,2204,3883,0,piatt,692073,XL All Purpose Painters Coverall,1,,PAINT,TOOLS/SAFETY,,$0.00,,$0.00,$10.48,$10.48,203555476,,",
  "2026-04-15,2204,3883,0,piatt,555001,Delivery Fee,1,,SERVICES,,,$0.00,,$0.00,$79.00,$79.00,0,,",
].join("\n");

describe("parsers", () => {
  it.each([
    ["$1,234.50", 1234.5], ["-$150.65", -150.65], ["- $3.40", -3.4], ["(12.00)", -12], ["8", 8], ["N/A", null], ["", null],
  ])("money %s → %s", (v, n) => expect(parseMoney(v)).toBe(n));

  it.each([
    ["2026-07-03", "2026-07-03"], ["07/03/2026", "2026-07-03"], ["7/3/26", "2026-07-03"], ["31-Mar-2026", "2026-03-31"],
    ["Mar 31, 2026", "2026-03-31"], ["46206", "2026-07-03"], ["someday", null], ["13/40/2026", null],
  ])("date %s → %s", (v, d) => expect(parseDate(v)).toBe(d));

  it("names stores the same way", () => {
    expect(normStore("The Home Depot #2204")).toBe("Home Depot");
    expect(normStore("E. Wichita Lowe's")).toBe("Lowe's");
    expect(normStore("LOWES")).toBe("Lowe's");
    expect(normStore("")).toBeNull();
  });
});

describe("Home Depot item export", () => {
  const { format, lines } = sheetToPurchases(parseCsv(HD_ITEMS), "hd.csv");

  it("finds the header under the preamble", () => {
    expect(format).toBe("hd-items");
    expect(detectPurchaseSheet(parseCsv(HD_ITEMS)).header).toBe(5);
  });

  it("prices per unit from Extended Retail ÷ Quantity (after the discount), not Net Unit Price", () => {
    const flash = lines.find((l) => l.sku === "1012094373")!;
    expect(flash).toMatchObject({ unit_price: 8.08, qty: 2, total: 16.16, store: "Home Depot", date: "2026-07-03", job: "140533", model: "331181638", kind: "item" });
  });

  it("classifies returns, fees and tools", () => {
    expect(lines.find((l) => l.sku === "692073")!.kind).toBe("tool");
    expect(lines.find((l) => l.sku === "555001")!.kind).toBe("fee");
    // the return row has no description, so it is not a product line at all
    expect(lines.some((l) => l.sku === "1012262787")).toBe(false);
  });

  it("keeps the newest price per product", () => {
    const newest = newestPerProduct(lines.filter((l) => l.kind === "item"));
    const paint = newest.get("homedepot:sku:644368")!;
    expect(paint.date).toBe("2026-07-02");
    expect(paint.unit_price).toBe(34.98); // not the June 2-gallon line ($31.98 each)
  });
});

describe("order-only exports are recognized, not guessed at", () => {
  it("Lowe's Pro order export", () => {
    const csv = "Date,Purchased From,Fulfillment Type,PO Number,Order # / Trans. #,Tax,Order Total\n31-Mar-2026,In-Store,Carry With,smith,#762100164,$2.80,$40.12";
    expect(sheetToPurchases(parseCsv(csv), "l.csv")).toEqual({ format: "orders", lines: [], store: "Lowe's" });
  });
  it("HD transaction export", () => {
    const csv = "Source,Purchase Tracking\nDate,Transaction ID,Job Name,Pre-tax Amount,Total Amount Paid\n2026-04-15,3883,x,$31.44,$33.80";
    expect(sheetToPurchases(parseCsv(csv), "h.csv").format).toBe("orders");
  });
  it("random sheets are unknown", () => {
    expect(sheetToPurchases([["a", "b"], ["1", "2"]], "x.csv").format).toBe("unknown");
  });
});

describe("a generic item sheet", () => {
  it("uses Unit Price, else Total ÷ Qty, and reads model / store / PO", () => {
    const csv = [
      "Order Date,Store,Item #,Model #,Description,Qty,Price,Total,PO #",
      "03/31/2026,Lowe's,1234567,F51A ACC 619,Schlage Accent Lever Satin Nickel,4,$32.98,$131.92,BLUESTEM",
      "03/31/2026,Lowe's,7654321,,Roppe 700 Series Wall Base 4 in. x 120 ft Charcoal,2,,$228.00,BLUESTEM",
    ].join("\n");
    const { format, lines } = sheetToPurchases(parseCsv(csv), "lowes.csv");
    expect(format).toBe("items");
    expect(lines[0]).toMatchObject({ store: "Lowe's", sku: "1234567", model: "F51A ACC 619", unit_price: 32.98, qty: 4, po: "BLUESTEM", date: "2026-03-31" });
    expect(lines[1].unit_price).toBe(114);
  });
});

describe("classifyLine", () => {
  const base = { qty: 1, total: 10, unit_price: 10, department: null as string | null };
  it.each([
    ["DEWALT 20V MAX Cordless Drill/Driver Kit", "tool"],
    ["Milwaukee Hole Dozer Hole Saw Kit with drill bits", "item"], // consumables win over the tool word
    ["Behr Ultra Interior Paint 1 gal", "item"],
    ["Home Depot Protection Plan", "fee"],
    ["Mountain Dew 20 Oz.", "fee"],
    ["10-Year Battery Powered Smoke Detector (3-Pack)", "item"],
  ])("%s → %s", (description, kind) => expect(classifyLine({ ...base, description })).toBe(kind));
  it.each([
    ["TOOLS/SAFETY", "tool"], ["TOOLS", "tool"], ["ELECTRICAL / TOOLS & ACCESSORIES", "item"], ["HARDWARE / POWER TOOL ACCESSORIES", "item"],
  ])("department %s → %s", (department, kind) => expect(classifyLine({ ...base, description: "Thing", department })).toBe(kind));
  it("negative qty or total is a return; $0 is a fee", () => {
    expect(classifyLine({ ...base, qty: -1, description: "Paint" })).toBe("return");
    expect(classifyLine({ ...base, unit_price: 0, total: 0, description: "Paint" })).toBe("fee");
  });
});

const line = (p: Partial<PurchaseLine>): PurchaseLine => ({
  date: "2026-07-01", store: "Home Depot", sku: null, model: null, description: "Item", qty: 1, unit_price: 10, total: 10,
  job: null, po: null, department: null, kind: "item", source: "f.csv", index: 0, ...p,
});

describe("price plan", () => {
  it("new / update / same / older against what's on file", () => {
    const newest = newestPerProduct([
      line({ sku: "1", unit_price: 5, date: "2026-07-01" }),
      line({ sku: "2", unit_price: 6, date: "2026-07-01" }),
      line({ sku: "3", unit_price: 7, date: "2026-07-01" }),
      line({ sku: "4", unit_price: 8, date: "2026-05-01" }),
      line({ sku: "5", unit_price: 9, date: null }),
    ]);
    const plan = planPriceChanges(newest, [
      { product_key: "homedepot:sku:2", unit_price: 5.5, purchased_on: "2026-06-01" },
      { product_key: "homedepot:sku:3", unit_price: 7, purchased_on: "2026-06-01" },
      { product_key: "homedepot:sku:4", unit_price: 9, purchased_on: "2026-06-01" },
      { product_key: "homedepot:sku:5", unit_price: 1, purchased_on: "2026-06-01" },
    ]);
    const by = Object.fromEntries(plan.map((c) => [c.key, c.action]));
    expect(by).toEqual({
      "homedepot:sku:1": "new", "homedepot:sku:2": "update", "homedepot:sku:3": "same",
      "homedepot:sku:4": "older", "homedepot:sku:5": "older",
    });
    expect(plan[0].action).toBe("update"); // updates listed first
  });

  it("keys products by store + SKU, else model, else description", () => {
    expect(productKey(line({ sku: "644-368" }))).toBe("homedepot:sku:644368");
    expect(productKey(line({ model: "f51a acc 619" }))).toBe("homedepot:model:F51AACC619");
    expect(productKey(line({ store: null, description: "Wax Ring, w/ Bolts" }))).toBe("any:desc:wax ring w bolts");
  });
});

describe("spec matches", () => {
  const item = (p: Partial<SpecPriceTarget>): SpecPriceTarget => ({
    id: "i", name: "Item", brand: null, model: null, sku: null, store: null, unit: null, unit_price: null, price_updated_at: null, ...p,
  });
  const lines = [
    line({ sku: "1001552737", description: "Perfect Seal Toilet Wax Ring with Bolts", unit_price: 9.33, date: "2026-07-01" }),
    line({ sku: "200", model: "F51A ACC 619", description: "Schlage Accent Lever Satin Nickel", unit_price: 32.98, date: "2026-06-01" }),
    line({ sku: "300", description: "Roppe 700 Series Rubber Wall Base Charcoal 4 in. x 120 ft. Coil", unit_price: 114, date: "2026-05-01" }),
    line({ sku: "400", description: "DEWALT Cordless Drill", unit_price: 113.48, date: "2026-06-15" }),
    line({ sku: "500", description: "Roppe 700 Series Rubber Wall Base Charcoal 4 in. x 120 ft. Coil", unit_price: 99, date: "2026-07-02", kind: "return" }),
  ];

  it("matches by SKU, then model (in its column or the description), then brand + name", () => {
    const ms = matchSpecItems([
      item({ id: "wax", name: "Wax ring", sku: "1001552737" }),
      item({ id: "lever", name: "Accent lever", brand: "Schlage", model: "F51A-ACC-619" }),
      item({ id: "base", name: "Wall base charcoal coil", brand: "Roppe" }),
    ], lines);
    expect(ms.map((m) => [m.item.id, m.by, m.line.unit_price])).toEqual([
      ["wax", "sku", 9.33], ["lever", "model", 32.98], ["base", "name", 114], // the return line is never used
    ]);
  });

  it("never matches on one shared word, a different store, or the wrong brand", () => {
    const ms = matchSpecItems([
      item({ id: "bit", name: "Hole saw / drill bit", brand: "DEWALT" }), // only "drill"… not enough
      item({ id: "sw", name: "Wall base charcoal coil", brand: "Roppe", store: "Sherwin-Williams" }),
      item({ id: "brand", name: "Wall base charcoal coil", brand: "Johnsonite" }),
      item({ id: "none", name: "Carpet tile" }),
    ], lines);
    expect(ms).toEqual([]);
  });

  it("flags matches older than the spec's price, or with the same price", () => {
    const [older] = matchSpecItems([item({ sku: "200", unit_price: 30, price_updated_at: "2026-06-20T00:00:00Z" })], lines);
    expect(older.older).toBe(true);
    const [same] = matchSpecItems([item({ sku: "200", unit_price: 32.98 })], lines);
    expect(same.same).toBe(true);
  });

  it("builds the spec patch with date and source", () => {
    const [m] = matchSpecItems([item({ sku: "200" })], lines);
    expect(specPricePatch(m, "2026-11-18T00:00:00Z")).toEqual({
      unit_price: 32.98, price_updated_at: "2026-06-01T12:00:00Z", price_source: "Home Depot 2026-06-01 · f.csv", updated_at: "2026-11-18T00:00:00Z",
    });
  });
});

describe("receipts read by the AI", () => {
  it("validates lines, falls back to the receipt's date and store, never invents a price", () => {
    const out = cleanPurchaseLines([
      { sku: "123", description: "2x4x8 Stud", qty: 10, total: 35 },
      { description: "Caulk", qty: 2, unit_price: "4.98" },
      { description: "No price at all", qty: 1 },
      { description: "Returned trim", qty: -1, total: -12 },
      "junk",
    ], "receipt.jpg", { date: "2026-03-31", store: "Lowe's" });
    expect(out.map((l) => [l.description, l.unit_price, l.kind, l.date, l.store])).toEqual([
      ["2x4x8 Stud", 3.5, "item", "2026-03-31", "Lowe's"],
      ["Caulk", 4.98, "item", "2026-03-31", "Lowe's"],
      ["Returned trim", 12, "return", "2026-03-31", "Lowe's"],
    ]);
  });
});

describe("rows", () => {
  it("hashes a purchase, not its file or row", () => {
    const a = line({ sku: "1" });
    expect(lineHash(a)).toBe(lineHash({ ...a, source: "other.csv", index: 9 }));
    expect(lineHash(a)).not.toBe(lineHash(line({ sku: "1", unit_price: 11 })));
    expect(lineHash(a)).not.toBe(lineHash(a, 1));
    expect(lineHash(a)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("keeps repeated rows of one receipt, drops the same purchase from an overlapping export", () => {
    const coverall = line({ sku: "692073", description: "Coverall" });
    const rows = historyRows([
      { ...coverall, source: "april.csv", index: 0 },
      { ...coverall, source: "april.csv", index: 1 },
      { ...coverall, source: "april-again.csv", index: 0 },
      { ...coverall, source: "april-again.csv", index: 1 },
      { ...coverall, source: "april-again.csv", index: 2 }, // a third one only this export has
    ], "org1");
    expect(rows).toHaveLength(3);
  });
  it("history and current-price rows carry the org, key, date and source", () => {
    const l = line({ sku: "644368", job: "140533" });
    expect(historyRow(l, "org1")).toMatchObject({ org_id: "org1", product_key: "homedepot:sku:644368", purchased_on: "2026-07-01", job_ref: "140533", source: "f.csv" });
    const [c] = planPriceChanges(newestPerProduct([l]), []);
    expect(currentPriceRow(c, "org1")).toMatchObject({ org_id: "org1", product_key: "homedepot:sku:644368", unit_price: 10, purchased_on: "2026-07-01" });
  });
});
