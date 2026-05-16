/**
 * Tax computation shared between QuoteForge (live preview), export-pdf
 * (Quote PDF), and the customer portal. Centralized so every surface
 * applies the same rule and the per-org `tax_mode` setting is honored
 * consistently.
 *
 * Modes:
 *   - "total"     — tax applies to (labor + materials + tripFee) after
 *                   the discount. The pre-tax_mode behavior.
 *   - "materials" — tax applies to the materials portion only. The
 *                   discount is allocated proportionally between labor
 *                   and materials so a $50 discount on a $500
 *                   labor / $500 materials quote reduces the materials
 *                   taxable base by $25 (not $50). Most US contractors.
 *   - "none"      — tax doesn't apply (tax-exempt customers, jobs
 *                   outside a taxable state).
 *
 * `tripFee` is treated like labor — it's a service charge, not a
 * material — so it falls outside the materials-only base.
 */
export type TaxMode = "total" | "materials" | "none";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function resolveTaxMode(value: unknown): TaxMode {
  return value === "materials" || value === "none" || value === "total"
    ? value
    : "total";
}

export interface TaxComputationInput {
  /** Labor portion (post-min-labor floor, post-rate). */
  labor: number;
  /** Materials portion (post-markup). */
  materials: number;
  /** Trip fee — taxed like labor under `total` mode; not taxed under `materials`. */
  tripFee: number;
  /** Discount $ already capped at preDiscountBase. Positive number or 0. */
  discountAmount: number;
  /** Tax rate percentage (e.g. 7.5 for 7.5%). 0 = no tax line. */
  taxPct: number;
  /** Mode resolved from per-quote override → org default → "total". */
  taxMode: TaxMode;
}

export interface TaxComputationResult {
  /** Dollar amount that the tax rate was applied to. */
  taxableBase: number;
  /** Tax owed. 0 when mode = "none" or taxPct = 0. */
  taxAmount: number;
  /** Label fragment for the tax line on PDFs / live preview, e.g.
   *  "Tax (7.5% on materials)". Empty string when no tax line should
   *  render. */
  taxLabel: string;
  /** Echo of the mode used — handy for downstream UI tweaks. */
  taxMode: TaxMode;
}

export function computeTax(opts: TaxComputationInput): TaxComputationResult {
  const { labor, materials, tripFee, discountAmount, taxPct, taxMode } = opts;
  const preDiscountBase = labor + materials + tripFee;
  const baseAfterDiscount = Math.max(0, r2(preDiscountBase - discountAmount));

  if (taxMode === "none" || taxPct <= 0) {
    return { taxableBase: 0, taxAmount: 0, taxLabel: "", taxMode };
  }

  if (taxMode === "materials") {
    // Allocate the discount proportionally across labor + materials +
    // trip fee, then tax only what's left of the materials portion.
    if (preDiscountBase <= 0 || materials <= 0) {
      return {
        taxableBase: 0,
        taxAmount: 0,
        taxLabel: `Tax (${taxPct}% on materials)`,
        taxMode,
      };
    }
    const matShareOfBase = materials / preDiscountBase;
    const matDiscount = r2(discountAmount * matShareOfBase);
    const matTaxable = Math.max(0, r2(materials - matDiscount));
    const taxAmount = r2(matTaxable * (taxPct / 100));
    return {
      taxableBase: matTaxable,
      taxAmount,
      taxLabel: `Tax (${taxPct}% on materials)`,
      taxMode,
    };
  }

  // "total" — historical behavior.
  const taxAmount = r2(baseAfterDiscount * (taxPct / 100));
  return {
    taxableBase: baseAfterDiscount,
    taxAmount,
    taxLabel: `Tax (${taxPct}%)`,
    taxMode,
  };
}
