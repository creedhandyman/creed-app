import { billedMaterial } from "../lib/pricing";

describe("billedMaterial", () => {
  it("is shelf cost when no tax or markup", () => {
    expect(billedMaterial(100, {})).toBe(100);
    expect(billedMaterial(100, { materialTaxPct: 0, markupPct: 0 })).toBe(100);
  });
  it("adds the purchase sales tax", () => {
    expect(billedMaterial(100, { materialTaxPct: 7.5 })).toBe(107.5);
  });
  it("marks up the taxed cost", () => {
    expect(billedMaterial(100, { materialTaxPct: 7.5, markupPct: 20 })).toBe(129);
    expect(billedMaterial(100, { markupPct: 20 })).toBe(120);
  });
});
