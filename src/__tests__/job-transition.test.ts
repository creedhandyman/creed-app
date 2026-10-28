jest.mock("../lib/supabase", () => ({ db: {}, supabase: {} }));

import { transitionJob, shouldPromptReview, type TransitionCtx } from "../lib/job-transition";
import type { Job, TimeEntry } from "../lib/types";

const job = (over: Partial<Job>) => ({ id: "j1", property: "1 Main St", created_at: "2026-01-01", status: "active", ...over }) as Job;

function ctx(over: Partial<TransitionCtx> & { ok?: boolean; jobsList?: Job[]; entries?: TimeEntry[] } = {}) {
  const writes: { table: string; id: string; patch: Record<string, unknown> }[] = [];
  const outcomes: { id: string; hrs: number; crewStillClocked?: boolean }[] = [];
  const c: TransitionCtx = {
    jobs: () => over.jobsList ?? [job({})],
    timeEntries: () => over.entries ?? [],
    patch: async (table, id, patch) => { writes.push({ table, id, patch }); return table !== "jobs" || over.ok !== false; },
    recordOutcome: async (j, hrs, opts) => { outcomes.push({ id: j.id, hrs, crewStillClocked: opts?.crewStillClocked }); },
    now: () => Date.UTC(2026, 9, 28, 12),
    ...over,
  };
  return { c, writes, outcomes };
}

describe("transitionJob", () => {
  it("stops after a failed status write — no side effects, no afterWrite", async () => {
    const afterWrite = jest.fn(async () => undefined);
    const { c, writes, outcomes } = ctx({ ok: false, afterWrite });
    expect(await transitionJob("j1", "complete", c)).toBe(false);
    expect(writes).toHaveLength(1);
    expect(outcomes).toHaveLength(0);
    expect(afterWrite).not.toHaveBeenCalled();
  });

  it("completing learns from the oldest-job hours and stamps the equipment", async () => {
    const first = job({ id: "j0", created_at: "2025-01-01", status: "paid" });
    const cb = job({ id: "j1", equipment_id: "eq1" });
    const entries = [
      { id: "a", job: "1 Main St", hours: 3 },                 // legacy → j0 (oldest), NOT the callback
      { id: "b", job: "1 Main St", job_id: "j1", hours: 2 },
      { id: "c", job: "1 Main St", job_id: "j1", hours: 0, start_time: "8:00 AM", end_time: "" },
    ] as TimeEntry[];
    const { c, writes, outcomes } = ctx({ jobsList: [first, cb], entries });
    expect(await transitionJob("j1", "complete", c)).toBe(true);
    expect(outcomes).toEqual([{ id: "j1", hrs: 2, crewStillClocked: true }]);
    expect(writes).toEqual([
      { table: "jobs", id: "j1", patch: { status: "complete" } },
      { table: "equipment", id: "eq1", patch: { last_service_at: "2026-10-28T12:00:00.000Z" } },
    ]);
  });

  it("a legacy open shift at the address doesn't hold a callback's learning", async () => {
    const first = job({ id: "j0", created_at: "2025-01-01" });
    const entries = [{ id: "a", job: "1 Main St", hours: 0, start_time: "8:00 AM", end_time: "" }] as TimeEntry[];
    const { c, outcomes } = ctx({ jobsList: [first, job({})], entries });
    await transitionJob("j1", "complete", c);
    expect(outcomes[0].crewStillClocked).toBe(false);
  });

  it("runs afterWrite before reading the fresh state; actualHours overrides", async () => {
    let entries: TimeEntry[] = [];
    const { c, outcomes } = ctx({
      afterWrite: async () => { entries = [{ id: "x", job: "", job_id: "j1", hours: 4 } as TimeEntry]; },
      actualHours: () => 9,
    });
    c.timeEntries = () => entries;
    await transitionJob("j1", "complete", c);
    expect(outcomes).toEqual([{ id: "j1", hrs: 9, crewStillClocked: false }]);
  });

  it("falls back to the given job when it's not in the list", async () => {
    const { c, outcomes } = ctx({ jobsList: [], fallbackJob: job({ id: "j1" }) });
    await transitionJob("j1", "complete", c);
    expect(outcomes.map((o) => o.id)).toEqual(["j1"]);
  });

  it("learning failures are best-effort — the equipment is still stamped", async () => {
    const { c, writes } = ctx({ jobsList: [job({ equipment_id: "eq1" })] });
    c.recordOutcome = async () => { throw new Error("boom"); };
    expect(await transitionJob("j1", "complete", c)).toBe(true);
    expect(writes.map((w) => w.table)).toEqual(["jobs", "equipment"]);
  });

  it("other statuses only write the status", async () => {
    const { c, writes, outcomes } = ctx({ jobsList: [job({ equipment_id: "eq1" })] });
    expect(await transitionJob("j1", "invoiced", c)).toBe(true);
    expect(writes).toHaveLength(1);
    expect(outcomes).toHaveLength(0);
  });
});

describe("shouldPromptReview", () => {
  const j = { id: "j1" };
  it("asks when nothing has happened yet", () => {
    expect(shouldPromptReview(j, { review_request_enabled: true }, [])).toBe(true);
    expect(shouldPromptReview(j, null, [])).toBe(true);
  });
  it("not when requested by hand", () => {
    expect(shouldPromptReview({ ...j, review_requested_at: "2026-10-01" }, null, [])).toBe(false);
  });
  it("not when the org turned review requests off", () => {
    expect(shouldPromptReview(j, { review_request_enabled: false }, [])).toBe(false);
  });
  it("uses the LATEST review_requests row for the job", () => {
    const rows = [
      { job_id: "j1", status: "sent" as const, created_at: "2026-01-01" },
      { job_id: "j1", status: "cancelled" as const, created_at: "2026-02-01" },
      { job_id: "j2", status: "scheduled" as const, created_at: "2026-03-01" },
    ];
    expect(shouldPromptReview(j, null, rows)).toBe(true);
    expect(shouldPromptReview(j, null, [...rows, { job_id: "j1", status: "scheduled" as const, created_at: "2026-04-01" }])).toBe(false);
  });
});
