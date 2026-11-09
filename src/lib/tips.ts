/**
 * Tips at checkout — ONE place for the rules, shared by the /status page (what
 * the picker offers) and /api/checkout (what actually gets charged), so the two
 * can't disagree.
 *
 * Rules:
 *  - Only when the business turned tips on (organizations.tips_enabled).
 *  - Only on a bill for finished work (complete / invoiced), and only when the
 *    customer is paying the WHOLE balance — never on a deposit or a part payment.
 *  - The customer picks a percent from TIP_PCTS (or none). The server works the
 *    cents out itself from the percent; a cents figure from the browser is never
 *    trusted.
 *  - The tip is kept apart from the job amount: it doesn't pay down the
 *    balance and Creed's platform fee is never taken on it.
 */

/** The percent choices the picker shows, besides "No tip". */
export const TIP_PCTS = [10, 15, 20] as const;

export type TipPct = (typeof TIP_PCTS)[number];

/** A valid percent from the picker, or 0 (no tip) for anything else. */
export function cleanTipPct(raw: unknown): number {
  const n = Number(raw);
  return (TIP_PCTS as readonly number[]).includes(n) ? n : 0;
}

/** Tip in cents for a percent of the job amount (cents), rounded to the cent. */
export function tipCentsFor(amountCents: number, pct: number): number {
  const a = Math.max(0, Math.round(Number(amountCents) || 0));
  const p = cleanTipPct(pct);
  return p ? Math.round((a * p) / 100) : 0;
}

export interface TipEligibilityInput {
  tipsEnabled: boolean | null | undefined;
  jobStatus: string | null | undefined;
  /** What this payment charges for the job (dollars). */
  payAmount: number;
  /** What's still owed on the job (dollars). */
  balance: number;
}

/** Whether a tip may be added to this payment. */
export function tipAllowed(i: TipEligibilityInput): boolean {
  if (i.tipsEnabled !== true) return false;
  if (i.jobStatus !== "complete" && i.jobStatus !== "invoiced") return false;
  const pay = Number(i.payAmount) || 0;
  const bal = Number(i.balance) || 0;
  // Paying the whole balance (1¢ slack for rounding).
  return pay > 0 && bal > 0 && pay >= bal - 0.01;
}
