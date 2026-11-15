import { approvalState, scopeFingerprint } from "@/lib/approval";
import type { Room } from "@/lib/types";

const all = ["base", "better", "best"] as ("base" | "better" | "best")[];
const mustFix = (): Room[] => [
  { name: "General", items: [{ id: "a", detail: "Patch ceiling", condition: "-", comment: "", laborHrs: 3, materials: [], tiers: [...all] }, { id: "b", detail: "Paint ceiling", condition: "-", comment: "", laborHrs: 2, materials: [], tiers: [...all] }] },
] as Room[];

describe("approvalState with a picked tier", () => {
  it("an all-must-fix tiered quote prints as signed (no options to show)", () => {
    const rooms = mustFix();
    const a = { signature: "Jane", record: { fp: scopeFingerprint(rooms), tier: "base" }, acceptedTier: "base" as const };
    expect(approvalState(a as never, rooms, { tiersShown: false })).toBe("signed");
  });

  it("a real split printed without its options is still revised", () => {
    const rooms = mustFix();
    rooms[0].items[1].tiers = ["better", "best"];
    const a = { signature: "Jane", record: { fp: scopeFingerprint(rooms), tier: "better" }, acceptedTier: "better" as const };
    expect(approvalState(a as never, rooms, { tiersShown: false })).toBe("revised");
    expect(approvalState(a as never, rooms, { tiersShown: true })).toBe("signed");
  });
});
