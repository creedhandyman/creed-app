import { orderShopList, type GuideShopItem } from "../lib/guide-shop";

const key = (s: GuideShopItem) => `${s.n}|${s.trade || ""}`;
const item = (n: string, trade?: string, extra: Partial<GuideShopItem> = {}): GuideShopItem => ({ n, c: 1, trade, ...extra });

describe("orderShopList", () => {
  const auto = [item("Paint", "Painting"), item("Tape", "Painting"), item("Wax ring", "Plumbing"), item("Supply line", "Plumbing")];

  it("puts an edited item back in its original spot", () => {
    const out = orderShopList(auto, ["Paint|Painting"], [item("Paint 2 gal", "Painting", { replaces: "Paint|Painting" })], key);
    expect(out.map((s) => s.n)).toEqual(["Paint 2 gal", "Tape", "Wax ring", "Supply line"]);
  });

  it("keeps a custom item in its trade section and general ones at the bottom", () => {
    const out = orderShopList(auto, [], [item("Extra", "General"), item("Caulk", "Painting"), item("Screws", "Added on site")], key);
    expect(out.map((s) => s.n)).toEqual(["Paint", "Tape", "Caulk", "Wax ring", "Supply line", "Extra", "Screws"]);
  });

  it("legacy edited copies (no replaces) stay in their trade section", () => {
    const out = orderShopList(auto, ["Wax ring|Plumbing"], [item("Wax ring XL", "Plumbing")], key);
    expect(out.map((s) => s.n)).toEqual(["Paint", "Tape", "Supply line", "Wax ring XL"]);
  });
});
