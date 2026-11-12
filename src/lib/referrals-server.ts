// Server side of customer referrals (service-role Supabase client).
// - recordReferralLead: /api/leads calls it when a lead arrives with ?ref=.
// - creditReferralOnPayment: fulfillJobPayment calls it after a payment is
//   recorded; the referred customer's first payment earns the referrer the
//   business's reward. Both are best-effort and never throw: a referral
//   problem must never fail a lead or a payment.
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeRefCode, shouldCreditReferral } from "./referrals";

export interface ReferralLeadResult {
  referrerId: string | null;
  referrerName: string | null;
  credited: boolean;
}

/** Find the customer who owns a referral code in this business (only while
 *  the business has referrals on). */
export async function findReferrer(
  supabase: SupabaseClient,
  orgId: string,
  rawCode: unknown,
): Promise<{ id: string; name: string | null } | null> {
  const code = normalizeRefCode(rawCode);
  if (!code) return null;
  try {
    const { data: org } = await supabase
      .from("organizations").select("referrals_enabled").eq("id", orgId).maybeSingle();
    if (!(org as { referrals_enabled?: boolean } | null)?.referrals_enabled) return null;
    const { data } = await supabase
      .from("customers").select("id, name").eq("org_id", orgId).eq("referral_code", code).limit(1);
    const row = (data || [])[0] as { id: string; name: string | null } | undefined;
    return row ? { id: row.id, name: row.name ?? null } : null;
  } catch {
    return null;
  }
}

export async function recordReferralLead(
  supabase: SupabaseClient,
  input: {
    orgId: string;
    referrer: { id: string; name: string | null } | null;
    leadCustomerId: string | null;
    createdNewCustomer: boolean;
    leadJobId: string | null;
  },
): Promise<ReferralLeadResult> {
  const out: ReferralLeadResult = { referrerId: input.referrer?.id ?? null, referrerName: input.referrer?.name ?? null, credited: false };
  if (!shouldCreditReferral({
    enabled: !!input.referrer,
    referrerId: input.referrer?.id ?? null,
    leadCustomerId: input.leadCustomerId,
    createdNewCustomer: input.createdNewCustomer,
  })) return out;
  try {
    const { error } = await supabase.from("customer_referrals").insert({
      org_id: input.orgId,
      referrer_customer_id: input.referrer!.id,
      referred_customer_id: input.leadCustomerId,
      lead_job_id: input.leadJobId,
      status: "pending",
    });
    // 23505 = this customer was already credited to someone: keep the first.
    out.credited = !error;
    if (error && (error as { code?: string }).code !== "23505") {
      console.error("[referrals] lead not recorded:", error.message);
    }
  } catch (e) {
    console.error("[referrals] lead not recorded:", e);
  }
  return out;
}

/** After a payment on `jobId`: if the job's customer came in on a referral
 *  that hasn't paid yet, the referrer earns the business's reward. Runs
 *  once per referral (the update only matches a 'pending' row). */
export async function creditReferralOnPayment(
  supabase: SupabaseClient,
  job: { id: string; org_id: string; customer_id?: string | null },
): Promise<{ earned: boolean }> {
  if (!job.customer_id) return { earned: false };
  try {
    const { data: refs } = await supabase
      .from("customer_referrals")
      .select("id")
      .eq("org_id", job.org_id)
      .eq("referred_customer_id", job.customer_id)
      .eq("status", "pending")
      .limit(1);
    const ref = (refs || [])[0] as { id: string } | undefined;
    if (!ref) return { earned: false };
    const { data: org } = await supabase
      .from("organizations").select("referrals_enabled, referral_reward_cents").eq("id", job.org_id).maybeSingle();
    const o = org as { referrals_enabled?: boolean; referral_reward_cents?: number | null } | null;
    if (!o?.referrals_enabled) return { earned: false };
    const reward = Math.max(0, Math.round(Number(o.referral_reward_cents ?? 2500) || 0));
    const { data: updated } = await supabase
      .from("customer_referrals")
      .update({ status: "earned", earned_at: new Date().toISOString(), earned_job_id: job.id, reward_cents: reward })
      .eq("id", ref.id)
      .eq("status", "pending")
      .select("id");
    return { earned: !!(updated && (updated as unknown[]).length) };
  } catch (e) {
    console.error("[referrals] credit on payment failed:", e);
    return { earned: false };
  }
}
