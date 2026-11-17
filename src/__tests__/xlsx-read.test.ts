import { columnIndex, firstSheetPath, sharedStrings, sheetRows } from "@/lib/xlsx-read";

describe("xlsx-read", () => {
  it("reads the shared string table, joining rich-text runs and decoding entities", () => {
    const xml = `<sst><si><t>Product</t></si><si><r><t>Wall base </t></r><r><t xml:space="preserve">4&quot; charcoal</t></r></si><si/><si><t>Roppe &amp; Co</t></si></sst>`;
    expect(sharedStrings(xml)).toEqual(["Product", 'Wall base 4" charcoal', "", "Roppe & Co"]);
  });

  it("maps column letters", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("Z9")).toBe(25);
    expect(columnIndex("AB12")).toBe(27);
  });

  it("turns sheet XML into rows, filling skipped columns and reading every cell type", () => {
    const strings = ["Product", "Price", "Wall base"];
    const xml = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
      <row r="2"/>
      <row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" t="inlineStr"><is><t>Roppe</t></is></c><c r="C3"><f>A1*2</f><v>114.5</v></c><c r="D3" t="b"><v>1</v></c></row>
    </sheetData></worksheet>`;
    expect(sheetRows(xml, strings)).toEqual([
      ["Product", "", "Price"],
      ["Wall base", "Roppe", "114.5", "TRUE"],
    ]);
  });

  it("finds the first sheet through the workbook rels, with a fallback", () => {
    const wb = `<workbook><sheets><sheet name="Spec" sheetId="1" r:id="rId3"/></sheets></workbook>`;
    const rels = `<Relationships><Relationship Id="rId3" Type="x" Target="worksheets/sheet2.xml"/></Relationships>`;
    const names = ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"];
    expect(firstSheetPath(wb, rels, names)).toBe("xl/worksheets/sheet2.xml");
    expect(firstSheetPath("", "", ["xl/worksheets/sheet10.xml", "xl/worksheets/sheet2.xml"])).toBe("xl/worksheets/sheet2.xml");
    expect(firstSheetPath("", "", [])).toBeNull();
  });
});

import { readXlsxSheets, sheetList } from "@/lib/xlsx-read";

/** A tiny .xlsx built in memory: stored (uncompressed) zip entries. */
function storedZip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nm = enc.encode(name);
    const data = enc.encode(text);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(8, 0, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, nm.length, true);
    const local = new Uint8Array([...new Uint8Array(lh.buffer), ...nm, ...data]);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(10, 0, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, nm.length, true);
    ch.setUint32(42, offset, true);
    centrals.push(new Uint8Array([...new Uint8Array(ch.buffer), ...nm]));
    locals.push(local);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, centrals.length, true);
  eocd.setUint16(10, centrals.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

describe("xlsx-read: every sheet", () => {
  const wb = `<workbook><sheets>
    <sheet name="Flooring" sheetId="1" r:id="rId1"/>
    <sheet name="Paint &amp; Stain" sheetId="2" r:id="rId2"/>
    <sheet name="Empty" sheetId="3" r:id="rId3"/>
    <sheet name="Chart" sheetId="4" r:id="rId4"/>
  </sheets></workbook>`;
  const rels = `<Relationships>
    <Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/>
    <Relationship Id="rId2" Type="x" Target="/xl/worksheets/sheet2.xml"/>
    <Relationship Id="rId3" Type="x" Target="worksheets/sheet3.xml"/>
    <Relationship Id="rId4" Type="x" Target="chartsheets/sheet1.xml"/>
  </Relationships>`;
  const names = ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml", "xl/chartsheets/sheet1.xml"];

  it("lists worksheets in workbook order with their tab names, skipping chart sheets", () => {
    expect(sheetList(wb, rels, names)).toEqual([
      { name: "Flooring", path: "xl/worksheets/sheet1.xml" },
      { name: "Paint & Stain", path: "xl/worksheets/sheet2.xml" },
      { name: "Empty", path: "xl/worksheets/sheet3.xml" },
    ]);
  });

  it("falls back to the sheet files when the workbook is unreadable", () => {
    expect(sheetList("", "", ["xl/worksheets/sheet2.xml", "xl/worksheets/sheet1.xml"])).toEqual([
      { name: "Sheet1", path: "xl/worksheets/sheet1.xml" },
      { name: "Sheet2", path: "xl/worksheets/sheet2.xml" },
    ]);
  });

  it("reads every non-empty sheet of a real .xlsx zip", async () => {
    const zip = storedZip({
      "xl/workbook.xml": wb,
      "xl/_rels/workbook.xml.rels": rels,
      "xl/sharedStrings.xml": `<sst><si><t>Product</t></si><si><t>Price</t></si><si><t>Carpet tile</t></si><si><t>Satin paint</t></si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>89.5</v></c></row></sheetData></worksheet>`,
      "xl/worksheets/sheet2.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>52.98</v></c></row></sheetData></worksheet>`,
      "xl/worksheets/sheet3.xml": `<worksheet><sheetData/></worksheet>`,
      "xl/chartsheets/sheet1.xml": `<chartsheet/>`,
    });
    const sheets = await readXlsxSheets(new Blob([zip.buffer as ArrayBuffer]));
    expect(sheets).toEqual([
      { name: "Flooring", rows: [["Product", "Price"], ["Carpet tile", "89.5"]] },
      { name: "Paint & Stain", rows: [["Product", "Price"], ["Satin paint", "52.98"]] },
    ]);
  });
});
