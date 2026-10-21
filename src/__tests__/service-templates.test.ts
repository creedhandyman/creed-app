import {
  groupTemplates, moveTemplate, appendTemplateRooms, templateStats, nextSortOrder,
  matchesTemplate, type ServiceTemplate,
} from "@/lib/service-templates";
import type { Room } from "@/lib/types";

const line = (id: string, detail: string, hrs = 1, mat = 0) =>
  ({ id, detail, condition: "", comment: "", laborHrs: hrs, materials: mat ? [{ n: "x", c: mat, qty: 2 }] : [] });
const tpl = (id: string, name: string, extra: Partial<ServiceTemplate> = {}, rooms: Room[] = []): ServiceTemplate =>
  ({ id, org_id: "o", name, template_rooms: JSON.stringify(rooms), ...extra });

describe("service templates", () => {
  const list = [
    tpl("a", "Water heater swap", { category: "Plumbing", sort_order: 1 }),
    tpl("b", "Toilet rebuild", { category: "Plumbing", sort_order: 0, favorite: true }),
    tpl("c", "Fan install", { category: "Electrical" }),
    tpl("d", "Legacy thing", {}, [{ name: "Kitchen", items: [line("1", "Replace faucet cartridge")] }]),
  ];

  test("groups: favorites first, categories A→Z, Other last, ordered inside", () => {
    const g = groupTemplates(list);
    expect(g.map((x) => x.category)).toEqual(["Favorites", "Electrical", "Plumbing", "Other"]);
    expect(g[2].items.map((x) => x.id)).toEqual(["b", "a"]);
  });

  test("filter + search (incl. line text)", () => {
    expect(groupTemplates(list, "", "favorites").map((x) => x.category)).toEqual(["Favorites"]);
    expect(groupTemplates(list, "", "Plumbing").map((x) => x.category)).toEqual(["Plumbing"]);
    expect(matchesTemplate(list[3], "cartridge")).toBe(true);
    expect(groupTemplates(list, "plumb").flatMap((x) => x.items.map((i) => i.id))).toEqual(["b", "b", "a"]);
  });

  test("move renumbers the category and only returns changes", () => {
    expect(moveTemplate(list, "a", -1)).toEqual([{ id: "a", sort_order: 0 }, { id: "b", sort_order: 1 }]);
    expect(moveTemplate(list, "b", -1)).toEqual([]);
    const legacy = [tpl("x", "B"), tpl("y", "A")];
    expect(moveTemplate(legacy, "x", -1)).toEqual([{ id: "y", sort_order: 1 }]); // x is already 0
  });

  test("nextSortOrder", () => {
    expect(nextSortOrder(list, "Plumbing")).toBe(2);
    expect(nextSortOrder(list, "New")).toBe(0);
    expect(nextSortOrder(list, "")).toBe(1);
  });

  test("append joins same-named areas and re-ids lines", () => {
    let n = 0;
    const cur: Room[] = [{ name: "Kitchen", items: [line("k1", "Paint")] }];
    const add: Room[] = [{ name: "kitchen ", items: [line("t1", "Faucet")] }, { name: "Bath", items: [line("t2", "Toilet")] }, { name: "Empty", items: [] }];
    const out = appendTemplateRooms(cur, add, () => `n${n++}`);
    expect(out.map((r) => r.name)).toEqual(["Kitchen", "Bath"]);
    expect(out[0].items.map((i) => i.id)).toEqual(["k1", "n0"]);
    expect(out[1].items[0].id).toBe("n1");
    expect(cur[0].items).toHaveLength(1); // input untouched
  });

  test("stats", () => {
    expect(templateStats([{ name: "K", items: [line("1", "a", 1.5, 20), line("2", "b", 2)] }])).toEqual({ items: 2, hrs: 3.5, mat: 20 });
  });
});

test("canonCategory", () => {
  const { canonCategory } = jest.requireActual("@/lib/service-templates");
  const l = [{ id: "a", org_id: "o", name: "x", template_rooms: "[]", category: "Plumbing" }];
  expect(canonCategory(l, " plumbing ")).toBe("Plumbing");
  expect(canonCategory(l, "other")).toBe("");
  expect(canonCategory(l, "Doors  & trim")).toBe("Doors & trim");
});
