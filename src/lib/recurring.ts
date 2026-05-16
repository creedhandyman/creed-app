/**
 * Recurring jobs — shared helpers between the client UI and the cron
 * endpoint. The cadence math lives here so the "Next fire" preview the
 * UI shows when you save a template matches exactly what the server
 * will compute when it actually fires.
 */

export type Cadence =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual";

export const CADENCES: Cadence[] = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
];

export const CADENCE_LABELS: Record<Cadence, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Every 3 months",
  semiannual: "Every 6 months",
  annual: "Yearly",
};

export const DAY_OF_WEEK_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export interface NextFireOpts {
  /** 0=Sun..6=Sat — only used for weekly/biweekly. */
  dayOfWeek?: number | null;
  /** 1..28 — clamped so February doesn't drop a fire. Used for monthly+. */
  dayOfMonth?: number | null;
  /** Hour-of-day (0-23). Defaults to 9. */
  hour?: number | null;
}

/**
 * Compute the next fire time strictly AFTER `from`, given the cadence
 * and optional day/hour pinning. The returned Date is in the same
 * timezone as `from` (no UTC normalization — Postgres TIMESTAMPTZ
 * stores the instant correctly either way).
 *
 * Math:
 *   - weekly/biweekly: add 7/14 days, then snap forward to dayOfWeek.
 *   - monthly+:        add 1/3/6/12 months, then snap to dayOfMonth
 *                      (clamped to 1..28 so Feb is safe).
 */
export function computeNextFire(
  from: Date,
  cadence: Cadence,
  opts?: NextFireOpts,
): Date {
  const next = new Date(from);
  const hour = typeof opts?.hour === "number" ? opts.hour : 9;

  if (cadence === "weekly" || cadence === "biweekly") {
    const step = cadence === "weekly" ? 7 : 14;
    next.setDate(next.getDate() + step);
    if (typeof opts?.dayOfWeek === "number") {
      const target = ((opts.dayOfWeek % 7) + 7) % 7;
      const diff = (target - next.getDay() + 7) % 7;
      next.setDate(next.getDate() + diff);
    }
  } else {
    const months =
      cadence === "monthly" ? 1
      : cadence === "quarterly" ? 3
      : cadence === "semiannual" ? 6
      : 12;
    next.setMonth(next.getMonth() + months);
    if (typeof opts?.dayOfMonth === "number") {
      const day = Math.min(28, Math.max(1, Math.round(opts.dayOfMonth)));
      next.setDate(day);
    }
  }

  next.setHours(hour, 0, 0, 0);
  // Defensive: if rounding/snap landed us at or before `from`, bump one
  // cadence unit forward so the cron doesn't refire instantly.
  if (next.getTime() <= from.getTime()) {
    if (cadence === "weekly") next.setDate(next.getDate() + 7);
    else if (cadence === "biweekly") next.setDate(next.getDate() + 14);
    else next.setMonth(next.getMonth() + 1);
  }
  return next;
}

/** Human-readable "Next: Mon Jan 6, 9am" for the Recurring list rows. */
export function formatNextFire(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const hour = d.getHours();
  const time =
    hour === 0 ? "12am"
    : hour < 12 ? `${hour}am`
    : hour === 12 ? "12pm"
    : `${hour - 12}pm`;
  return `${date}, ${time}`;
}
