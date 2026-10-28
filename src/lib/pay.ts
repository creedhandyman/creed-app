/**
 * Crew PAY math — what a clocked shift earns and what the next check is.
 *
 * One rule set, shared by Time, Work mode, Home and Payroll:
 *  - A person with no pay rate (rate <= 0 / unset — new joiners start at 0)
 *    earns $0 and the UI says "No rate". There is NO fallback rate for pay:
 *    a guessed $55/hr overpays, and the payroll runner pays the real rate.
 *  - A shift's hours are rounded to 2 dp FIRST, then amount = rounded hours ×
 *    rate, rounded to cents — so the stored amount always equals what the
 *    row's own hours say.
 *  - The "next check" = every UNPAID entry of the person × their current rate,
 *    exactly what Run Payroll pays (lib/payroll-runner: Σ hours × rate).
 *
 * Not the customer labor rate: org.default_rate (QuoteForge / quote PDF /
 * status page) is what the BUSINESS bills and keeps its own default.
 * Cost reporting (financials.makeEntryPay) prefers the recorded amount.
 */
import type { TimeEntry } from "./types";

type RatedPerson = { rate?: number | null } | null | undefined;
type Person = { id: string; name?: string | null };
type EntryOwner = Pick<TimeEntry, "user_id" | "user_name">;

/** The person's real pay rate, or 0 when none is set. */
export function payRate(p: RatedPerson): number {
  const r = Number(p?.rate);
  return Number.isFinite(r) && r > 0 ? r : 0;
}

/** True when the person has a real pay rate on file. */
export function hasPayRate(p: RatedPerson): boolean {
  return payRate(p) > 0;
}

/** Decimal hours rounded to 2 dp — the stored unit. */
export function roundHours(hours: number): number {
  return Math.round((Number(hours) || 0) * 100) / 100;
}

/** What `hours` of work earns this person: rounded hours × rate, in cents. */
export function entryAmount(hours: number, p: RatedPerson): number {
  return Math.round(roundHours(hours) * payRate(p) * 100) / 100;
}

/** Is this time entry the person's? By user id; rows from before the user_id
 *  column (null user_id) fall back to the name. */
export function isUsersEntry(e: EntryOwner, p: Person): boolean {
  return e.user_id === p.id || (!e.user_id && !!p.name && e.user_name === p.name);
}

export interface UnpaidSummary {
  /** Σ hours of the person's unpaid entries. */
  hours: number;
  /** hours × rate in cents (0 with no rate) — what Run Payroll pays. */
  pay: number;
  rateSet: boolean;
  rate: number;
}

/** The person's next check: every unpaid entry of theirs × their rate.
 *  Approved quest bonuses are added at payout, not previewed. */
export function unpaidFor(p: Person & { rate?: number | null }, entries: TimeEntry[]): UnpaidSummary {
  const hours = entries
    .filter((e) => !e.paid_at && isUsersEntry(e, p))
    .reduce((s, e) => s + (Number(e.hours) || 0), 0);
  const rate = payRate(p);
  return { hours, pay: Math.round(hours * rate * 100) / 100, rateSet: rate > 0, rate };
}
