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
