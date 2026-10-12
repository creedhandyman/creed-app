import { applyAssistOps, optionDiffSummary } from "@/lib/assist-ops";
import { itemTiers } from "@/lib/tiers";
import type { Room, RoomItem } from "@/lib/types";

const it = (id: string, detail: string, extra: Partial<RoomItem> = {}): RoomItem => ({
  id, detail, condition: "-", comment: detail, laborHrs: 2, materials: [{ n: "Mat", c: 10 }], ...extra,
});
// A slice of a big make-ready: shared work + flooring + painting, all options.
const quote = (): Room[] => [
  { name: "Plumbing", items: [it("lid", "Bathroom 1 — Replace toilet tank lid")] },
  { name: "Flooring", items: [it("tile", "Kitchen — Replace cracked floor tile", { laborHrs: 4.6 })] },
  { name: "Painting", items: [it("touch", "Kitchen — Touch up walls", { laborHrs: 2 })] },
];
let n = 0;
const newId = () => `new${++n}`;
const find = (rooms: Room[], id: string) => rooms.flatMap((r) => r.items).find((i) => i.id === id);
const inOpt = (rooms: Room[], opt: "base" | "better" | "best") =>
  rooms.flatMap((r) => r.items).filter((i) => itemTiers(i).includes(opt)).map((i) => i.id).sort();

describe("applyAssistOps — scoped to one option", () => {
  test("Best: tile → LVP alternate leaves Base and Better untouched", () => {
    const before = quote();
    const r = applyAssistOps(before, {
      add: [{ trade: "Flooring", detail: "Kitchen — Replace tile with LVP", laborHrs: 8 }],
      remove: [{ key: "tile" }],
    }, { scope: "best", newId });
    expect(inOpt(r.rooms, "base")).toEqual(inOpt(before, "base"));
    expect(inOpt(r.rooms, "better")).toEqual(inOpt(before, "better"));
    expect(inOpt(r.rooms, "best")).not.toContain("tile");
    expect(itemTiers(find(r.rooms, "tile")!)).toEqual(["base", "better"]);
  });

  test("editing a shared line forks it: Best gets the full repaint, others keep the touch-up", () => {
    const r = applyAssistOps(quote(), {
      update: [{ key: "touch", patch: { detail: "Kitchen — Full repaint walls + ceiling", laborHrs: 8 } }],
    }, { scope: "best", newId });
    const orig = find(r.rooms, "touch")!;
    expect(orig.detail).toBe("Kitchen — Touch up walls");
    expect(orig.laborHrs).toBe(2);
    expect(itemTiers(orig)).toEqual(["base", "better"]);
    const fork = r.rooms.flatMap((x) => x.items).find((i) => i.detail.includes("Full repaint"))!;
    expect(fork.tiers).toEqual(["best"]);
    expect(fork.laborHrs).toBe(8);
    expect(r.forked).toBe(1);
  });

  test("membership changes to other options are blocked (the Better-drop bug)", () => {
    const r = applyAssistOps(quote(), {
      update: [{ key: "lid", patch: { tiers: ["base", "best"] } }],
    }, { scope: "best", newId });
    expect(itemTiers(find(r.rooms, "lid")!)).toEqual(["base", "better", "best"]);
    expect(r.blocked).toBe(1);
  });

  test("adds go to the scoped option only, whatever tiers the AI sent", () => {
    const r = applyAssistOps(quote(), { add: [{ detail: "Carpet stairs", tiers: ["base", "better", "best"] }] }, { scope: "better", newId });
    const added = r.rooms.flatMap((x) => x.items).find((i) => i.detail === "Carpet stairs")!;
    expect(added.tiers).toEqual(["better"]);
  });

  test("removing the only option's line deletes it", () => {
    const start = applyAssistOps(quote(), { add: [{ detail: "Best-only LVP" }] }, { scope: "best", newId }).rooms;
    const id = start.flatMap((x) => x.items).find((i) => i.detail === "Best-only LVP")!.id;
    const r = applyAssistOps(start, { remove: [{ key: id }] }, { scope: "best", newId });
    expect(find(r.rooms, id)).toBeUndefined();
  });
});

describe("applyAssistOps — all options", () => {
  test("tiersAdd / tiersRemove are deltas on the current set", () => {
    const r = applyAssistOps(quote(), { update: [{ key: "tile", patch: { tiersRemove: ["best"] } }] }, { newId });
    expect(itemTiers(find(r.rooms, "tile")!)).toEqual(["base", "better"]);
  });
  test("a line can't be left in no option", () => {
    const r = applyAssistOps(quote(), { update: [{ key: "lid", patch: { tiers: [] , tiersRemove: ["base", "better", "best"] } }] }, { newId });
    expect(itemTiers(find(r.rooms, "lid")!)).toEqual(["base", "better", "best"]);
    expect(r.blocked).toBe(1);
  });
  test("plain edits and removes behave as before", () => {
    const r = applyAssistOps(quote(), {
      update: [{ key: "touch", patch: { laborHrs: 3 } }],
      remove: [{ key: "lid" }],
    }, { newId });
    expect(find(r.rooms, "touch")!.laborHrs).toBe(3);
    expect(find(r.rooms, "lid")).toBeUndefined();
    expect(r.rooms.map((x) => x.name)).toEqual(["Flooring", "Painting"]);
  });
});

describe("new work goes in the option being organized", () => {
  test("an add with no option named lands in the default option only", () => {
    const r = applyAssistOps(quote(), { add: [{ detail: "Garage — Epoxy floor" }] }, { newId, defaultAddTiers: ["best"] });
    expect(r.rooms.flatMap((x) => x.items).find((i) => i.detail === "Garage — Epoxy floor")!.tiers).toEqual(["best"]);
  });
  test("an add the AI tagged for every option keeps all three", () => {
    const r = applyAssistOps(quote(), { add: [{ detail: "Fix leak", tiers: ["base", "better", "best"] }] }, { newId, defaultAddTiers: ["best"] });
    expect(r.rooms.flatMap((x) => x.items).find((i) => i.detail === "Fix leak")!.tiers).toEqual(["base", "better", "best"]);
  });
});

test("optionDiffSummary names exactly the options that changed", () => {
  const before = quote();
  const after = applyAssistOps(before, { remove: [{ key: "tile" }] }, { scope: "best", newId }).rooms;
  expect(optionDiffSummary(before, after, { better: "Better", best: "Best" })).toBe("Best −1");
});
