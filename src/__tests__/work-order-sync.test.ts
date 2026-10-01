// parser.ts (makeGuide's home) imports the Supabase client, which throws
// without env vars — stub it; the sync never touches the network.
jest.mock("@/lib/supabase", () => ({ db: {}, supabase: {} }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));

import { syncWorkOrder, quoteItemIds } from "@/lib/work-order-sync";
import { makeGuide, type GuideStep } from "@/lib/parser";
import type { Room, RoomItem } from "@/lib/types";

const item = (id: string, detail: string, extra: Partial<RoomItem> = {}): RoomItem => ({
  id,
  detail,
  condition: "-",
  comment: `${detail} notes`,
  laborHrs: 2,
  materials: [],
  ...extra,
});

const quote = (): Room[] => [
  { name: "Plumbing", items: [item("p1", "Kitchen — Replace faucet")] },
  { name: "Painting", items: [item("a1", "Bedroom — Paint walls", { laborHrs: 4 })] },
];

/** Loop the sync until stable, like the QuoteForge effect does. */
const settle = (steps: GuideStep[], rooms: Room[], known: Set<string>): GuideStep[] => {
  let cur = steps;
  for (let i = 0; i < 5; i++) {
    const next = syncWorkOrder(cur, rooms, known);
    if (!next) return cur;
    cur = next;
  }
  throw new Error("sync did not settle");
};

const editLine = (rooms: Room[], id: string, patch: Partial<RoomItem>): Room[] =>
  rooms.map((r) => ({ ...r, items: r.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));

describe("syncWorkOrder", () => {
  test("makeGuide links every task to its quote line", () => {
    const steps = makeGuide(quote()).steps;
    expect(steps.map((s) => s.itemId).sort()).toEqual(["a1", "p1"]);
  });

  test("a quote edit (text, hours, notes, condition) flows into its task", () => {
    const rooms = quote();
    let wo = settle(makeGuide(rooms).steps, rooms, quoteItemIds(rooms));
    const edited = editLine(rooms, "p1", {
      detail: "Kitchen — Replace faucet + supply lines",
      laborHrs: 3.5,
      comment: "Shut off under sink first",
      condition: "D",
    });
    wo = settle(wo, edited, quoteItemIds(rooms));
    const t = wo.find((s) => s.itemId === "p1")!;
    expect(t.detail).toBe("Kitchen — Replace faucet + supply lines");
    expect(t.hrs).toBe(3.5);
    expect(t.action).toBe("Shut off under sink first");
    expect(t.pri).toBe("HIGH");
  });

  test("a Guide-tab tweak survives an unrelated quote edit", () => {
    const rooms = quote();
    let wo = settle(makeGuide(rooms).steps, rooms, quoteItemIds(rooms));
    // Guide tab: custom instruction on the paint task.
    wo = wo.map((s) => (s.itemId === "a1" ? { ...s, action: "Use the satin from the garage" } : s));
    wo = settle(wo, rooms, quoteItemIds(rooms));
    // Quote tab: bump hours on the paint line + edit the faucet line.
    const edited = editLine(editLine(rooms, "a1", { laborHrs: 5 }), "p1", { laborHrs: 1 });
    wo = settle(wo, edited, quoteItemIds(rooms));
    const paint = wo.find((s) => s.itemId === "a1")!;
    expect(paint.hrs).toBe(5); // quote changed it → flows in
    expect(paint.action).toBe("Use the satin from the garage"); // quote didn't touch it → kept
  });

  test("deleting a line drops its task; custom tasks stay", () => {
    const rooms = quote();
    let wo = settle(makeGuide(rooms).steps, rooms, quoteItemIds(rooms));
    wo = [...wo, { room: "General", detail: "Haul debris", action: "", pri: "MED", hrs: 1, custom: true }];
    const without = rooms.filter((r) => r.name !== "Plumbing");
    wo = settle(wo, without, quoteItemIds(rooms));
    expect(wo.some((s) => s.itemId === "p1")).toBe(false);
    expect(wo.some((s) => s.detail === "Haul debris")).toBe(true);
    expect(wo).toHaveLength(2);
  });

  test("a new line gets a task; a task removed on purpose is not re-added", () => {
    const rooms = quote();
    const known = quoteItemIds(rooms);
    let wo = settle(makeGuide(rooms).steps, rooms, known);
    // Guide tab removes the paint task (caller marks it known).
    wo = wo.filter((s) => s.itemId !== "a1");
    known.add("a1");
    const added: Room[] = [...rooms, { name: "Electrical", items: [item("e1", "Hall — Swap GFCI")] }];
    wo = settle(wo, added, known);
    expect(wo.map((s) => s.itemId).sort()).toEqual(["e1", "p1"]);
  });

  test("an AI rewrite of a line's text updates the task instead of duplicating it", () => {
    const rooms = quote();
    let wo = settle(makeGuide(rooms).steps, rooms, quoteItemIds(rooms));
    const rewritten = editLine(rooms, "a1", { detail: "Bedroom 2 — Paint walls + ceiling" });
    wo = settle(wo, rewritten, quoteItemIds(rooms));
    expect(wo.filter((s) => s.itemId === "a1")).toHaveLength(1);
    expect(wo).toHaveLength(2);
  });

  test("legacy saved tasks (no line id) re-link by text and heal stale fields", () => {
    const rooms = editLine(quote(), "p1", { laborHrs: 6 }); // quote edited before this fix
    const legacy: GuideStep[] = [
      { room: "Plumbing", detail: "Kitchen — Replace faucet", action: "Bring adapter", pri: "MED", hrs: 2 },
      { room: "Painting", detail: "Bedroom — Paint walls", action: "", pri: "MED", hrs: 4 },
    ];
    const wo = settle(legacy, rooms, quoteItemIds(rooms));
    const faucet = wo.find((s) => s.itemId === "p1")!;
    expect(faucet.hrs).toBe(6); // stale hours healed from the quote
    expect(faucet.action).toBe("Bring adapter"); // hand-written instruction kept
    expect(wo.find((s) => s.itemId === "a1")!.action).toBe("Bedroom — Paint walls notes"); // blank → from quote
    expect(wo).toHaveLength(2);
  });

  test("returns null when nothing changed (lets React skip the re-render)", () => {
    const rooms = quote();
    const wo = settle(makeGuide(rooms).steps, rooms, quoteItemIds(rooms));
    expect(syncWorkOrder(wo, rooms, quoteItemIds(rooms))).toBeNull();
  });
});
