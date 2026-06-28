/**
 * Creed platform fee logic. All amounts in integer cents — never floats.
 *
 * Tiers:
 *   solo / crew  →  0.5% per transaction, capped at $100/calendar month
 *   pro          →  no platform fee
 *
 * The monthly cap is computed via a live SUM query (not a stored counter)
 * so it can't drift from refunds, failed charges, or missed resets.
 * A refunded payment has its platform_fee_cents set to 0 (or prorated),
 * which automatically restores cap headroom on the next cap query.
 */

/** 0.5% as a decimal. */
export const PLATFORM_FEE_RATE = 0.005;

/** Monthly cap: $100.00 in cents. */
export const PLATFORM_FEE_CAP_CENTS = 10_000;

/**
 * First instant of the current calendar month in UTC.
 * Used to scope the cap query to "this billing period".
 */
export function currentPeriodStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Compute the Creed platform fee for a single transaction.
 *
 * @param amountCents         - Charge amount in cents. Must be > 0.
 * @param plan                - Org subscription plan: "solo" | "crew" | "pro"
 * @param feesCollectedCents  - Platform fees already confirmed this period (cents).
 * @returns Integer cents owed as platform fee (0 → PLATFORM_FEE_CAP_CENTS).
 *
 * Edge cases:
 *   - amountCents ≤ 0        → 0 (guard; should never reach checkout)
 *   - plan === "pro"         → 0 (no fee on Pro)
 *   - null/undefined plan    → treated as non-Pro; standard fee applies
 *   - feesCollected ≥ cap    → 0 (cap exhausted for this period)
 *   - transaction straddles  → min(rawFee, remainingHeadroom)
 */
export function computePlatformFee(
  amountCents: number,
  plan: string | null | undefined,
  feesCollectedCents: number,
): number {
  if (amountCents <= 0) return 0;
  if (plan === "pro") return 0;

  const rawFee = Math.round(amountCents * PLATFORM_FEE_RATE);
  const remainingUnderCap = Math.max(0, PLATFORM_FEE_CAP_CENTS - Math.max(0, feesCollectedCents));
  return Math.min(rawFee, remainingUnderCap);
}
