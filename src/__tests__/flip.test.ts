import { analyzeFlip, analyzeFlipActuals, compsArv, flipActuals, holdingClock, RULE_70, THIN_PROFIT } from "@/lib/flip";
import type { Job, Profile, Receipt, TimeEntry } from "@/lib/types";

const base = {
  arv: 300000,
  purchase_price: 150000,
  rehab_budget: 40000,
  holding_monthly: 2000,
  holding_months: 5,
  selling_pct: 6,
  down_pct: 15,
  financing_cost: 0,
  contingency: 0,
};

describe("analyzeFlip", () => {
  it("good deal: solid profit and passes the 70% rule", () => {
    const a = analyzeFlip(base);
    expect(a.holding).toBe(10000);
    expect(a.selling).toBeCloseTo(18000);
    expect(a.allIn).toBe(200000);
    expect(a.netSale).toBeCloseTo(282000);
    expect(a.profit).toBeCloseTo(82000);
    expect(a.maxBuy).toBeCloseTo(170000);
    expect(a.passes70).toBe(true);
    expect(a.verdict).toBe("good");
  });

  it("warn when profit is thin (between 0 and THIN_PROFIT)", () => {
    // A big contingency eats the profit without touching the 70% max (it's
    // ARV × 0.70 − rehab only), so only the thin branch fires.
    const a = analyzeFlip({ ...base, contingency: 70000 });
    expect(a.profit).toBeGreaterThan(0);
    expect(a.profit).toBeLessThan(THIN_PROFIT);
    expect(a.passes70).toBe(true);
    expect(a.verdict).toBe("warn");
  });

  it("warn when the purchase is over the 70% max even with good profit", () => {
    const a = analyzeFlip({ ...base, purchase_price: 171000 });
    expect(a.passes70).toBe(false);
    expect(a.profit).toBeGreaterThan(THIN_PROFIT);
    expect(a.verdict).toBe("warn");
  });

  it("purchase exactly at maxBuy passes", () => {
    const a = analyzeFlip({ ...base, purchase_price: 300000 * RULE_70 - 40000 });
    expect(a.passes70).toBe(true);
  });

  it("bad when profit is zero or negative", () => {
    expect(analyzeFlip({ ...base, purchase_price: 280000 }).verdict).toBe("bad");
    // profit exactly 0 is still bad
    const zero = analyzeFlip({ arv: 100000, purchase_price: 100000 });
    expect(zero.profit).toBe(0);
    expect(zero.verdict).toBe("bad");
  });

  it("cash-in = down payment + rehab + holding + financing + contingency, ROI off it", () => {
    const a = analyzeFlip({ ...base, financing_cost: 3000, contingency: 5000 });
    expect(a.cashIn).toBeCloseTo(150000 * 0.15 + 40000 + 10000 + 3000 + 5000);
    expect(a.roi).toBeCloseTo(a.profit / a.cashIn);
  });

  it("ROI is 0 when no cash is in (divide-by-zero guard)", () => {
    const a = analyzeFlip({ arv: 200000 });
    expect(a.cashIn).toBe(0);
    expect(a.roi).toBe(0);
  });

  it("maxBuy = ARV × 0.70 − rehab", () => {
    expect(analyzeFlip({ arv: 250000, rehab_budget: 35000 }).maxBuy).toBeCloseTo(250000 * 0.7 - 35000);
  });

  it("treats missing / null / NaN inputs as 0", () => {
    const a = analyzeFlip({ arv: undefined, purchase_price: NaN, rehab_budget: null as unknown as number });
    expect(a.allIn).toBe(0);
    expect(a.profit).toBe(0);
    expect(a.verdict).toBe("bad");
  });
});

// ── Phase 2 ───────────────────────────────────────────────────────────────

const job = (o: Partial<Job>) => ({ status: "active", total: 0, rooms: "{}", created_at: "2026-09-01", ...o }) as Job;
const entry = (o: Partial<TimeEntry>) => ({ hours: 0, amount: 0, user_id: "u1", job: "", entry_date: "2026-09-02", ...o }) as TimeEntry;
const receipt = (o: Partial<Receipt>) => ({ amount: 0, receipt_date: "2026-09-02", ...o }) as Receipt;
const profiles = [{ id: "u1", rate: 30 }, { id: "u0", rate: 0 }] as Profile[];

describe("flipActuals", () => {
  const jobs = [
    job({ id: "k", property: "1 Oak", total: 10000, flip_project_id: "f1", status: "complete",
      rooms: JSON.stringify({ workOrder: [{ room: "Kitchen", done: true }, { room: "Kitchen", done: true }, { room: "Paint", done: false }] }) }),
    job({ id: "r", property: "1 Oak", total: 5000, flip_project_id: "f1", created_at: "2026-09-05" }),
    job({ id: "svc", property: "9 Elm", total: 800 }), // a normal service job — never counted
  ];
  const receipts = [
    receipt({ job_id: "k", amount: 4000 }),
    receipt({ job_id: "r", amount: 5500 }),
    receipt({ job_id: "svc", amount: 300 }),
  ];
  const timeEntries = [
    entry({ job_id: "k", hours: 10, amount: 320 }),       // recorded amount wins
    entry({ job_id: "r", hours: 4 }),                      // legacy: hrs × current rate (30)
    entry({ job_id: "r", hours: 3, user_id: "u0" }),       // no pay rate → $0, flagged
    entry({ job: "1 Oak", hours: 2 }),                     // no job_id → oldest job at the address (k)
    entry({ job_id: "svc", hours: 5, amount: 150 }),
  ];
  const a = flipActuals({ flipId: "f1", jobs, receipts, timeEntries, profiles });

  it("rolls up only the flip's linked jobs", () => {
    expect(a.lines.map((l) => l.jobId)).toEqual(["k", "r"]);
    expect(a.materials).toBe(9500);
    expect(a.labor).toBe(320 + 60 + 120);
    expect(a.spent).toBe(9500 + 500);
    expect(a.budgetLinked).toBe(15000);
  });

  it("per-line budget vs actual, over-budget and work-order progress", () => {
    const [k, r] = a.lines;
    expect(k.actual).toBe(4000 + 320 + 60);
    expect(k.over).toBe(0);
    expect(k.done).toBe(true);
    expect([k.tasksDone, k.tasksTotal]).toEqual([2, 3]);
    // Lines are named by their areas (every flip job shares one address)…
    expect(k.label).toBe("Kitchen · Paint");
    // …falling back to the address when the job has no work order or rooms.
    expect(r.label).toBe("1 Oak");
    expect(r.actual).toBe(5500 + 120);
    expect(r.over).toBe(620);
    expect(r.done).toBe(false);
  });

  it("never guesses a rate: unrated hours cost $0 and are reported", () => {
    expect(a.unratedHrs).toBe(3);
    expect(a.allDone).toBe(false);
  });

  it("no linked jobs = empty, not done", () => {
    const none = flipActuals({ flipId: "nope", jobs, receipts, timeEntries, profiles });
    expect(none.lines).toEqual([]);
    expect(none.spent).toBe(0);
    expect(none.allDone).toBe(false);
  });
});

describe("holdingClock", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  it("days since bought × monthly ÷ 30", () => {
    const c = holdingClock({ acquired_at: "2026-09-01T12:00:00Z", holding_monthly: 3000 }, now);
    expect(c.started).toBe(true);
    expect(c.days).toBe(40);
    expect(c.perDay).toBe(100);
    expect(c.toDate).toBe(4000);
  });
  it("stops at sold_at", () => {
    expect(holdingClock({ acquired_at: "2026-09-01T12:00:00Z", sold_at: "2026-09-11T12:00:00Z", holding_monthly: 3000 }, now).days).toBe(10);
  });
  it("not bought yet = 0 days", () => {
    const c = holdingClock({ holding_monthly: 3000 }, now);
    expect(c.started).toBe(false);
    expect(c.toDate).toBe(0);
  });
});

describe("analyzeFlipActuals", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const p = { ...base, acquired_at: "2026-09-01T12:00:00Z", holding_monthly: 3000, holding_months: 5 };

  it("with no spend and a fresh clock it matches the plan", () => {
    const a = analyzeFlipActuals({ ...p, acquired_at: null }, { spent: 0, rehabDone: false }, now);
    expect(a.profit).toBeCloseTo(a.plan.profit);
    expect(a.rehabProjected).toBe(40000);
  });

  it("under-budget spend is not banked until the rehab is done", () => {
    const mid = analyzeFlipActuals(p, { spent: 25000, rehabDone: false }, now);
    expect(mid.rehabProjected).toBe(40000);
    const done = analyzeFlipActuals(p, { spent: 25000, rehabDone: true }, now);
    expect(done.rehabProjected).toBe(25000);
    expect(done.profit).toBeCloseTo(mid.profit + 15000);
  });

  it("an overrun lowers projected profit right away", () => {
    const a = analyzeFlipActuals(p, { spent: 52000, rehabDone: false }, now);
    expect(a.rehabProjected).toBe(52000);
    expect(a.profit).toBeCloseTo(a.plan.profit - 12000);
  });

  it("holding past the planned months adds the extra days", () => {
    const late = new Date("2026-03-01T12:00:00Z");
    const a = analyzeFlipActuals({ ...p, acquired_at: "2025-09-01T12:00:00Z" }, { spent: 0, rehabDone: false }, late);
    expect(a.days).toBe(181);
    expect(a.holdingProjected).toBeCloseTo(181 * 100);
    expect(a.holding).toBeCloseTo(18100);
    expect(a.profit).toBeCloseTo(a.plan.profit - (18100 - 15000));
  });

  it("once sold, uses the sold price and the real hold", () => {
    const a = analyzeFlipActuals(
      { ...p, sold_at: "2026-10-01T12:00:00Z", sold_price: 290000 },
      { spent: 40000, rehabDone: true },
      now,
    );
    expect(a.salePrice).toBe(290000);
    expect(a.holdingProjected).toBe(30 * 100);
    expect(a.netSale).toBeCloseTo(290000 * 0.94);
  });
});

describe("compsArv", () => {
  it("averages $/sq ft over usable comps × subject sq ft", () => {
    const c = compsArv([
      { price: 200000, sqft: 1000 },
      { price: 330000, sqft: 1500 },
      { price: 0, sqft: 1200 }, // blank row ignored
    ], 1200);
    expect(c?.count).toBe(2);
    expect(c?.ppsf).toBeCloseTo(210);
    expect(c?.arv).toBeCloseTo(252000);
  });
  it("null with no usable comps; arv 0 without a subject size", () => {
    expect(compsArv([], 1000)).toBeNull();
    expect(compsArv(null, 1000)).toBeNull();
    expect(compsArv([{ price: 100000, sqft: 1000 }], null)?.arv).toBe(0);
  });
});
