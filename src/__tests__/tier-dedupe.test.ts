// parser.ts imports the Supabase client, which throws without env vars.
jest.mock("@/lib/supabase", () => ({ db: {}, supabase: {} }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));

import { validateQuote } from "@/lib/parser";
import type { Room, RoomItem } from "@/lib/types";

const line = (id: string, tiers?: RoomItem["tiers"]): RoomItem => ({
  id,
  detail: "Living Room — Paint walls",
  condition: "-",
  comment: "Paint walls",
  laborHrs: 4,
  materials: [{ n: "Wall paint (2 gal)", c: 70 }],
  ...(tiers ? { tiers } : {}),
});

const count = (rooms: Room[]) => rooms.reduce((n, r) => n + r.items.length, 0);

describe("validateQuote dedupe with Good-Better-Best", () => {
  test("the same task in different options is two lines", () => {
    const rooms: Room[] = [{ name: "Painting", items: [line("a", ["base", "better"]), line("b", ["best"])] }];
    expect(count(validateQuote(rooms, { skipCaps: true }))).toBe(2);
  });
  test("a true duplicate (same options) still collapses", () => {
    const rooms: Room[] = [{ name: "Painting", items: [line("a", ["best"]), line("b", ["best"])] }];
    expect(count(validateQuote(rooms, { skipCaps: true }))).toBe(1);
  });
  test("untagged duplicates still collapse (non-tiered quotes unchanged)", () => {
    const rooms: Room[] = [{ name: "Painting", items: [line("a"), line("b")] }];
    expect(count(validateQuote(rooms, { skipCaps: true }))).toBe(1);
  });
});

import { sharedSuppliesLines } from "@/lib/tiers";

describe("sharedSuppliesLines", () => {
  const work = (id: string, tiers: RoomItem["tiers"]): RoomItem => ({ ...line(id, tiers), detail: `Room ${id} — Paint`, laborHrs: 3 });
  const supplies = (id: string, tiers?: RoomItem["tiers"]): RoomItem => ({
    ...line(id, tiers), detail: `Whole Property — Painting Supplies ${id}`, laborHrs: 0,
  });
  test("flags a supplies line shared by options whose painting differs", () => {
    const rooms: Room[] = [{ name: "Painting", items: [work("t", ["base"]), work("r", ["best"]), supplies("s")] }];
    expect(sharedSuppliesLines(rooms).map((i) => i.id)).toEqual(["s"]);
  });
  test("per-option supplies lines pass", () => {
    const rooms: Room[] = [{ name: "Painting", items: [
      work("t", ["base"]), work("r", ["best"]), supplies("sb", ["base"]), supplies("sx", ["best"]),
    ] }];
    expect(sharedSuppliesLines(rooms)).toEqual([]);
  });
  test("a shared supplies line is fine when the work is the same in every option", () => {
    const rooms: Room[] = [{ name: "Painting", items: [work("t", ["base", "better", "best"]), supplies("s")] }];
    expect(sharedSuppliesLines(rooms)).toEqual([]);
  });
});
