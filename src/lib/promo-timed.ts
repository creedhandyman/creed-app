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

export type TimedPromo = {
  id: string; hash: string; months: number; maxUses: number;
  /** Stacking code: adds this many days ON TOP of the free time the business
   *  already has (14-day trial + 76 days = ~3 months), instead of `months`
   *  from today. */
  addDays?: number;
};

export const TIMED_PROMOS: TimedPromo[] = [
  // First real customer business — 3 months free, one business only (2026-10-20).
  { id: "first-customer-3mo", hash: "e4de99e584262f139f0c97647ad6db75dfe5e96cd8b212ce27f13c150ced43df", months: 3, maxUses: 1 },
  // Founding members — 2.5 months on top of the 14-day trial (~3 months free), first 25 businesses (2026-10-31).
  { id: "founding-25", hash: "7a83ac16d7be2d02198108f937660c72c26a049a486323da192c07f1f0c0529f", months: 2.5, addDays: 76, maxUses: 25 },
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

/** Stacking end: `days` added after the later of now and the current free
 *  end — the trial isn't cut short, and an expired trial restarts from today. */
export function promoStackEnd(days: number, currentEnd: Date, now = new Date()): Date {
  const from = currentEnd > now ? currentEnd : now;
  return new Date(from.getTime() + days * 86_400_000);
}

/** Free-access end a promo grants. */
export function promoEndFor(promo: Pick<TimedPromo, "months" | "addDays">, currentEnd: Date, now = new Date()): Date {
  return promo.addDays ? promoStackEnd(promo.addDays, currentEnd, now) : promoEnd(promo.months, currentEnd, now);
}
