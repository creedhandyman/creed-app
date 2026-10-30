import { buildQuoteSave, dominantTrade, type QuoteSaveInput } from "../lib/quote-save";
import type { Room, RoomItem } from "../lib/types";
import type { GuideStep } from "../lib/parser";

const item = (id: string, detail: string, extra: Partial<RoomItem> = {}): RoomItem => ({
  id, detail, condition: "-", comment: "", laborHrs: 1, materials: [], ...extra,
});
const step = (room: string, detail: string, extra: Partial<GuideStep> = {}): GuideStep => ({
  room, detail, action: "do it", pri: "MED", hrs: 1, ...extra,
});

function input(over: Partial<QuoteSaveInput> = {}): QuoteSaveInput {
  const rooms: Room[] = [{ name: "Plumbing", items: [item("a", "Replace faucet"), item("b", "Fix drain")] }];
  return {
    rooms,
    workers: [{ id: "u1", name: "Jordan" }],
    jobPhotos: [],
    steps: [step("Plumbing", "Replace faucet", { itemId: "a" }), step("Plumbing", "Fix drain", { itemId: "b" })],
    guideSteps: [step("Plumbing", "GUIDE FALLBACK")],
    guideState: { customTools: [], customShop: [], checkedTools: [], checkedShop: [], removedGuideShop: [] },
    settings: {
      discount: null, laborRate: null, minLaborHours: null, taxMode: null, materialTaxPct: 7.5, materialTaxZip: "67202",
      tieredQuote: false, tierNames: { better: "Better", best: "Best" }, crewSize: null, estDays: null,
    },
    pricing: {
      gt: 300, tl: 200, tm: 100, th: 2,
      tierTotals: { base: 100, better: 200, best: 300 },
      tierBreakdown: {
        base: { labor: 60, mat: 40, hrs: 1 }, better: { labor: 120, mat: 80, hrs: 2 }, best: { labor: 200, mat: 100, hrs: 3 },
      },
      headlineKey: "best", hasSplit: true,
    },
    inspection: null,
    prev: null,
    identity: { editing: false, property: "1 Main St", client: "Pat", createdBy: "Bernard", trade: "Plumbing", today: "2026-10-29" },
    ...over,
  };
}

describe("new quote", () => {
  it("is 'quoted', dated today, and carries the editor's totals", () => {
    const { row, blob } = buildQuoteSave(input());
    expect(row).toMatchObject({
      property: "1 Main St", client: "Pat", job_date: "2026-10-29", status: "quoted",
      total: 300, total_labor: 200, total_mat: 100, total_hrs: 2, trade: "Plumbing", created_by: "Bernard",
    });
    expect(JSON.parse(row.rooms)).toEqual(JSON.parse(JSON.stringify(blob)));
    expect(blob.workers).toEqual([{ id: "u1", name: "Jordan" }]);
    expect(blob.materialTaxPct).toBe(7.5);
    expect(blob.materialTaxZip).toBe("67202");
  });

  it("only links a customer / address when there is one", () => {
    expect(buildQuoteSave(input()).row).not.toHaveProperty("customer_id");
    const r = buildQuoteSave(input({ identity: { ...input().identity, customerId: "c1", addressId: "ad1" } })).row;
    expect(r).toMatchObject({ customer_id: "c1", address_id: "ad1" });
  });
});

describe("editing", () => {
  const prev = (status: string, blob = {}) => ({ blob, status });
  const editing = { ...input().identity, editing: true };

  it("keeps the job's status, never demoting it, and doesn't move job_date", () => {
    for (const st of ["active", "complete", "invoiced", "paid", "scheduled", "accepted"]) {
      const { row } = buildQuoteSave(input({ prev: prev(st), identity: editing }));
      expect(row.status).toBe(st);
      expect(row).not.toHaveProperty("job_date");
    }
  });

  it("promotes a lead to quoted on its first quote", () => {
    expect(buildQuoteSave(input({ prev: prev("lead"), identity: editing })).row.status).toBe("quoted");
  });

  it("an edit whose row wasn't found in the store still doesn't re-date the job, and starts quoted", () => {
    const { row } = buildQuoteSave(input({ prev: null, identity: editing }));
    expect(row).not.toHaveProperty("job_date");
    expect(row.status).toBe("quoted");
  });

  it("keeps keys it doesn't own, and clears the ones it does", () => {
    const { blob } = buildQuoteSave(input({
      prev: prev("quoted", { jobNotes: "gate code 1234", approval: { by: "cust" }, leadDraft: { v: 1 }, discount: { type: "percent", value: 10 }, laborRate: 90, crewSize: 3 }),
      identity: editing,
    }));
    expect(blob.jobNotes).toBe("gate code 1234");
    expect(blob.approval).toEqual({ by: "cust" });
    expect(blob.leadDraft).toEqual({ v: 1 });
    expect(blob.discount).toBeNull();
    expect(blob.laborRate).toBeNull();
    expect(blob.crewSize).toBeNull();
  });

  it("keeps the saved inspection unless the Inspector ran this session", () => {
    const saved = { type: "move-out", rooms: [], property: "old", client: "old" };
    expect(buildQuoteSave(input({ prev: prev("quoted", { inspection: saved }), identity: editing })).blob.inspection).toEqual(saved);
    const fresh = buildQuoteSave(input({
      prev: prev("quoted", { inspection: saved }), identity: editing,
      inspection: {
        property: "new", client: "n", rooms: [{ name: "Kitchen", sqft: 120, items: [{ name: "Sink", condition: "P", notes: "leaks", photos: ["u"] }] }],
      },
    })).blob.inspection;
    expect(fresh).toEqual({
      type: "move-out", property: "new", client: "n",
      rooms: [{ name: "Kitchen", sqft: 120, width: undefined, length: undefined, items: [{ name: "Sink", condition: "P", comment: "leaks", photos: ["u"] }] }],
    });
  });
});

describe("work order", () => {
  const editing = { ...input().identity, editing: true };
  const withPrior = (workOrder: unknown[]) => ({ prev: { status: "active", blob: { workOrder } }, identity: editing });

  it("takes editable fields from the new step but inherits done / completed_at from the prior task", () => {
    const { blob } = buildQuoteSave(input({
      steps: [step("Plumbing", "Replace faucet", { itemId: "a", action: "NEW ACTION", pri: "HIGH", hrs: 4 })],
      ...withPrior([{ room: "Plumbing", detail: "Replace faucet", action: "old", pri: "LOW", hrs: 1, done: true, completed_at: "2026-10-28", itemId: "a" }]),
    }));
    expect(blob.workOrder[0]).toMatchObject({ action: "NEW ACTION", pri: "HIGH", hrs: 4, done: true, completed_at: "2026-10-28", itemId: "a" });
  });

  it("a renamed line keeps its checkmark via the line id", () => {
    const { blob } = buildQuoteSave(input({
      steps: [step("Plumbing", "Install NEW faucet", { itemId: "a" })],
      ...withPrior([{ room: "Plumbing", detail: "Replace faucet", action: "", pri: "MED", hrs: 1, done: true, itemId: "a" }]),
    }));
    expect(blob.workOrder[0].done).toBe(true);
  });

  it("legacy tasks (no line id) match by room + detail text, case-insensitively", () => {
    const { blob } = buildQuoteSave(input({
      steps: [step("PLUMBING", "replace faucet")],
      ...withPrior([{ room: "Plumbing", detail: "Replace Faucet", action: "", pri: "MED", hrs: 1, done: true }]),
    }));
    expect(blob.workOrder[0].done).toBe(true);
  });

  it("each prior task is used once — a duplicate text row doesn't also inherit done", () => {
    const { blob } = buildQuoteSave(input({
      steps: [step("Plumbing", "Caulk"), step("Plumbing", "Caulk")],
      ...withPrior([{ room: "Plumbing", detail: "Caulk", action: "", pri: "MED", hrs: 1, done: true }]),
    }));
    expect(blob.workOrder.map((w: { done: boolean }) => w.done)).toEqual([true, false]);
  });

  it("a new task starts not done", () => {
    expect(buildQuoteSave(input()).blob.workOrder.every((w: { done: boolean }) => w.done === false)).toBe(true);
  });

  it("reports finished tasks that vanished from the quote", () => {
    const { droppedDone, blob } = buildQuoteSave(input({
      steps: [step("Plumbing", "Replace faucet", { itemId: "a" })],
      ...withPrior([
        { room: "Plumbing", detail: "Replace faucet", action: "", pri: "MED", hrs: 1, done: true, itemId: "a" },
        { room: "Plumbing", detail: "Old removed job", action: "", pri: "MED", hrs: 1, done: true },
        { room: "Plumbing", detail: "Removed but not done", action: "", pri: "MED", hrs: 1, done: false },
      ]),
    }));
    expect(droppedDone).toEqual(["Plumbing — Old removed job"]);
    expect(blob.workOrder).toHaveLength(1);
  });

  it("keeps the quote-line link and the custom flag", () => {
    const { blob } = buildQuoteSave(input({ steps: [step("Plumbing", "Hand-added", { custom: true }), step("Plumbing", "Linked", { itemId: "z" })] }));
    expect(blob.workOrder[0]).toMatchObject({ custom: true });
    expect(blob.workOrder[0]).not.toHaveProperty("itemId");
    expect(blob.workOrder[1]).toMatchObject({ itemId: "z" });
    expect(blob.workOrder[1]).not.toHaveProperty("custom");
  });

  it("never saves an empty work order for a quote with lines — falls back to the guide steps", () => {
    expect(buildQuoteSave(input({ steps: [] })).blob.workOrder.map((w: { detail: string }) => w.detail)).toEqual(["GUIDE FALLBACK"]);
  });

  it("an empty quote with no lines stays empty", () => {
    const rooms: Room[] = [{ name: "Plumbing", items: [] }];
    expect(buildQuoteSave(input({ rooms, steps: [] })).blob.workOrder).toEqual([]);
  });

  it("tags each task with its line's option membership: by line id, then text, else all three", () => {
    const rooms: Room[] = [{ name: "Plumbing", items: [
      item("a", "Base only", { tiers: ["base"] }),
      item("b", "Best only", { tiers: ["best"] }),
    ] }];
    const { blob } = buildQuoteSave(input({
      rooms,
      steps: [
        step("Plumbing", "renamed since", { itemId: "a" }),   // by id
        step("Plumbing", "Best only"),                          // by text
        step("Plumbing", "Not a quote line"),                   // fallback
      ],
    }));
    expect(blob.workOrder.map((w: { tiers: string[] }) => w.tiers)).toEqual([["base"], ["best"], ["base", "better", "best"]]);
  });
});

describe("photos", () => {
  const editing = { ...input().identity, editing: true };

  it("keeps every saved photo (any type) and appends only new urls", () => {
    const { blob } = buildQuoteSave(input({
      prev: { status: "active", blob: { photos: [{ url: "u1", type: "after" }, { url: "u2", type: "rendered" }] } },
      identity: editing,
      jobPhotos: [{ url: "u2", label: "", type: "before" }, { url: "u3", label: "x", type: "before" }],
    }));
    expect(blob.photos).toEqual([{ url: "u1", type: "after" }, { url: "u2", type: "rendered" }, { url: "u3", label: "x", type: "before" }]);
  });
});

describe("Good-Better-Best locking", () => {
  const tiered = (over: Partial<QuoteSaveInput["settings"]> = {}) => ({ ...input().settings, tieredQuote: true, ...over });
  const editing = { ...input().identity, editing: true };

  it("a plain quote stores no tier data", () => {
    const { blob } = buildQuoteSave(input());
    expect(blob.tierTotals).toBeNull();
    expect(blob.tierBreakdown).toBeNull();
    expect(blob.tierSplit).toBe(false);
  });

  it("pre-approval it locks to the headline option, never the all-lines total", () => {
    const { row, blob } = buildQuoteSave(input({ settings: tiered() }));
    expect(row).toMatchObject({ total: 300, total_labor: 200, total_mat: 100, total_hrs: 3 }); // best, not gt/th
    expect(blob.tierTotals).toEqual({ base: 100, better: 200, best: 300 });
    expect(blob.tierSplit).toBe(true);
    expect(blob.workOrder).toHaveLength(2); // nothing pruned yet
  });

  it("after the customer accepted an option, a re-save stays locked to it and prunes the work order", () => {
    const rooms: Room[] = [{ name: "Plumbing", items: [
      item("a", "Everyone gets this", { tiers: ["base", "better", "best"] }),
      item("b", "Best only", { tiers: ["best"] }),
    ] }];
    const { row, blob } = buildQuoteSave(input({
      rooms, settings: tiered(), identity: editing,
      steps: [step("Plumbing", "Everyone gets this", { itemId: "a" }), step("Plumbing", "Best only", { itemId: "b" })],
      prev: { status: "accepted", blob: { acceptedTier: "base" } },
    }));
    expect(row).toMatchObject({ total: 100, total_labor: 60, total_mat: 40, total_hrs: 1, status: "accepted" });
    expect(blob.workOrder.map((w: { detail: string }) => w.detail)).toEqual(["Everyone gets this"]);
    expect(blob.acceptedTier).toBe("base"); // kept from the saved blob
  });

  it("an accepted tier is ignored on a non-tiered re-save (plain totals)", () => {
    const { row } = buildQuoteSave(input({ identity: editing, prev: { status: "accepted", blob: { acceptedTier: "base" } } }));
    expect(row.total).toBe(300);
  });
});

describe("dominantTrade", () => {
  it("names the job for a trade with a majority of the labor hours", () => {
    const rooms: Room[] = [
      { name: "Flooring", items: [item("a", "x", { laborHrs: 30 })] },
      { name: "Caulk", items: [item("b", "y", { laborHrs: 1 })] },
    ];
    expect(dominantTrade(rooms)).toBe("Flooring");
  });
  it("is General when mixed, or empty", () => {
    expect(dominantTrade([{ name: "A", items: [item("a", "x", { laborHrs: 2 })] }, { name: "B", items: [item("b", "y", { laborHrs: 2 })] }])).toBe("General");
    expect(dominantTrade([])).toBe("General");
  });
  it("gives a zero-hour materials-only bucket a small weight", () => {
    expect(dominantTrade([{ name: "Supplies", items: [item("a", "x", { laborHrs: 0 })] }])).toBe("Supplies");
  });
});
