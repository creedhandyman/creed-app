import { entriesForJob, receiptsForJob, isOldestAtAddress } from "../lib/job-entries";
import type { Job, Receipt, TimeEntry } from "../lib/types";

const job = (id: string, property: string, created_at: string) => ({ id, property, created_at }) as Job;
const entry = (id: string, over: Partial<TimeEntry>) => ({ id, job: "", hours: 1, ...over }) as TimeEntry;

const first = job("j1", "1 Main St", "2026-01-01T00:00:00Z");
const callback = job("j2", "1 Main St", "2026-05-01T00:00:00Z");
const other = job("j3", "9 Oak Ave", "2026-03-01T00:00:00Z");
const jobs = [callback, first, other];

describe("entriesForJob", () => {
  const entries = [
    entry("linked-first", { job_id: "j1", job: "1 Main St" }),
    entry("linked-callback", { job_id: "j2", job: "1 Main St" }),
    entry("legacy-main", { job: "1 Main St" }),
    entry("legacy-oak", { job: "9 Oak Ave" }),
  ];

  it("credits linked entries only to their job", () => {
    expect(entriesForJob(callback, jobs, entries).map((e) => e.id)).toEqual(["linked-callback"]);
  });

  it("credits a legacy address entry only to the OLDEST job there", () => {
    expect(entriesForJob(first, jobs, entries).map((e) => e.id)).toEqual(["linked-first", "legacy-main"]);
    expect(entriesForJob(other, jobs, entries).map((e) => e.id)).toEqual(["legacy-oak"]);
  });

  it("keeps open (0-hour) shifts — callers filter hours themselves", () => {
    const open = entry("open", { job_id: "j2", hours: 0, start_time: "8:00 AM", end_time: "" });
    expect(entriesForJob(callback, jobs, [open])).toEqual([open]);
  });

  it("never pins an address-less legacy entry on an address-less job", () => {
    const blank = job("j4", "", "2025-01-01T00:00:00Z");
    expect(isOldestAtAddress(blank, [blank])).toBe(false);
    expect(entriesForJob(blank, [blank], [entry("e", { job: "" })])).toEqual([]);
  });

  it("treats a same-timestamp tie as oldest", () => {
    const twin = job("j5", "1 Main St", "2026-01-01T00:00:00Z");
    expect(isOldestAtAddress(twin, [...jobs, twin])).toBe(true);
  });
});

describe("receiptsForJob", () => {
  it("matches by job_id only", () => {
    const receipts = [
      { id: "r1", job_id: "j1" },
      { id: "r2", job_id: "j2" },
      { id: "r3", job_id: "j1" },
    ] as Receipt[];
    expect(receiptsForJob(first, receipts).map((r) => r.id)).toEqual(["r1", "r3"]);
  });
});
