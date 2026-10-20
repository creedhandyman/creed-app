/**
 * Timed promo codes (SERVER-ONLY — imported by /api/promo/apply).
 *
 * Unlike the PROMO_CODES env codes (which comp an org forever by turning
 * billing_enforced off), a timed code gives free access for N months: it
 * pushes the org's pre-subscription free period (organizations.trial_ends_at)
 * out, and the normal paywall / "subscribe before it ends" flow takes over
 * after that. Stripe Checkout keeps the remaining free time as its trial, so
 * subscribing early doesn't cost them the promo.
 *
 * Only a SHA-256 hash of each code is kept here, so the code itself never
 * appears in the repo or the bundle. Redemptions are counted in
 * `promo_redemptions` (service-role only) to enforce `maxUses`.
 */
import { createHash } from "crypto";

export type TimedPromo = { id: string; hash: string; months: number; maxUses: number };

export const TIMED_PROMOS: TimedPromo[] = [
  // First real customer business — 3 months free, one business only (2026-10-20).
  { id: "first-customer-3mo", hash: "e4de99e584262f139f0c97647ad6db75dfe5e96cd8b212ce27f13c150ced43df", months: 3, maxUses: 1 },
];

export function findTimedPromo(code: string): TimedPromo | null {
  const h = createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
  return TIMED_PROMOS.find((p) => p.hash === h) || null;
}

/** New free-access end: `months` from now, but never shorter than what the
 *  org already has (a longer trial isn't cut short). */
export function promoEnd(months: number, currentEnd: Date, now = new Date()): Date {
  const end = new Date(now);
  end.setMonth(end.getMonth() + months);
  return currentEnd > end ? currentEnd : end;
}
