/**
 * Shared P&L math — the ONE definition of "revenue" and "net profit".
 *
 * Consumed by the Financials screen AND the Operations hub KPIs (and the
 * dashboard's Revenue·mo mirrors the revenue rule), so the figure teased on
 * one screen is the figure the next screen opens on. Before this existed,
 * the hub ran its own approximation (rolling formula differences: ALL labor
 * logged in the month, archived jobs included, calendar-month window) while
 * Financials used another (completed-job labor only, archived excluded,
 * rolling 30-day window) — the two "Net profit" numbers never matched.
 *
 * Rules, in one place:
 *  - Dates parse LOCAL via parseEntryDate. Raw `new Date("YYYY-MM-DD")` is
 *    UTC midnight — the previous evening in US zones — which silently drops
 *    1st-of-period rows out of the window.
 *  - Jobs anchor on job_date (when the work happened) falling back to
 *    created_at; archived jobs (cold quotes set aside) are excluded.
 *  - Revenue = jobs complete/invoiced/paid in the window ("earned").
 *  - Labor cost counts only entries on COMPLETED jobs — hours on
 *    still-active jobs would drag profit down before their revenue is
 *    booked. WIP labor is reported separately (crewCostOnActive).
 *  - An entry's cost is its recorded amount, falling back to hours × the
 *    person's current rate for legacy rows that predate the amount column
 *    (better than counting them as $0 labor).
 *  - Materials = actual receipts in the window when any exist, else the
 *    materials CHARGED on completed jobs (markup-inclusive proxy).
 */
import { parseEntryDate } from "./dates";
import type { Job, Profile, Receipt, TimeEntry } from "./types";

/** In-window test on the app's loose date strings ("YYYY-MM-DD",
 *  "M/D/YYYY", ISO timestamps), parsed LOCAL. Missing/unparseable = out. */
export const makeInRange = (rangeStart: Date) => (dateStr?: string): boolean => {
  const d = parseEntryDate(dateStr);
  return d ? d >= rangeStart : false;
};

/** What a time entry actually cost (recorded amount, else hrs × current rate). */
export const makeEntryPay = (profiles: Profile[]) => (e: TimeEntry): number => {
  if (e.amount) return e.amount;
  const rate = (e.user_id ? profiles.find((p) => p.id === e.user_id)?.rate : 0) || 0;
  return (e.hours || 0) * rate;
};

export interface ProfitSnapshot {
  /** Non-archived jobs whose job_date||created_at falls in the window. */
  rangeJobs: Job[];
  /** rangeJobs that are complete / invoiced / paid ("earned"). */
  completed: Job[];
  completedRevenue: number;
  /** Time entries whose entry_date falls in the window. */
  rangeEntries: TimeEntry[];
  crewCost: number;
  crewCostPaid: number;
  crewCostOwed: number;
  crewCostOnCompleted: number;
  crewCostOnActive: number;
  periodReceipts: Receipt[];
  actualMaterialsSpent: number;
  /** Materials CHARGED to clients on completed jobs (Σ total_mat). */
  materialsCharged: number;
  /** actualMaterialsSpent when > 0, else materialsCharged. */
  materialsForProfit: number;
  /** completedRevenue − materialsForProfit − crewCostOnCompleted. */
  netProfit: number;
}

export function profitSnapshot(args: {
  jobs: Job[];
  timeEntries: TimeEntry[];
  receipts: Receipt[];
  profiles: Profile[];
  rangeStart: Date;
}): ProfitSnapshot {
  const { jobs, timeEntries, receipts, profiles, rangeStart } = args;
  const inRange = makeInRange(rangeStart);
  const entryPay = makeEntryPay(profiles);

  const rangeJobs = jobs.filter((j) => !j.archived && inRange(j.job_date || j.created_at));
  const completed = rangeJobs.filter((j) => ["complete", "invoiced", "paid"].includes(j.status));
  const completedRevenue = completed.reduce((s, j) => s + (j.total || 0), 0);

  const rangeEntries = timeEntries.filter((e) => inRange(e.entry_date));
  const crewCost = rangeEntries.reduce((s, e) => s + entryPay(e), 0);
  const crewCostPaid = rangeEntries.reduce((s, e) => s + (e.paid_at ? entryPay(e) : 0), 0);
  const crewCostOwed = crewCost - crewCostPaid;

  // job_id match first; legacy rows (no job_id) fall back to matching the
  // entry's address text against completed-job properties.
  const completedJobIds = new Set(completed.map((j) => j.id));
  const completedJobAddrs = new Set(
    completed.map((j) => (j.property || "").toLowerCase().trim()).filter(Boolean),
  );
  const isOnCompletedJob = (e: TimeEntry) =>
    e.job_id ? completedJobIds.has(e.job_id) : completedJobAddrs.has((e.job || "").toLowerCase().trim());
  const crewCostOnCompleted = rangeEntries.filter(isOnCompletedJob).reduce((s, e) => s + entryPay(e), 0);
  const crewCostOnActive = crewCost - crewCostOnCompleted;

  const periodReceipts = receipts.filter((r) => inRange(r.receipt_date));
  const actualMaterialsSpent = periodReceipts.reduce((s, r) => s + (r.amount || 0), 0);
  const materialsCharged = completed.reduce((s, j) => s + (j.total_mat || 0), 0);
  const materialsForProfit = actualMaterialsSpent > 0 ? actualMaterialsSpent : materialsCharged;

  const netProfit = completedRevenue - materialsForProfit - crewCostOnCompleted;

  return {
    rangeJobs,
    completed,
    completedRevenue,
    rangeEntries,
    crewCost,
    crewCostPaid,
    crewCostOwed,
    crewCostOnCompleted,
    crewCostOnActive,
    periodReceipts,
    actualMaterialsSpent,
    materialsCharged,
    materialsForProfit,
    netProfit,
  };
}
