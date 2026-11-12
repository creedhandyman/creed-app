import { afterVisitRemoved, readyToBook, isJobScheduled } from "@/lib/day-plan";
import type { Job, ScheduleEntry } from "@/lib/types";

const job = (id: string, extra: Partial<Job> = {}): Job => ({
  id, property: `${id} Main St`, client: "C", job_date: "2026-11-01", rooms: "{}",
  total: 0, total_labor: 0, total_mat: 0, total_hrs: 0, status: "scheduled", created_by: "",
  created_at: "2026-11-01T10:00:00Z", trade: "", callback: false, is_upsell: false, requested_tech: "",
  ...extra,
} as Job);
const visit = (id: number, j: Job, day = "2026-11-14"): ScheduleEntry =>
  ({ id, job: j.property, job_id: j.id, sched_date: day, note: "" } as unknown as ScheduleEntry);

// Dispatch's "Needs scheduling" rule, as Schedule.tsx computes it.
const needsScheduling = (jobs: Job[], schedule: ScheduleEntry[]) =>
  jobs.filter((j) => !j.archived && (readyToBook(j.status) || j.status === "quoted") && !isJobScheduled(j, schedule));

describe("afterVisitRemoved — the job is back in Needs scheduling right away", () => {
  it("last visit removed: entry gone, approved work goes back to accepted, and it's listed", () => {
    const a = job("a", { approved_at: "2026-11-02T00:00:00Z" });
    const sched = [visit(1, a)];
    const r = afterVisitRemoved(sched[0], sched, [a]);
    expect(r.schedule).toEqual([]);
    expect(r.status).toBe("accepted");
    const jobsAfter = [{ ...a, status: r.status! }];
    expect(needsScheduling(jobsAfter, r.schedule).map((j) => j.id)).toEqual(["a"]);
  });
  it("a sent, never-approved quote goes back to quoted", () => {
    const q = job("q", { quote_sent_at: "2026-11-02T00:00:00Z" });
    const r = afterVisitRemoved(visit(1, q), [visit(1, q)], [q]);
    expect(r.status).toBe("quoted");
  });
  it("another visit still on the calendar: status left alone, not listed", () => {
    const a = job("a");
    const sched = [visit(1, a), visit(2, a, "2026-11-20")];
    const r = afterVisitRemoved(sched[0], sched, [a]);
    expect(r.schedule.map((e) => e.id)).toEqual([2]);
    expect(r.status).toBeNull();
    expect(needsScheduling([a], r.schedule)).toEqual([]);
  });
  it("other jobs' visits are untouched", () => {
    const a = job("a"); const b = job("b");
    const sched = [visit(1, a), visit(2, b)];
    const r = afterVisitRemoved(sched[0], sched, [a, b]);
    expect(r.schedule.map((e) => e.id)).toEqual([2]);
    expect(needsScheduling([{ ...a, status: r.status! }, b], r.schedule).map((j) => j.id)).toEqual(["a"]);
  });
  it("a job not in 'scheduled' keeps its status (statusAfterUnschedule)", () => {
    const a = job("a", { status: "active" });
    expect(afterVisitRemoved(visit(1, a), [visit(1, a)], [a]).status).toBeNull();
  });
});
