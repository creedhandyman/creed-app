jest.mock("../lib/supabase", () => ({ supabase: {} }));
import { applyTogglesToBlob, woKey } from "../lib/wo-queue";

const blob = () => ({
  jobNotes: "keep me",
  photos: [{ url: "a.jpg" }],
  workOrder: [
    { room: "Kitchen", detail: "Install range hood", done: false },
    { room: "Kitchen", detail: "Patch drywall", done: true },
    { room: "Bath", detail: "Re-caulk tub", done: false },
  ],
});

describe("woKey", () => {
  it("is case/space-insensitive room|||detail", () => {
    expect(woKey({ room: " Kitchen ", detail: "Install Range Hood" })).toBe("kitchen|||install range hood");
  });
});

describe("applyTogglesToBlob", () => {
  it("sets done by key and keeps everything else in the blob", () => {
    const { data, applied } = applyTogglesToBlob(blob(), [
      { key: "kitchen|||install range hood", done: true },
      { key: "kitchen|||patch drywall", done: false },
    ]);
    expect(applied).toBe(2);
    const wo = data.workOrder as { done: boolean }[];
    expect(wo.map((w) => w.done)).toEqual([true, false, false]);
    expect(data.jobNotes).toBe("keep me");
    expect(data.photos).toEqual([{ url: "a.jpg" }]);
  });
  it("a task that no longer exists applies nothing", () => {
    const { applied } = applyTogglesToBlob(blob(), [{ key: "garage|||sweep", done: true }]);
    expect(applied).toBe(0);
  });
  it("no work order → untouched", () => {
    const d = { jobNotes: "x" };
    expect(applyTogglesToBlob(d, [{ key: "a|||b", done: true }])).toEqual({ data: d, applied: 0 });
  });
});
