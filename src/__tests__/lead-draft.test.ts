// parser.ts imports the Supabase client, which throws without env vars.
jest.mock("@/lib/supabase", () => ({ db: {}, supabase: {} }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/api-auth", () => ({ serviceClient: jest.fn() }));
jest.mock("@/lib/notify-server", () => ({ dispatchNotifications: jest.fn() }));

import { draftTotal } from "@/lib/lead-draft";
import { leadDraftTotal } from "@/lib/lead-draft-info";
import type { Room } from "@/lib/types";

const item = (id: string, hrs: number, mat: number) =>
  ({ id, detail: "x", condition: "", comment: "", laborHrs: hrs, materials: [{ n: "m", c: mat }] });

describe("draftTotal", () => {
  const rooms: Room[] = [{ name: "Plumbing", items: [item("1", 2, 100)] }, { name: "Carpentry", items: [item("2", 1, 0)] }];

  test("rate × hours + materials with tax/markup, trip fee, sales tax", () => {
    // 3h × $60 = 180 · materials 100 × 1.1 tax × 1.2 markup = 132 · trip 25 → 337 · 10% on total → 370.70
    expect(draftTotal(rooms, { default_rate: 60, material_tax_pct: 10, markup_pct: 20, trip_fee: 25, tax_pct: 10, tax_mode: "total" }, "1 Main St, Wichita, KS 67210"))
      .toBeCloseTo(370.7, 2);
  });
  test("trade rate + minimum labor floor", () => {
    expect(draftTotal(rooms, { default_rate: 50, trade_rates: JSON.stringify({ Plumbing: 90 }) }, "")).toBe(2 * 90 + 50 + 100);
    expect(draftTotal([{ name: "General", items: [item("1", 0.5, 0)] }], { default_rate: 80, min_labor_hours: 2 }, "")).toBe(160);
  });
});

describe("leadDraftTotal", () => {
  test("reads the draft only while the lead has no quote", () => {
    expect(leadDraftTotal(JSON.stringify({ leadDraft: { rooms: [{}], total: 480 } }))).toBe(480);
    expect(leadDraftTotal(JSON.stringify({ rooms: [{}], leadDraft: { rooms: [{}], total: 480 } }))).toBeNull();
    expect(leadDraftTotal(JSON.stringify({ leadDescription: "x" }))).toBeNull();
    expect(leadDraftTotal("not json")).toBeNull();
  });
});
