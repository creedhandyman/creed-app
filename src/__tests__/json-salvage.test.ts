import { salvageJson } from "../lib/json-salvage";

const quote = {
  property: "123 Main St",
  client: "",
  rooms: [
    {
      name: "Carpentry",
      items: [
        { detail: "Kitchen — Replace cabinet door", laborHrs: 0.75, materials: [{ n: "Cabinet door", c: 40 }] },
        { detail: "Hall — Re-hang \"sticky\" door {closet}", laborHrs: 1, materials: [{ n: "Hinge", c: 6 }] },
      ],
    },
    {
      name: "Painting",
      items: [
        { detail: "Bedroom 1 — Repaint walls", laborHrs: 5, materials: [{ n: "Wall paint", c: 56 }, { n: "Primer", c: 22 }] },
        { detail: "Bedroom 2 — Repaint walls", laborHrs: 5, materials: [{ n: "Wall paint", c: 56 }] },
      ],
    },
  ],
  notes: ["Slab is fabricator-supplied"],
  crewSize: 2,
  estDays: 3,
};
const full = JSON.stringify(quote, null, 2);

describe("salvageJson", () => {
  it("parses a complete reply as-is, ignoring text around it", () => {
    const got = salvageJson("Here is the quote:\n```json\n" + full + "\n```\nLet me know.");
    expect(got).toEqual({ value: quote, truncated: false });
  });

  it("keeps every complete line item when the reply is cut mid-item", () => {
    // Cut inside the LAST item's materials.
    const cut = full.slice(0, full.indexOf('"Wall paint"', full.indexOf("Bedroom 2")) + 5);
    const got = salvageJson(cut);
    expect(got?.truncated).toBe(true);
    const v = got!.value as typeof quote;
    expect(v.property).toBe("123 Main St");
    expect(v.rooms.map((r) => r.items.length)).toEqual([2, 1]);
    expect(v.rooms[1].items[0]).toEqual(quote.rooms[1].items[0]);
  });

  it("never keeps a half-written item", () => {
    // Cut right after the second painting item's detail — before its hours.
    const cut = full.slice(0, full.indexOf("Bedroom 2 — Repaint walls") + 10);
    const v = salvageJson(cut)!.value as typeof quote;
    expect(v.rooms[1].items).toHaveLength(1);
    // Cut inside a string that contains braces and escaped quotes.
    const cut2 = full.slice(0, full.indexOf("{closet") + 3);
    const v2 = salvageJson(cut2)!.value as typeof quote;
    expect(v2.rooms).toHaveLength(1);
    expect(v2.rooms[0].items).toHaveLength(1);
  });

  it("returns null when there is nothing to recover", () => {
    expect(salvageJson("")).toBeNull();
    expect(salvageJson("I can't quote this.")).toBeNull();
    expect(salvageJson('{"property": "123 Ma')).toBeNull();
  });
});
