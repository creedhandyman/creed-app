// Flip Mode — the deal math. ONE pure function feeds the Deal Analyzer (and
// any future flip PDF / dashboard) so the numbers can never drift between
// screens. Only the inputs live on the flip_projects row; everything returned
// here is derived and never stored.

import type { FlipComp, FlipProject, Job, Profile, Receipt, TimeEntry } from "./types";
import { makeEntryPay } from "./financials";

export const RULE_70 = 0.70;        // classic 70% rule ceiling (of ARV, minus rehab)
export const THIN_PROFIT = 20000;   // profit below this = "thin" (warn)

export type FlipVerdict = "good" | "warn" | "bad";

export interface FlipAnalysis {
  holding: number;     // holding_monthly × holding_months
  selling: number;     // agent + closing, $ (selling_pct of ARV)
  allIn: number;       // purchase + rehab + holding + financing + contingency
  netSale: number;     // ARV − selling costs
  profit: number;      // netSale − allIn
  cashIn: number;      // cash out of pocket: down payment + everything but the loan
  roi: number;         // profit ÷ cashIn (0 when nothing is in)
  maxBuy: number;      // 70% rule: ARV × 0.70 − rehab
  passes70: boolean;   // purchase ≤ maxBuy
  verdict: FlipVerdict;
}

const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function analyzeFlip(p: Partial<FlipProject>): FlipAnalysis {
  const purchase = num(p.purchase_price);
  const rehab = num(p.rehab_budget);
  const arv = num(p.arv);
  const holding = num(p.holding_monthly) * num(p.holding_months);
  const selling = arv * (num(p.selling_pct) / 100);
  const financing = num(p.financing_cost);
  const contingency = num(p.contingency);

  const allIn = purchase + rehab + holding + financing + contingency;
  const netSale = arv - selling;
  const profit = netSale - allIn;
  const cashIn = rehab + holding + financing + contingency
    + purchase * (num(p.down_pct) / 100);
  const roi = cashIn > 0 ? profit / cashIn : 0;
  const maxBuy = arv * RULE_70 - rehab;
  const passes70 = purchase <= maxBuy;
  const verdict: FlipVerdict = profit <= 0 ? "bad"
    : (!passes70 || profit < THIN_PROFIT) ? "warn" : "good";

  return { holding, selling, allIn, netSale, profit, cashIn, roi, maxBuy, passes70, verdict };
}

// ── Phase 2: the project dashboard ────────────────────────────────────────
// A flip owns ordinary jobs (jobs.flip_project_id). What it has cost so far
// is rolled up from data the app already captures — receipts and time
// entries on those jobs — never typed in a second time, never stored.

export const HOLD_DAY = 30; // a holding month in days (holding_monthly ÷ 30 = per day)

const DONE_STATUSES = ["complete", "invoiced", "paid"];

/** One linked job = one area of the rehab: its budget vs what it has cost. */
export interface FlipLine {
  jobId: string;
  label: string;       // the job's areas ("Kitchen · Bath"), else its address
  status: string;
  done: boolean;       // job is complete / invoiced / paid
  budget: number;      // the job's quoted total
  materials: number;   // Σ receipts on the job
  labor: number;       // Σ time-entry cost (recorded amount, else hrs × current rate)
  actual: number;      // materials + labor
  over: number;        // actual − budget when over budget, else 0
  tasksDone: number;   // work-order ticks
  tasksTotal: number;
}

export interface FlipActuals {
  lines: FlipLine[];
  materials: number;
  labor: number;
  spent: number;         // materials + labor across every linked job
  budgetLinked: number;  // Σ line budgets
  allDone: boolean;      // ≥1 linked job and every one is done
  /** Hours logged by someone with no pay rate. They cost $0 here (no
   *  `rate || 55` style guess), so the spend is understated — the UI says so. */
  unratedHrs: number;
}

/** Work-order ticks + the job's areas (work-order trades, else quote rooms).
 *  Every job on a flip sits at the same address, so the areas name the line. */
function jobScope(rooms: unknown): { done: number; total: number; areas: string[] } {
  try {
    const blob = typeof rooms === "string" ? JSON.parse(rooms) : rooms;
    const wo: { done?: boolean; room?: string }[] = Array.isArray(blob?.workOrder) ? blob.workOrder : [];
    const quoteRooms: { name?: string }[] = Array.isArray(blob?.rooms) ? blob.rooms : [];
    const names = (wo.length ? wo.map((w) => w?.room) : quoteRooms.map((r) => r?.name))
      .map((n) => String(n || "").trim())
      .filter(Boolean);
    return { done: wo.filter((w) => w?.done).length, total: wo.length, areas: [...new Set(names)] };
  } catch {
    return { done: 0, total: 0, areas: [] };
  }
}

/** Budget vs actual for one flip. `jobs` must be ALL the org's jobs: a legacy
 *  time entry with no job_id is credited by address to the OLDEST job there
 *  (the Jobs screen's hours-card rule), so the full list decides who that is. */
export function flipActuals(args: {
  flipId: string;
  jobs: Job[];
  receipts: Receipt[];
  timeEntries: TimeEntry[];
  profiles: Profile[];
}): FlipActuals {
  const { flipId, jobs, receipts, timeEntries, profiles } = args;
  const entryPay = makeEntryPay(profiles);
  let unratedHrs = 0;

  const lines: FlipLine[] = jobs.filter((j) => j.flip_project_id === flipId).map((j) => {
    const isOldestAtAddress = !!j.property && jobs
      .filter((o) => o.property === j.property)
      .every((o) => (j.created_at || "") <= (o.created_at || ""));
    const entries = timeEntries.filter((e) =>
      e.job_id ? e.job_id === j.id : isOldestAtAddress && e.job === j.property,
    );
    let labor = 0;
    for (const e of entries) {
      const pay = num(entryPay(e));
      if (pay === 0) unratedHrs += num(e.hours);
      labor += pay;
    }
    const materials = receipts.filter((r) => r.job_id === j.id).reduce((s, r) => s + num(r.amount), 0);
    const actual = materials + labor;
    const budget = num(j.total);
    const wo = jobScope(j.rooms);
    return {
      jobId: j.id,
      label: wo.areas.length
        ? wo.areas.slice(0, 3).join(" · ") + (wo.areas.length > 3 ? ` +${wo.areas.length - 3}` : "")
        : j.property || j.client || "",
      status: j.status,
      done: DONE_STATUSES.includes(j.status),
      budget,
      materials,
      labor,
      actual,
      over: Math.max(0, actual - budget),
      tasksDone: wo.done,
      tasksTotal: wo.total,
    };
  });

  const materials = lines.reduce((s, l) => s + l.materials, 0);
  const labor = lines.reduce((s, l) => s + l.labor, 0);
  return {
    lines,
    materials,
    labor,
    spent: materials + labor,
    budgetLinked: lines.reduce((s, l) => s + l.budget, 0),
    allDone: lines.length > 0 && lines.every((l) => l.done),
    unratedHrs,
  };
}

/** The holding clock: days held (bought → sold, or → now) × holding_monthly ÷ 30. */
export function holdingClock(p: Partial<FlipProject>, now: Date = new Date()) {
  const perDay = num(p.holding_monthly) / HOLD_DAY;
  const start = p.acquired_at ? new Date(p.acquired_at).getTime() : NaN;
  const end = p.sold_at ? new Date(p.sold_at).getTime() : now.getTime();
  const started = Number.isFinite(start);
  const days = started && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 86400000)) : 0;
  return { started, days, perDay, toDate: days * perDay };
}

export interface FlipProgress extends FlipAnalysis {
  plan: FlipAnalysis;        // the underwriting, untouched — for "vs plan"
  rehabProjected: number;    // what the rehab is now expected to cost
  holdingProjected: number;
  salePrice: number;         // sold price once sold, else ARV
  days: number;
  perDay: number;
  holdingToDate: number;
}

/** analyzeFlip with actual spend to date swapped in, so projected profit
 *  tightens as real costs land. Spend under budget is NOT banked as savings
 *  until the rehab is done (unfinished work still has to be paid for), and
 *  holding runs at least the planned months unless the house has sold. */
export function analyzeFlipActuals(
  p: Partial<FlipProject>,
  actual: { spent: number; rehabDone: boolean },
  now: Date = new Date(),
): FlipProgress {
  const plan = analyzeFlip(p);
  const clock = holdingClock(p, now);
  const spent = num(actual.spent);
  const rehabProjected = actual.rehabDone ? spent : Math.max(num(p.rehab_budget), spent);
  const sold = !!p.sold_at;
  const holdingProjected = sold ? clock.toDate : Math.max(plan.holding, clock.toDate);
  const salePrice = sold && num(p.sold_price) > 0 ? num(p.sold_price) : num(p.arv);
  const monthly = num(p.holding_monthly);
  const a = analyzeFlip({
    ...p,
    rehab_budget: rehabProjected,
    arv: salePrice,
    holding_months: monthly > 0 ? holdingProjected / monthly : 0,
  });
  return {
    ...a,
    plan,
    rehabProjected,
    holdingProjected,
    salePrice,
    days: clock.days,
    perDay: clock.perDay,
    holdingToDate: clock.toDate,
  };
}

/** What the comps say the house is worth: the average $/sq ft of comps that
 *  have both a price and a size, × the subject's sq ft (0 when unknown).
 *  null = no usable comp yet. */
export function compsArv(comps: FlipComp[] | null | undefined, sqft: number | null | undefined) {
  const usable = (comps || []).filter((c) => num(c.price) > 0 && num(c.sqft) > 0);
  if (!usable.length) return null;
  const ppsf = usable.reduce((s, c) => s + num(c.price) / num(c.sqft), 0) / usable.length;
  return { ppsf, count: usable.length, arv: num(sqft) > 0 ? ppsf * num(sqft) : 0 };
}
