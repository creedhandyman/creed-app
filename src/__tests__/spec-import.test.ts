import {
  cleanDrafts, companionsToText, draftToRow, headerField, parseCsv, rowsToDrafts, rowsToText, textToCompanions,
} from "@/lib/spec-import";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas and newlines inside fields, CRLF and BOM", () => {
    const csv = '﻿Name,Brand,Price\r\n"Wall base, 4"" charcoal",Roppe,$114.00\r\n"Line one\nline two",Behr,52.98\r\n\r\n';
    expect(parseCsv(csv)).toEqual([
      ["Name", "Brand", "Price"],
      ['Wall base, 4" charcoal', "Roppe", "$114.00"],
      ["Line one\nline two", "Behr", "52.98"],
    ]);
  });
  it("uses tabs for a spreadsheet paste", () => {
    expect(parseCsv("Item\tBrand\nCarpet tile\tShaw")).toEqual([["Item", "Brand"], ["Carpet tile", "Shaw"]]);
  });
});

describe("headerField", () => {
  it.each([
    ["Product Name", "name"], ["Description", "name"], ["Manufacturer", "brand"], ["Model #", "model"],
    ["SKU", "sku"], ["Supplier", "store"], ["Unit Price", "unit_price"], ["Cost", "unit_price"],
    ["UOM", "unit"], ["Sold As", "pack_label"], ["Coverage", "coverage"], ["Category", "category"],
    ["Notes", "notes"], ["Random", null],
  ])("%s → %s", (h, f) => expect(headerField(h)).toBe(f));
});

describe("rowsToDrafts", () => {
  it("maps a recognizable sheet without the AI, skipping a title row", () => {
    const rows = [
      ["Grid PM Material Standards 2026"],
      ["Product", "Manufacturer", "Model", "UOM", "Price", "Notes"],
      ["Wall base 4in charcoal", "Roppe", "700", "coil", "114", "All units"],
      ["Interior paint satin", "Behr", "Marquee", "gal", "N/A", ""],
    ];
    const { mapped, drafts } = rowsToDrafts(rows);
    expect(mapped).toBe(true);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({ name: "Wall base 4in charcoal", brand: "Roppe", model: "700", unit: "coil", unit_price: 114, notes: "All units" });
    expect(drafts[1].unit_price).toBeNull(); // "N/A" never becomes a price
  });
  it("reports unmapped when no header row is found (goes to the AI)", () => {
    expect(rowsToDrafts([["Shaw carpet tile", "89.50"], ["Roppe base", "114"]]).mapped).toBe(false);
  });
  it("renders rows as text for the AI", () => {
    expect(rowsToText([["a", "b"], ["c", "d"]])).toBe("a\tb\nc\td\n");
  });
});

describe("cleanDrafts", () => {
  it("validates AI output: no invented prices, trimmed text, keyword strings split, dupes dropped", () => {
    const drafts = cleanDrafts([
      { name: " Infinium carpet tile ", brand: "Shaw", model: "5T193", unit_price: "$89.50", coverage: "24", keywords: "carpet, carpet squares",
        companions: [{ name: "Shaw 4151 adhesive", qty: 1, per: 400 }] },
      { name: "Infinium carpet tile", brand: "Shaw", model: "5T193" },
      { name: "", brand: "Nobody" },
      { name: "Elan lever", brand: "Schlage", unit_price: "call", pack_size: 0 },
      "junk",
    ]);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      name: "Infinium carpet tile", unit_price: 89.5, coverage: 24, keywords: ["carpet", "carpet squares"],
      companions: [{ name: "Shaw 4151 adhesive", qty: 1, per: 400 }],
    });
    expect(drafts[1]).toMatchObject({ name: "Elan lever", unit_price: null, pack_size: null });
  });
  it("returns [] for non-arrays", () => {
    expect(cleanDrafts({ items: [] })).toEqual([]);
  });
  it("builds an insert row with org, spec and sort", () => {
    const [d] = cleanDrafts([{ name: "A" }]);
    expect(draftToRow(d, "org1", "spec1", 3)).toMatchObject({ org_id: "org1", spec_id: "spec1", name: "A", sort: 3, keywords: [], companions: [] });
  });
});

describe("companion text", () => {
  it("round-trips 'qty name per amount' lines and skips junk", () => {
    const cs = textToCompanions("1 Shaw 4151 adhesive per 400\n2 T8 LED tube per 1\nnonsense line\n");
    expect(cs).toEqual([{ qty: 1, name: "Shaw 4151 adhesive", per: 400 }, { qty: 2, name: "T8 LED tube", per: 1 }]);
    expect(companionsToText(cs)).toBe("1 Shaw 4151 adhesive per 400\n2 T8 LED tube per 1");
  });
});
