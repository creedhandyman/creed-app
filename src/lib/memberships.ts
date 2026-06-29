// Shared membership/service-plan helpers — used by the API routes, the
// recurring cron, and the UI so the billing-interval and visit-cadence math
// can't drift between them.

import type { Cadence } from "./recurring";
import type { MembershipInterval } from "./types";

/** Human labels for a plan's BILLING interval. */
export const INTERVAL_LABEL: Record<MembershipInterval, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

/** Visit-frequency presets offered in the plan editor → maps cleanly to a
 *  supported recurring Cadence (no awkward bimonthly gap). */
export const VISIT_FREQ: { visits: number; label: string }[] = [
  { visits: 12, label: "Monthly" },
  { visits: 4, label: "Quarterly" },
  { visits: 2, label: "Twice a year" },
  { visits: 1, label: "Yearly" },
];

/** Plan visits-per-year → the recurring-jobs Cadence used to auto-schedule
 *  service visits. Falls through by range for any non-preset value. */
export function visitCadence(visitsPerYear: number | null | undefined): Cadence {
  const v = Number(visitsPerYear) || 1;
  if (v >= 12) return "monthly";
  if (v >= 4) return "quarterly";
  if (v >= 2) return "semiannual";
  return "annual";
}

/** Plan BILLING interval → Stripe Price recurring config. Quarterly = every
 *  3 months (Stripe has no native "quarter"). */
export function stripeRecurring(interval: MembershipInterval): { interval: "month" | "year"; interval_count: number } {
  if (interval === "annual") return { interval: "year", interval_count: 1 };
  if (interval === "quarterly") return { interval: "month", interval_count: 3 };
  return { interval: "month", interval_count: 1 };
}
