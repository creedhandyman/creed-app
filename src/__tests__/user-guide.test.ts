// The Ask Grizz guide: the Spanish copy must mirror the English one (same
// sections, same headings, same number of lines in each), so a topic added in
// English can't ship without its Spanish text.
jest.mock("@/lib/store", () => ({ useStore: jest.fn() }));
jest.mock("@/lib/i18n", () => ({ t: (k: string) => k, getLang: () => "en" }));
jest.mock("@/components/Grizz", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/Icon", () => ({ Icon: () => null }));
jest.mock("@/lib/platform-admin", () => ({ SUPPORT_EMAIL: "support@example.com" }));

import { SECTIONS } from "@/components/UserGuideModal";
import { SECTIONS_ES } from "@/components/user-guide-es";

describe("Ask Grizz guide", () => {
  it("has a Spanish version of every English section", () => {
    for (const s of SECTIONS) expect(SECTIONS_ES[s.id]).toBeDefined();
    expect(Object.keys(SECTIONS_ES).sort()).toEqual(SECTIONS.map((s) => s.id).sort());
  });

  it("has the same number of headings and lines in each section", () => {
    for (const s of SECTIONS) {
      const es = SECTIONS_ES[s.id];
      expect({ id: s.id, blocks: es.body.length }).toEqual({ id: s.id, blocks: s.body.length });
      s.body.forEach((b, i) => {
        expect({ id: s.id, block: i, lines: es.body[i].lines.length })
          .toEqual({ id: s.id, block: i, lines: b.lines.length });
        expect(!!es.body[i].heading).toBe(!!b.heading);
      });
    }
  });

  it("covers the newer features so Ask Grizz can find them", () => {
    const all = SECTIONS.flatMap((s) => s.body.flatMap((b) => [b.heading || "", ...b.lines])).join("\n").toLowerCase();
    for (const word of ["bank transfer", "tip", "card on file", "safety", "print", "material spec", "store purchase prices", "online booking", "promo code", "summary"]) {
      expect(all).toContain(word);
    }
  });
});
