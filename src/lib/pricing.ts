/**
 * The ONE quote-pricing cascade: minimum-labor floor → trip fee →
 * discount (applied pre-tax, capped at the base) → tax (via computeTax's
 * per-org mode) → grand total.
 *
 * Shared by QuoteForge's live preview (headline AND each Good/Better/Best
 * tier) and export-pdf's printed quote (headline AND tier columns), so the
 * number on screen, the number on the signed PDF, and every tier option
 * are always the same math. Before this existed the cascade lived as four
 * near-identical inline copies (two per file) — exactly the kind of
 * duplication that drifts a printed total away from the approved one.
 *
 * Two calling modes, differing only in rounding provenance:
 *  - LINE mode (QuoteForge): the caller prices each line item and passes
 *    `subtotalRaw` = Σ per-item rounded totals. Labor stays unrounded when
 *    the floor doesn't apply — byte-identical to the historical preview.
 *  - AGGREGATE mode (export-pdf): no `subtotalRaw`. Labor is rounded to
 *    cents and subtotal derived as round(labor + materials), so every
 *    number printed on the PDF is a cascade output, self-consistent to
 *    the cent.
 */
import { computeTax, type TaxMode } from "./tax";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface CascadeDiscount {
  type: "percent" | "fixed";
  value: number;
}

export interface CascadeInput {
  /** Labor $ before the min-floor (Σ hrs × applicable rate), unrounded. */
  laborRaw: number;
  /** Total labor hours before the floor. */
  hoursRaw: number;
  /** Materials $ with markup already applied. */
  materials: number;
  /** The rate the minimum-labor floor bills at (effective non-trade rate). */
  rate: number;
  /** Resolved minimum billable hours (per-quote → org → fallback). 0 disables.
   *  The floor only fires when the quote already carries SOME labor —
   *  a pure-materials quote never gets a phantom service charge. */
  minHrs: number;
  tripFee: number;
  discount: CascadeDiscount | null | undefined;
  /** Tax rate percentage (7.5 = 7.5%). */
  taxPct: number;
  taxMode: TaxMode;
  /** LINE mode: Σ per-item rounded totals (labor+materials per line). */
  subtotalRaw?: number;
}

export interface CascadeResult {
  minApplies: boolean;
  /** Billed hours (floored when the minimum applies). */
  th: number;
  /** Billed labor $ (floored when the minimum applies). */
  tl: number;
  /** Work subtotal (labor + materials, post-floor, pre trip fee). */
  subtotal: number;
  preDiscountBase: number;
  discountAmount: number;
  baseAfterDiscount: number;
  taxAmount: number;
  taxLabel: string;
  grandTotal: number;
}

export function priceCascade(c: CascadeInput): CascadeResult {
  const minApplies = c.minHrs > 0 && c.hoursRaw > 0 && c.hoursRaw < c.minHrs;
  const flooredLabor = minApplies ? r2(c.minHrs * c.rate) : c.laborRaw;
  const aggregate = c.subtotalRaw === undefined;
  const tl = aggregate ? r2(flooredLabor) : flooredLabor;
  const th = minApplies ? c.minHrs : c.hoursRaw;
  const subtotal = aggregate
    ? r2(tl + c.materials)
    : minApplies
      ? r2((c.subtotalRaw as number) + (tl - c.laborRaw))
      : (c.subtotalRaw as number);
  // Trip fee is a service charge added before tax — tax applies to the
  // combined work + trip-fee base (per the mode).
  const preDiscountBase = subtotal + c.tripFee;
  // Discount applies BEFORE tax so the customer doesn't pay tax on the
  // discounted portion; a fixed discount is capped at the base so it can
  // never drive the total negative.
  const discountAmount =
    c.discount && c.discount.value > 0
      ? c.discount.type === "percent"
        ? r2(preDiscountBase * (c.discount.value / 100))
        : Math.min(preDiscountBase, c.discount.value)
      : 0;
  const baseAfterDiscount = Math.max(0, r2(preDiscountBase - discountAmount));
  const tax = computeTax({
    labor: tl,
    materials: c.materials,
    tripFee: c.tripFee,
    discountAmount,
    taxPct: c.taxPct,
    taxMode: c.taxMode,
  });
  const grandTotal = r2(baseAfterDiscount + tax.taxAmount);
  return {
    minApplies,
    th,
    tl,
    subtotal,
    preDiscountBase,
    discountAmount,
    baseAfterDiscount,
    taxAmount: tax.taxAmount,
    taxLabel: tax.taxLabel,
    grandTotal,
  };
}
