/**
 * Which time entries and receipts belong to a job — the ONE rule, used by the
 * Jobs hours card, AI learning (job completion), Flip Mode actuals and the
 * portal.
 *
 * Time entries: `time_entries.job_id` is authoritative. A legacy row with no
 * job_id (written before the column existed) falls back to its address, but
 * is credited ONLY to the OLDEST job at that address — so a callback / second
 * job at the same property starts clean instead of inheriting the first job's
 * hours. That's why `jobs` must be the org's FULL job list: it decides who the
 * oldest job is.
 *
 * Receipts: by job_id only (receipts always carried it).
 *
 * PURE (tested in src/__tests__/job-entries.test.ts). No hours filter here —
 * callers that sum hours skip 0-hour rows themselves; an open shift (start,
 * no end, hours 0) still belongs to its job.
 */
import type { Job, Receipt, TimeEntry } from "./types";

type JobRef = Pick<Job, "id" | "property" | "created_at">;

/** The job is the oldest one at its address (ties count as oldest). A job
 *  with no address is never "oldest" — an address-less legacy entry can't be
 *  pinned on anyone. */
export function isOldestAtAddress(job: JobRef, jobs: JobRef[]): boolean {
  if (!job.property) return false;
  return jobs
    .filter((o) => o.property === job.property)
    .every((o) => (job.created_at || "") <= (o.created_at || ""));
}

/** Does this entry belong to the job? `oldest` = isOldestAtAddress(job, …). */
export function entryBelongsTo(
  e: Pick<TimeEntry, "job_id" | "job">,
  job: JobRef,
  oldest: boolean,
): boolean {
  if (e.job_id) return e.job_id === job.id;
  return oldest && e.job === job.property;
}

/** Every time entry that belongs to `job`. */
export function entriesForJob<T extends Pick<TimeEntry, "job_id" | "job">>(
  job: JobRef,
  jobs: JobRef[],
  entries: T[],
): T[] {
  const oldest = isOldestAtAddress(job, jobs);
  return entries.filter((e) => entryBelongsTo(e, job, oldest));
}

/** Every receipt filed against `job`. */
export function receiptsForJob<T extends Pick<Receipt, "job_id">>(job: Pick<Job, "id">, receipts: T[]): T[] {
  return receipts.filter((r) => r.job_id === job.id);
}
