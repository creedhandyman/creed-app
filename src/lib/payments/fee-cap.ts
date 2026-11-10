import type { SupabaseClient } from "@supabase/supabase-js";
import { computePlatformFee, currentPeriodStart } from "@/lib/platform-fee";

/**
 * Platform fees an org has already paid this calendar month, for the monthly
 * cap. Shared by /api/checkout and the card-on-file charge so both apply the
 * cap the same way.
 *
 * Sums the PAYMENTS LEDGER (captures fees on deposits too; refunds set their
 * charge row's fee to 0/prorated, so the sum self-corrects). Falls back to the
 * paid-jobs sum pre-migration, and to 0 if neither column exists (the fee still
 * applies, just without cap enforcement).
 */
export async function feesCollectedThisPeriod(supabase: SupabaseClient, orgId: string): Promise<number> {
  try {
    const periodStart = currentPeriodStart();
    const { data: payRows, error: payErr } = await supabase
      .from("payments")
      .select("platform_fee_cents")
      .eq("org_id", orgId)
      .gte("created_at", periodStart.toISOString());
    if (!payErr && payRows) {
      return payRows.reduce((sum, r) => sum + (Number(r.platform_fee_cents) || 0), 0);
    }
    const { data: capRows } = await supabase
      .from("jobs")
      .select("platform_fee_cents")
      .eq("org_id", orgId)
      .eq("status", "paid")
      .gte("paid_at", periodStart.toISOString())
      .not("platform_fee_cents", "is", null);
    return (capRows ?? []).reduce((sum, r) => sum + (Number(r.platform_fee_cents) || 0), 0);
  } catch {
    return 0;
  }
}

/** Creed's fee on a job charge (never on a tip), with the monthly cap applied. */
export async function platformFeeFor(
  supabase: SupabaseClient,
  orgId: string,
  plan: string | null,
  amountCents: number,
): Promise<number> {
  return computePlatformFee(amountCents, plan, await feesCollectedThisPeriod(supabase, orgId));
}
