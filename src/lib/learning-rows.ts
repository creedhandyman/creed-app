/**
 * Which finished-job learning rows still count.
 *
 * Completing a job writes price_corrections rows (source "job_completion":
 * per-line hours plus the __job__ / __jobraw__ calibration rows). If the job
 * is then moved BACK to an earlier status — a mis-tap, or more work turned
 * up — those rows describe a job that isn't finished: the hours are partial,
 * and they pull the labor calibration down. Clients can't delete
 * price_corrections rows (insert + read only), so the quoter leaves them out
 * when it reads. Finishing the job again writes fresh rows, which count.
 *
 * Pure; tested in src/__tests__/learning-rows.test.ts.
 */

/** Statuses a job has before its work is finished. */
const UNFINISHED = new Set(["lead", "inspection", "quoted", "accepted", "scheduled", "active"]);

export interface LearningRow {
  source?: string | null;
  job_id?: string | null;
}

/** The job ids whose current status decides if their rows count. */
export function completionJobIds(rows: LearningRow[]): string[] {
  const ids = new Set<string>();
  for (const r of rows) if (r.source === "job_completion" && r.job_id) ids.add(r.job_id);
  return [...ids];
}

/** Drop the completion rows of jobs that are known to be unfinished right now.
 *  A job with no known status (deleted, or the lookup failed) keeps its rows. */
export function dropUnfinishedJobRows<T extends LearningRow>(rows: T[], statusById: Record<string, string | undefined>): T[] {
  return rows.filter((r) => {
    if (r.source !== "job_completion" || !r.job_id) return true;
    const s = statusById[r.job_id];
    return !(s && UNFINISHED.has(s));
  });
}
