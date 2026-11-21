import {
  storedItems,
  cleanSku, isSupplyStore, learnableItems, receiptDescription, receiptLog, receiptPurchaseLines, type ScannedItem,
} from "@/lib/receipt-lines";
import { productKey } from "@/lib/purchase-import";

// A Home Depot receipt as the scan returns it: printed short codes, the plain
// name, the store's item number, qty and the LINE total.
const HD: { vendor: string; date: string; items: ScannedItem[] } = {
  vendor: "The Home Depot #2204",
  date: "2026-11-18",
  items: [
    { name: "2X4X8 SPF #2", product: "2 in. x 4 in. x 8 ft. SPF #2 stud lumber", sku: "161640", qty: 10, price: 38.5 },
    { name: "1/2 PVC CPLG", product: "1/2 in. PVC coupling", sku: "0000-193-682", qty: 4, price: 2.72 },
    { name: "GLD SEMI WHT 1G", product: "", sku: "644368", qty: 1, price: 34.98 },
    { name: "DWLT 20V DRILL KIT", product: "DeWalt 20V drill kit", sku: "1004567", qty: 1, price: 113.48 },
    { name: "1/4 DRILL BIT", product: "1/4 in. drill bit", sku: "330011", qty: 1, price: 4.97 },
    { name: "POWERADE 28OZ", product: "Powerade 28 oz", sku: "998877", qty: 1, price: 2.48 },
    { name: "PRO XTRA DISCOUNT", product: "", sku: "", qty: 1, price: -3.85 },
    { name: "DRYWALL SCREW 1LB", product: "Drywall screws, 1 lb", sku: "N/A", qty: 1, price: 0 },
  ],
};
const ORG = "00000000-0000-0000-0000-000000000001";

describe("which receipts count", () => {
  it.each(["The Home Depot #2204", "LOWE'S HOME CENTERS", "Lowes", "MENARDS - WICHITA WEST", "Sherwin-Williams", "Star Lumber & Supply"])(
    "%s is a supply store", (v) => expect(isSupplyStore(v)).toBe(true));
  it.each(["QuikTrip #327", "Chick-fil-A", "Walmart", ""])("%s is not", (v) => expect(isSupplyStore(v)).toBe(false));
});

describe("names and item numbers", () => {
  it("leads with the plain name and keeps the printed code", () => {
    expect(receiptDescription(HD.items[0])).toBe("2 in. x 4 in. x 8 ft. SPF #2 stud lumber (2X4X8 SPF #2)");
  });
  it("falls back to the printed text when no plain name was read", () => {
    expect(receiptDescription(HD.items[2])).toBe("GLD SEMI WHT 1G");
  });
  it("doesn't repeat a name that is the same either way", () => {
    expect(receiptDescription({ name: "PAINT ROLLER", product: "Paint roller" })).toBe("Paint roller");
  });
  it("keeps real item numbers, drops junk", () => {
    expect(cleanSku("0000-193-682")).toBe("0000-193-682");
    expect(cleanSku("SKU# 161640")).toBe("161640");
    expect(cleanSku("N/A")).toBe("");
    expect(cleanSku("")).toBe("");
  });
});

describe("a scanned Home Depot receipt", () => {
  const lines = receiptPurchaseLines(HD, { job: "123 N Main St, Wichita KS 67202" });

  it("reads every priced line with the price paid PER UNIT", () => {
    expect(lines).toHaveLength(7); // the $0 line has no price to log
    expect(lines[0]).toMatchObject({
      description: "2 in. x 4 in. x 8 ft. SPF #2 stud lumber (2X4X8 SPF #2)", sku: "161640", qty: 10,
      unit_price: 3.85, total: 38.5, store: "Home Depot", date: "2026-11-18", kind: "item",
      job: "123 N Main St, Wichita KS 67202",
    });
    expect(lines[1]).toMatchObject({ sku: "0000-193-682", qty: 4, unit_price: 0.68 });
  });

  it("tells tools, snacks and discounts from materials (a bit is a material)", () => {
    const kind = (sku: string) => lines.find((l) => l.sku === sku)!.kind;
    expect(kind("1004567")).toBe("tool");
    expect(kind("330011")).toBe("item");
    expect(kind("998877")).toBe("fee");
    expect(lines.find((l) => /DISCOUNT/.test(l.description))!.kind).toBe("return");
  });

  const log = receiptLog(lines, ORG);

  it("logs every bought line to the history, tools marked as tools", () => {
    expect(log.history).toHaveLength(5); // 4 materials + the drill
    expect(log.history.every((r) => r.org_id === ORG && r.store === "Home Depot" && r.purchased_on === "2026-11-18")).toBe(true);
    const drill = log.history.find((r) => r.sku === "1004567")!;
    expect(drill).toMatchObject({ department: "TOOLS", unit_price: 113.48 });
    expect(log.history.find((r) => r.sku === "161640")).toMatchObject({ qty: 10, unit_price: 3.85, total: 38.5 });
    expect(log.skipped).toEqual({ returns: 1, fees: 1 });
  });

  it("the drill never becomes a material price", () => {
    const rows = log.prices([]);
    expect(rows).toHaveLength(4);
    expect(rows.some((r) => r.sku === "1004567")).toBe(false);
    expect(rows.find((r) => r.sku === "161640")).toMatchObject({
      product_key: "homedepot:sku:161640", unit_price: 3.85, purchased_on: "2026-11-18",
      description: "2 in. x 4 in. x 8 ft. SPF #2 stud lumber (2X4X8 SPF #2)",
    });
  });

  it("an older receipt never replaces a newer price; the same price isn't rewritten", () => {
    const key = productKey(lines[0]);
    expect(log.prices([{ product_key: key, unit_price: 4.1, purchased_on: "2026-11-19" }]).some((r) => r.product_key === key)).toBe(false);
    expect(log.prices([{ product_key: key, unit_price: 3.85, purchased_on: "2026-11-01" }]).some((r) => r.product_key === key)).toBe(false);
    expect(log.prices([{ product_key: key, unit_price: 3.58, purchased_on: "2026-11-01" }]).find((r) => r.product_key === key)).toMatchObject({ unit_price: 3.85 });
  });

  it("scanning the same receipt twice logs the same lines (the DB keeps one)", () => {
    const again = receiptLog(receiptPurchaseLines(HD, { job: "123 N Main St, Wichita KS 67202" }), ORG);
    expect(again.history.map((r) => r.line_hash)).toEqual(log.history.map((r) => r.line_hash));
    expect(new Set(log.history.map((r) => r.line_hash)).size).toBe(5);
  });

  it("two identical lines on one receipt are both kept", () => {
    const twice = receiptPurchaseLines({ ...HD, items: [HD.items[1], HD.items[1]] });
    expect(new Set(receiptLog(twice, ORG).history.map((r) => r.line_hash)).size).toBe(2);
  });
});

describe("what the quoting AI learns", () => {
  it("materials only, per unit — never the drill, the drink or the discount", () => {
    const learned = learnableItems(HD);
    expect(learned.map((l) => l.sku)).toEqual(["161640", "0000-193-682", "644368", "330011"]);
    expect(learned[0].unit_price).toBe(3.85);
  });
});

describe("Lowe's and Menards receipts", () => {
  it("name the store the same way every time", () => {
    const lowes = receiptPurchaseLines({ vendor: "LOWE'S HOME CENTERS, LLC", date: "2026-11-02", items: [{ name: "2-4-8 STUD", product: "2 in. x 4 in. x 8 ft. stud", sku: "6005", qty: 2, price: 7.96 }] });
    expect(lowes[0]).toMatchObject({ store: "Lowe's", unit_price: 3.98, sku: "6005" });
    const men = receiptPurchaseLines({ vendor: "MENARDS WICHITA WEST", date: "", items: [{ name: "JOINT COMPOUND 4.5G", sku: "1311650", qty: 1, price: 16.98 }] });
    expect(men[0]).toMatchObject({ store: "Menards", date: null, unit_price: 16.98 });
    expect(productKey(men[0])).toBe("menards:sku:1311650");
  });
});

describe("storedItems (the item list kept on the receipt row)", () => {
  it("keeps name, plain name, item number, quantity and line price", () => {
    expect(storedItems([{ name: "STRT CPLG", product: "1/2 in. SharkBite coupling", sku: "SKU: 1001234", qty: 2, price: 18.72, junk: 1 }]))
      .toEqual([{ name: "STRT CPLG", product: "1/2 in. SharkBite coupling", sku: "1001234", qty: 2, price: 18.72 }]);
  });
  it("keeps returns and discount lines (it is what the receipt said)", () => {
    expect(storedItems([{ name: "PRO XTRA DISCOUNT", price: -4.5 }])).toEqual([{ name: "PRO XTRA DISCOUNT", price: -4.5 }]);
  });
  it("drops empty lines and bad values, and never throws on a bad column", () => {
    expect(storedItems([null, {}, { name: "  " }, { name: "Elbow", qty: -1, price: "5" }])).toEqual([{ name: "Elbow" }]);
    expect(storedItems(null)).toEqual([]);
    expect(storedItems("oops")).toEqual([]);
    expect(storedItems({ a: 1 })).toEqual([]);
  });
});
