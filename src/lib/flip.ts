// Flip Mode — the deal math. ONE pure function feeds the Deal Analyzer (and
// any future flip PDF / dashboard) so the numbers can never drift between
// screens. Only the inputs live on the flip_projects row; everything returned
// here is derived and never stored.

import type { FlipComp, FlipLoan, FlipProject, FlipSub, Job, Profile, Receipt, TimeEntry } from "./types";
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
  // Rehab the lender pays for (its holdback, released in draws) isn't your
  // cash — so it comes out of cash-in, and ROI is on what you actually put in.
  const financedRehab = Math.min(Math.max(0, num(p.loan?.holdback)), rehab);
  const cashIn = rehab - financedRehab + holding + financing + contingency
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
  actual: { spent: number; rehabDone: boolean; drawFees?: number },
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
    // Lender draw fees actually charged are financing cost on top of the plan's.
    financing_cost: num(p.financing_cost) + num(actual.drawFees),
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

// ── Phase 3: subcontractors + permits, and the resale package ─────────────

export const MAX_BIDS = 3;

/** The picked bid of a trade (first one marked picked), else null. */
export function pickedBid(sub: FlipSub) {
  return (sub.bids || []).find((b) => b.picked) || null;
}

/** Roll-up of the subbed-out trades: what the hired subs were bid (the sub
 *  budget), what's been paid to ANY sub (real spend — counts toward the rehab
 *  actuals, even if that sub was later replaced), and which permits are
 *  still open. */
export function subsSummary(subs: FlipSub[] | null | undefined) {
  const list = (subs || []).filter((s) => s && (s.trade || s.bids?.length));
  let picked = 0;
  let paid = 0;
  let hired = 0;
  for (const s of list) {
    const b = pickedBid(s);
    if (b) { hired++; picked += num(b.amount); }
    for (const x of s.bids || []) paid += num(x.paid);
  }
  const permitOpen = list.filter((s) => ["needed", "applied", "issued"].includes(s.permit?.status || ""));
  const permitFinal = list.filter((s) => s.permit?.status === "final");
  return { trades: list.length, hired, picked, paid, permitOpen, permitFinal };
}

export interface ResalePhoto { url: string; label?: string; sourceUrl?: string }

export interface ResaleData {
  /** Finished work, grouped by area, in the order the jobs list it. */
  areas: { area: string; items: string[] }[];
  before: ResalePhoto[];
  after: ResalePhoto[];
  /** AI "proposed finish" renders — NOT photos of the finished house. */
  renders: ResalePhoto[];
  /** In-progress photos (type "work") — for draw requests, not the resale sheet. */
  work: ResalePhoto[];
}

/** What the resale package says was done: the linked jobs' finished work.
 *  A task counts when it's ticked on the work order, or when its whole job is
 *  done (crews don't always tick every box). A done job with no work order
 *  falls back to its quote lines. Unfinished work is never claimed. */
export function resaleData(flipId: string, jobs: Job[]): ResaleData {
  const areas = new Map<string, string[]>();
  const add = (area: string, item: string) => {
    const a = area.trim() || "General";
    const it = item.trim();
    if (!it) return;
    const list = areas.get(a) || [];
    if (!list.some((x) => x.toLowerCase() === it.toLowerCase())) list.push(it);
    areas.set(a, list);
  };
  const out: ResaleData = { areas: [], before: [], after: [], renders: [], work: [] };
  const seen = new Set<string>();
  for (const j of jobs.filter((x) => x.flip_project_id === flipId)) {
    let blob: Record<string, unknown> | null = null;
    try { blob = typeof j.rooms === "string" ? JSON.parse(j.rooms) : (j.rooms as unknown as Record<string, unknown>); } catch { /* */ }
    const jobDone = DONE_STATUSES.includes(j.status);
    const wo = Array.isArray(blob?.workOrder) ? (blob!.workOrder as { room?: string; detail?: string; done?: boolean }[]) : [];
    if (wo.length) {
      for (const w of wo) if (w && (w.done || jobDone)) add(String(w.room || ""), String(w.detail || ""));
    } else if (jobDone && Array.isArray(blob?.rooms)) {
      for (const r of blob!.rooms as { name?: string; items?: { detail?: string }[] }[]) {
        for (const it of r?.items || []) add(String(r?.name || ""), String(it?.detail || ""));
      }
    }
    const photos = Array.isArray(blob?.photos) ? (blob!.photos as { url?: string; label?: string; type?: string; sourceUrl?: string }[]) : [];
    for (const ph of photos) {
      if (!ph?.url || seen.has(ph.url)) continue;
      seen.add(ph.url);
      const p = { url: ph.url, label: ph.label, sourceUrl: ph.sourceUrl };
      if (ph.type === "before") out.before.push(p);
      else if (ph.type === "after") out.after.push(p);
      else if (ph.type === "rendered") out.renders.push(p);
      else if (ph.type === "work") out.work.push(p);
    }
  }
  out.areas = [...areas].map(([area, items]) => ({ area, items }));
  return out;
}

// ── Lender draws ──────────────────────────────────────────────────────────
// Hard-money / rehab lenders hold the rehab money back and release it in
// draws after inspecting finished work. You pay first and get reimbursed, so
// the numbers that matter are: what's funded, what's still in the holdback,
// how much of your own cash is floating the rehab right now, and how much
// finished work hasn't been drawn on yet.

export const DRAW_STEPS = ["planned", "requested", "inspected", "funded"] as const;

/** A draw's fee: its own, else the loan's per-draw fee. */
export const drawFee = (loan: FlipLoan | null | undefined, d: { fee?: number }) =>
  d.fee !== undefined && d.fee !== null ? num(d.fee) : num(loan?.draw_fee);

export function drawSummary(loan: FlipLoan | null | undefined, spent: number) {
  const draws = loan?.draws || [];
  const holdback = Math.max(0, num(loan?.holdback));
  const sum = (pred: (s: string) => boolean) =>
    draws.filter((d) => pred(d.status)).reduce((s, d) => s + num(d.amount), 0);
  const funded = sum((s) => s === "funded");
  const pending = sum((s) => s === "requested" || s === "inspected");
  const planned = sum((s) => s === "planned");
  const scheduled = funded + pending + planned;
  // Fees are charged on draws that have gone to the lender.
  const fees = draws.filter((d) => d.status !== "planned").reduce((s, d) => s + drawFee(loan, d), 0);
  const cost = Math.max(0, num(spent));
  return {
    holdback,
    funded,
    pending,
    planned,
    scheduled,
    remaining: Math.max(0, holdback - funded - pending),
    overScheduled: holdback > 0 && scheduled > holdback + 0.5,
    fees,
    /** Your own cash currently covering rehab that the lender hasn't paid back. */
    floating: Math.max(0, Math.min(cost, holdback || cost) - funded),
    /** Spent (up to the holdback) that isn't funded or already requested. */
    readyToDraw: holdback > 0 ? Math.max(0, Math.min(cost, holdback) - funded - pending) : 0,
    /** Interest on the funded draws, per month (lenders that charge on drawn funds). */
    interestMonthly: (funded * num(loan?.rate)) / 100 / 12,
    count: draws.length,
  };
}

/** Next state when a draw's status changes: stamps today's date on the step
 *  it reaches (keeping dates already set), clears dates if moved back. */
export function setDrawStatus<T extends { status: string; requested_at?: string; funded_at?: string }>(
  d: T,
  status: T["status"],
  today: string,
): T {
  const rank = (s: string) => DRAW_STEPS.indexOf(s as (typeof DRAW_STEPS)[number]);
  const r = rank(status);
  const next = { ...d, status };
  next.requested_at = r >= 1 ? d.requested_at || today : undefined;
  next.funded_at = r >= 3 ? d.funded_at || today : undefined;
  return next;
}
