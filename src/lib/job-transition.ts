/**
 * A job's status change + its side effects, in ONE place — shared by the Jobs
 * screen (status dropdown, next-step CTA, bulk bar) and Work mode's
 * "Complete Job". (scheduled → active on clock-in lives in lib/clock.ts.)
 *
 * Completing a job:
 *   1. writes the status (if that fails, db.patch already toasted why and
 *      nothing else happens — the caller returns false);
 *   2. runs the caller's `afterWrite` (Work mode clocks the tech out here, so
 *      the final session counts toward the learned hours);
 *   3. teaches the AI quoter from the real hours (recordJobOutcome) and
 *      stamps the serviced unit's equipment.last_service_at — both
 *      best-effort: a failure never undoes or blocks the completion.
 *
 * UI questions (Jobs' "Paid but $X still owed", Work mode's finish-time and
 * unchecked-task prompts) stay in the screens, BEFORE calling this.
 *
 * Tested in src/__tests__/job-transition.test.ts (deps injected).
 */
import { db } from "./supabase";
import { recordJobOutcome, jobActualHours, jobHasOpenEntries } from "./learning";
import type { Job, Organization, ReviewRequest, TimeEntry } from "./types";

export interface TransitionCtx {
  /** The org's full job list, read AFTER the write/afterWrite (fresh store). */
  jobs: () => Job[];
  timeEntries: () => TimeEntry[];
  /** Used for side effects when the job isn't in `jobs()`. */
  fallbackJob?: Job;
  /** Hours to learn from. Default = jobActualHours (time entries only);
   *  the Jobs screen adds hours recovered from pay_history. */
  actualHours?: (job: Job) => number;
  /** Runs after the status write lands, before the side effects. */
  afterWrite?: () => Promise<void>;
  /** Test seams. */
  patch?: (table: string, id: string, patch: Record<string, unknown>) => Promise<boolean>;
  recordOutcome?: typeof recordJobOutcome;
  now?: () => number;
}

/** Write `to` on the job and run its side effects. Resolves true when the
 *  status write landed (side-effect failures don't change that). */
export async function transitionJob(jobId: string, to: Job["status"], ctx: TransitionCtx): Promise<boolean> {
  const patch = ctx.patch ?? ((t, id, p) => db.patch(t, id, p));
  if (!(await patch("jobs", jobId, { status: to }))) return false;
  if (ctx.afterWrite) await ctx.afterWrite();

  if (to === "complete") {
    const jobs = ctx.jobs();
    const job = jobs.find((j) => j.id === jobId) || ctx.fallbackJob;
    if (job) {
      const entries = ctx.timeEntries();
      try {
        const hrs = ctx.actualHours ? ctx.actualHours(job) : jobActualHours(job, jobs, entries);
        await (ctx.recordOutcome ?? recordJobOutcome)(job, hrs, {
          crewStillClocked: jobHasOpenEntries(job, jobs, entries),
        });
      } catch { /* learning is best-effort */ }
      // Equipment asset history: the serviced unit was just serviced.
      if (job.equipment_id) {
        try {
          await patch("equipment", job.equipment_id, { last_service_at: new Date(ctx.now?.() ?? Date.now()).toISOString() });
        } catch { /* best-effort */ }
      }
    }
  }
  return true;
}

/** Should the app ask for a review on this job now? No when one is already
 *  queued/sent (the latest review_requests row), was requested by hand
 *  (review_requested_at), or the org turned review requests off. */
export function shouldPromptReview(
  job: Pick<Job, "id" | "review_requested_at">,
  org: Pick<Organization, "review_request_enabled"> | null | undefined,
  reviewRequests: Pick<ReviewRequest, "job_id" | "status" | "created_at">[],
): boolean {
  if (job.review_requested_at) return false;
  if (org?.review_request_enabled === false) return false;
  const rr = reviewRequests
    .filter((r) => r.job_id === job.id)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
  return !(rr?.status === "scheduled" || rr?.status === "sent");
}
