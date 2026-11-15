import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The hourly review-request run can overlap itself (a slow run, a manual
 * trigger, the scheduler firing twice). Both runs used to read the same
 * "scheduled" rows and both texted the customer. Each request is now CLAIMED
 * before it is sent: one conditional UPDATE that stamps `sent_at` only while
 * the row is still "scheduled" with no `sent_at`, so exactly one run gets the
 * row back. (`status` has a CHECK constraint, so there is no "sending" status
 * to use; `sent_at` on a still-scheduled row IS the claim.)
 */

/** How long a claim may sit before the run that took it is presumed dead. */
export const CLAIM_STALE_MS = 30 * 60_000;

/** true = this run owns the request and should send it. */
export async function claimReviewRequest(supabase: SupabaseClient, id: string, nowIso: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("review_requests")
    .update({ sent_at: nowIso })
    .eq("id", id).eq("status", "scheduled").is("sent_at", null)
    .select("id");
  return !error && Array.isArray(data) && data.length === 1;
}

/**
 * Requests claimed long ago and never finished (the run died mid-send) are
 * marked failed instead of sent again: the text may already have gone out.
 * Returns how many.
 */
export async function failStaleClaims(supabase: SupabaseClient, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - CLAIM_STALE_MS).toISOString();
  const { data, error } = await supabase
    .from("review_requests")
    .update({ status: "failed", error: "The send was interrupted and was not retried, so the customer is not asked twice. Send it again from the job if needed." })
    .eq("status", "scheduled").not("sent_at", "is", null).lt("sent_at", cutoff)
    .select("id");
  return !error && Array.isArray(data) ? data.length : 0;
}
