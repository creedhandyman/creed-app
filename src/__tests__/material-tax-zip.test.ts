import { materialTaxFor, parseRateReply, zipTaxMap } from "../lib/material-tax";

describe("material tax by ZIP", () => {
  const org = {
    material_tax_pct: 7.5,
    material_tax_by_zip: { "67002": { rate: 8.5, place: "Andover, KS", source: "lookup", at: "" }, bad: { rate: 5 } },
  };
  it("uses the ZIP's rate when known, else the default", () => {
    expect(materialTaxFor(org, "67002")).toEqual({ rate: 8.5, known: true, place: "Andover, KS" });
    expect(materialTaxFor(org, "67207")).toEqual({ rate: 7.5, known: false });
    expect(materialTaxFor(org, "")).toEqual({ rate: 7.5, known: false });
    expect(materialTaxFor(null, "67207")).toEqual({ rate: 0, known: false });
  });
  it("drops malformed entries", () => {
    expect(Object.keys(zipTaxMap(org.material_tax_by_zip))).toEqual(["67002"]);
    expect(zipTaxMap({ "67207": { rate: 40 } })).toEqual({});
    expect(zipTaxMap("not json")).toEqual({});
  });
  it("parses the model reply", () => {
    expect(parseRateReply('Here: {"rate": 7.5, "place": "Wichita, KS"}')).toEqual({ rate: 7.5, place: "Wichita, KS" });
    expect(parseRateReply('{"rate": "8.75"}')).toEqual({ rate: 8.75, place: undefined });
    expect(parseRateReply('{"rate": 99}')).toBeNull();
    expect(parseRateReply("no idea")).toBeNull();
  });
});
