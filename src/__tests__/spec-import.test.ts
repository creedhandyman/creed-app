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

import {
  batches, blankDraft, chunkPages, fileSizeLabel, imageBlocks, isGenericSheetName, mergeDrafts, planSheets,
  readSpecFiles, savableDrafts, specFileContentType, specFileKind, specFilePath,
} from "@/lib/spec-import";

describe("specFileKind", () => {
  it.each([
    ["Grid PM spec.PDF", "", "pdf"], ["prices.xlsx", "", "xlsx"], ["old.xls", "", "xls"], ["list.csv", "", "csv"],
    ["IMG_2231.HEIC", "", "image"], ["photo", "image/jpeg", "image"], ["notes.txt", "", "text"],
    ["export", "text/csv", "csv"], ["deck.pptx", "", null],
  ])("%s (%s) → %s", (name, type, kind) => expect(specFileKind(name, type)).toBe(kind));
});

describe("planSheets", () => {
  it("maps recognizable sheets directly, using a real tab name as the category", () => {
    const p = planSheets([
      { name: "Flooring", rows: [["Product", "Brand", "Price"], ["Carpet tile", "Shaw", "89.50"], ["Wall base", "Roppe", "114"]] },
      { name: "Sheet2", rows: [["Product", "Category", "Price"], ["Satin paint", "Interior paint", "52.98"], ["Primer", "", "30"]] },
    ]);
    expect(p.aiTexts).toEqual([]);
    expect(p.mappedSheets).toEqual(["Flooring", "Sheet2"]);
    expect(p.drafts.map((d) => [d.name, d.category])).toEqual([
      ["Carpet tile", "Flooring"], ["Wall base", "Flooring"],
      ["Satin paint", "Interior paint"], ["Primer", null], // a generic tab name never becomes a category
    ]);
  });

  it("sends sheets without headers to the AI, labelled, chunked, each chunk repeating the first row", () => {
    const rows = [["Spec book"], ...Array.from({ length: 30 }, (_, i) => [`Shaw tile style ${i}`, "89.50"])];
    const p = planSheets([{ name: "Carpet", rows }], 200);
    expect(p.drafts).toEqual([]);
    expect(p.aiSheets).toEqual(["Carpet"]);
    expect(p.aiTexts.length).toBeGreaterThan(1);
    for (const text of p.aiTexts) {
      expect(text.startsWith("Sheet: Carpet\nSpec book\n")).toBe(true);
      expect(text.length).toBeLessThanOrEqual(200);
    }
    const all = p.aiTexts.join("");
    for (let i = 0; i < 30; i++) expect(all.split(`Shaw tile style ${i}\t`).length - 1).toBe(1);
  });

  it("skips empty sheets and knows generic tab names", () => {
    expect(planSheets([{ name: "Blank", rows: [] }])).toEqual({ drafts: [], aiTexts: [], mappedSheets: [], aiSheets: [] });
    expect(isGenericSheetName("Sheet1")).toBe(true);
    expect(isGenericSheetName("Hoja 2")).toBe(true);
    expect(isGenericSheetName("")).toBe(true);
    expect(isGenericSheetName("Flooring")).toBe(false);
  });
});

describe("chunkPages", () => {
  it("groups whole pages under the limit, skips blank pages, and says which pages each chunk holds", () => {
    const pages = ["a".repeat(30), "", "b".repeat(30), "c".repeat(30)];
    const chunks = chunkPages(pages, 100);
    expect(chunks.map((c) => [c.from, c.to])).toEqual([[1, 3], [4, 4]]);
    expect(chunks[0].text).toContain("--- Page 1 ---");
    expect(chunks[0].text).toContain("--- Page 3 ---");
    expect(chunks[0].text).not.toContain("--- Page 2 ---");
    chunks.forEach((c) => expect(c.text.length).toBeLessThanOrEqual(100));
  });

  it("splits one oversized page on its lines, marking the continuation", () => {
    const big = Array.from({ length: 20 }, (_, i) => `line ${i} ${"x".repeat(20)}`).join("\n");
    const chunks = chunkPages(["short page", big], 150);
    expect(chunks[0]).toMatchObject({ from: 1, to: 1 });
    const p2 = chunks.filter((c) => c.from === 2);
    expect(p2.length).toBeGreaterThan(1);
    expect(p2[1].text.startsWith("--- Page 2 (continued) ---")).toBe(true);
    chunks.forEach((c) => expect(c.text.length).toBeLessThanOrEqual(150));
    const joined = p2.map((c) => c.text).join("");
    for (let i = 0; i < 20; i++) expect(joined).toContain(`line ${i} `);
  });

  it("returns nothing for empty input", () => {
    expect(chunkPages([], 100)).toEqual([]);
    expect(chunkPages(["  ", ""], 100)).toEqual([]);
  });
});

describe("merging and the review table", () => {
  it("merges parts and drops a product repeated on two pages", () => {
    const a = cleanDrafts([{ name: "Carpet tile", brand: "Shaw", model: "5T193", unit_price: 89.5 }]);
    const b = cleanDrafts([{ name: "carpet tile", brand: "shaw", model: "5t193" }, { name: "Wall base", brand: "Roppe" }]);
    const m = mergeDrafts([a, b]);
    expect(m.map((d) => d.name)).toEqual(["Carpet tile", "Wall base"]);
    expect(m[0].unit_price).toBe(89.5); // the first read wins
  });

  it("adds blank rows and saves only named rows, trimmed", () => {
    const rows = [{ ...blankDraft(), name: "  Satin paint " }, blankDraft(), { ...blankDraft(), name: "   " }];
    expect(savableDrafts(rows).map((d) => d.name)).toEqual(["Satin paint"]);
    expect(blankDraft()).toMatchObject({ name: "", unit_price: null, keywords: [], companions: [] });
  });

  it("batches lists", () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([], 3)).toEqual([]);
  });
});

describe("stored original files", () => {
  it("builds an org-scoped, safe storage path", () => {
    expect(specFilePath("org1", "spec1", "Grid PM — Spec Book (2026).PDF", 1700000000000))
      .toBe("org1/spec1/1700000000000-Grid-PM-Spec-Book-2026.pdf");
    expect(specFilePath("org1", "spec1", "../../etc/passwd", 5)).toBe("org1/spec1/5-passwd");
    expect(specFilePath("o", "s", "", 1)).toBe("o/s/1-spec");
    expect(specFilePath("o", "s", "C:\\Users\\me\\Spec.xlsx", 1)).toBe("o/s/1-Spec.xlsx");
  });

  it("reads the files list defensively", () => {
    expect(readSpecFiles(null)).toEqual([]);
    expect(readSpecFiles([{ path: "o/s/1-a.pdf", size: 1200 }, { name: "no path" }, "junk"])).toEqual([
      { path: "o/s/1-a.pdf", name: "1-a.pdf", size: 1200, type: "", uploaded_at: "" },
    ]);
  });

  it("stores each kind under a content type the bucket accepts", () => {
    expect(specFileContentType("pdf")).toBe("application/pdf");
    expect(specFileContentType("csv", "application/vnd.ms-excel")).toBe("text/csv");
    expect(specFileContentType("image", "image/png")).toBe("image/png");
    expect(specFileContentType("image", "")).toBe("image/jpeg");
    expect(fileSizeLabel(2_400_000)).toBe("2.4 MB");
    expect(fileSizeLabel(830_000)).toBe("830 KB");
  });
});

describe("imageBlocks (photos sent to the AI)", () => {
  it("accepts base64 or data URIs and builds image blocks", () => {
    const r = imageBlocks([{ data: "QUJD", media_type: "image/jpeg" }, { data: "data:image/png;base64,REVG" }]);
    expect(r.error).toBeUndefined();
    expect(r.blocks).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "REVG" } },
    ]);
    expect(imageBlocks(undefined)).toEqual({ blocks: [] });
  });

  it("refuses bad types, too many images and too many bytes", () => {
    expect(imageBlocks([{ data: "QUJD", media_type: "application/pdf" }]).error).toBeTruthy();
    expect(imageBlocks("nope").error).toBeTruthy();
    expect(imageBlocks(Array.from({ length: 9 }, () => ({ data: "QUJD", media_type: "image/jpeg" }))).error).toBeTruthy();
    expect(imageBlocks([{ data: "A".repeat(4_500_000), media_type: "image/jpeg" }]).error).toBeTruthy();
  });
});
