// Flip Mode — the deal math. ONE pure function feeds the Deal Analyzer (and
// any future flip PDF / dashboard) so the numbers can never drift between
// screens. Only the inputs live on the flip_projects row; everything returned
// here is derived and never stored.

import type { FlipProject } from "./types";

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
