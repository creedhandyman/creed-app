// The free trial — ONE place for its length so the app, the paywall, Stripe
// Checkout and the signup copy can't drift apart. No card is needed to start
// it: a new business gets the trial on signup, and only picks a plan + adds
// a card when they subscribe (any time before it ends).

export const TRIAL_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the org's pre-Stripe trial ends: trial_start (org creation) + TRIAL_DAYS. */
export function trialEndFromStart(trialStart?: string | null): Date {
  const start = trialStart ? new Date(trialStart) : new Date();
  return new Date((isNaN(start.getTime()) ? Date.now() : start.getTime()) + TRIAL_DAYS * DAY_MS);
}

/** Whole days left until `end` (0 once it has passed). */
export function daysLeftUntil(end: Date, now = Date.now()): number {
  return Math.max(0, Math.ceil((end.getTime() - now) / DAY_MS));
}

/** The org's free-access end before it subscribes: the signup trial, or a
 *  later date a timed promo code granted (stored on trial_ends_at) —
 *  whichever is later. */
export function orgTrialEnd(org: { trial_start?: string | null; trial_ends_at?: string | null }): Date {
  const base = trialEndFromStart(org.trial_start);
  const promo = org.trial_ends_at ? new Date(org.trial_ends_at) : null;
  return promo && !isNaN(promo.getTime()) && promo > base ? promo : base;
}
