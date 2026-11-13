// parser.ts imports the Supabase client, which throws without env vars.
jest.mock("@/lib/supabase", () => ({ db: {}, supabase: {} }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));

import { validateQuote } from "@/lib/parser";
import { isPlumbingWork } from "@/lib/plumbing-trade";
import type { Room, RoomItem } from "@/lib/types";

let n = 0;
const item = (detail: string, comment = detail, extra: Partial<RoomItem> = {}): RoomItem => ({
  id: `i${++n}`,
  detail,
  condition: "-",
  comment,
  laborHrs: 2,
  materials: [{ n: "Materials", c: 40 }],
  ...extra,
});

/** Which trade bucket an item ends up in after validateQuote. */
const tradeOf = (rooms: Room[], id: string) =>
  rooms.find((r) => r.items.some((i) => i.id === id))?.name;

/** Put one line in the bucket the AI picked and see where it lands. */
const landsIn = (aiBucket: string, it: RoomItem) =>
  tradeOf(validateQuote([{ name: aiBucket, items: [it] }], { skipCaps: true }), it.id);

describe("plumbing work always lands under Plumbing", () => {
  test("shower valves the AI put under Carpentry move to Plumbing", () => {
    expect(landsIn("Carpentry", item("Master Bath — Replace two shower valves"))).toBe("Plumbing");
  });

  test("a shower valve that opens the wall for access is still Plumbing", () => {
    const it = item(
      "Hall Bath — Open wall from closet side, replace shower valve and cartridge, add blocking",
      "Valve leaks behind the wall; remove drywall for access",
    );
    expect(landsIn("Carpentry", it)).toBe("Plumbing");
  });

  test("tub/shower valve kits and cartridges are Plumbing", () => {
    expect(landsIn("Carpentry", item("Bathroom — Install new shower/tub valve kit"))).toBe("Plumbing");
    expect(landsIn("General", item("Bathroom — Replace tub valve cartridge"))).toBe("Plumbing");
  });

  test("faucets are Plumbing", () => {
    expect(landsIn("Carpentry", item("Kitchen — Replace kitchen faucet and supply lines"))).toBe("Plumbing");
    expect(landsIn("General", item("Bathroom — Replace bathroom sink faucet"))).toBe("Plumbing");
  });

  test("toilets are Plumbing", () => {
    expect(landsIn("Carpentry", item("Half Bath — Replace toilet, new wax ring and supply line"))).toBe("Plumbing");
    expect(landsIn("General", item("Bathroom — Repair running toilet (flapper and fill valve)"))).toBe("Plumbing");
  });

  test("shut-offs, PEX and SharkBite fittings are Plumbing", () => {
    expect(landsIn("Carpentry", item("Laundry — Replace leaking shut-off valves"))).toBe("Plumbing");
    expect(landsIn("General", item("Crawlspace — Repair PEX line with SharkBite couplings"))).toBe("Plumbing");
  });

  test("a line the owner added by hand keeps the trade he picked", () => {
    const it = item("Bathroom — Replace shower valve", "x", { userClassified: true });
    expect(landsIn("Carpentry", it)).toBe("Carpentry");
  });
});

describe("lines that only sit near plumbing keep their own trade", () => {
  test("the drywall patch after a valve swap stays out of Plumbing", () => {
    expect(isPlumbingWork("Hall Bath — Patch drywall where shower valve was accessed")).toBe(false);
    expect(landsIn("Carpentry", item("Hall Bath — Patch drywall where shower valve was accessed"))).toBe("Carpentry");
  });

  test("bath accessories by a fixture stay Carpentry", () => {
    expect(landsIn("Carpentry", item("Bathroom — Install grab bar next to toilet"))).toBe("Carpentry");
    expect(landsIn("Carpentry", item("Bathroom — Replace toilet paper holder"))).toBe("Carpentry");
  });

  test("a countertop with a faucet reset stays Carpentry", () => {
    expect(landsIn("Carpentry", item("Kitchen — Replace laminate countertop, reset sink and faucet"))).toBe("Carpentry");
  });

  test("an electrical item over a fixture stays Electrical", () => {
    expect(landsIn("Electrical", item("Bathroom — Replace exhaust fan above toilet"))).toBe("Electrical");
  });

  test("a fixture named only as the location doesn't count", () => {
    expect(isPlumbingWork("Toilet Room — Replace door")).toBe(false);
  });

  test("shower wall framing with no valve is still Carpentry", () => {
    expect(landsIn("Carpentry", item("Bathroom — Demo rotten shower wall framing"))).toBe("Carpentry");
  });
});
