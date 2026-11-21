/**
 * The ONE quote-pricing cascade: minimum-labor floor → trip fee →
 * discount (applied pre-tax, capped at the base) → tax (via computeTax's
 * per-org mode) → grand total.
 *
 * Shared by QuoteForge's live preview (headline AND each three-tier
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
import { computeTax, resolveTaxMode, type TaxMode } from "./tax";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The org settings that drive a quote's price. Structural on purpose: a full
 * Organization row, the narrow select a server job makes (lead drafts) and a
 * test literal all satisfy it.
 */
export interface PricingOrg {
  default_rate?: number | null;
  /** JSON string: { "plumbing": 75, … } */
  trade_rates?: string | null;
  markup_pct?: number | null;
  tax_pct?: number | null;
  tax_mode?: string | null;
  trip_fee?: number | null;
  min_labor_hours?: number | null;
}

/** The labor rates a saved quote was priced with (the default + per-trade),
 *  kept on the quote so raising your rate later doesn't reprice quotes that
 *  are already out (quote-blob.ts readPricedRates). */
export interface PricedRates {
  rate: number;
  trades: Record<string, number> | null;
}

/** Per-quote decisions that beat the org's settings (all optional / nullable). */
export interface PricingOverrides {
  /** "this job bills at $X/hr" — ignored unless > 0. */
  laborRate?: number | null;
  /** Per-quote minimum billable hours — 0 is honored (turns the floor off). */
  minLaborHours?: number | null;
  taxMode?: TaxMode | null;
  /** The rates a saved quote was priced with — beat the org's CURRENT
   *  default / trade rates (a per-quote laborRate still beats both). */
  priced?: PricedRates | null;
}

export interface PricingInputs {
  /** Org labor rate, $55 when none is set. */
  defaultRate: number;
  /** The rate everything non-trade bills at: per-quote override → defaultRate. */
  rate: number;
  /** Parsed trade_rates, null when the org has none / the JSON is bad. */
  tradeRates: Record<string, number> | null;
  markupPct: number;
  taxPct: number;
  taxMode: TaxMode;
  tripFee: number;
  /** Minimum billable hours: per-quote → org → 1. */
  minHrs: number;
}

export function parseTradeRates(raw: unknown): Record<string, number> | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, number>) : null;
  } catch {
    return null;
  }
}

/**
 * ONE place that turns org settings + a quote's overrides into the inputs
 * priceCascade / rateForRoom / billedMaterial take. QuoteForge's live preview,
 * the printed quote (quote-pdf) and the AI lead draft each used to re-derive
 * these by hand ("min hours defaults to 1", "trip fee or 0", tax-mode
 * fallback…) — three copies that could drift a draft total away from the
 * quote it becomes. The ZIP-based materials purchase tax is separate
 * (material-tax.ts) because it depends on the job's address.
 */
export function pricingInputs(
  org: PricingOrg | null | undefined,
  o: PricingOverrides = {},
): PricingInputs {
  const priced = o.priced && o.priced.rate > 0 ? o.priced : null;
  const defaultRate = priced ? priced.rate : org?.default_rate || 55;
  const orgMin = org?.min_labor_hours;
  return {
    defaultRate,
    rate: o.laborRate && o.laborRate > 0 ? o.laborRate : defaultRate,
    tradeRates: priced ? priced.trades : parseTradeRates(org?.trade_rates),
    markupPct: org?.markup_pct || 0,
    taxPct: org?.tax_pct || 0,
    taxMode: o.taxMode ?? resolveTaxMode(org?.tax_mode),
    tripFee: org?.trip_fee || 0,
    minHrs:
      typeof o.minLaborHours === "number" && o.minLaborHours >= 0
        ? o.minLaborHours
        : typeof orgMin === "number" && orgMin >= 0
          ? orgMin
          : 1,
  };
}

/**
 * Per-room (trade-bucket) labor-rate resolution — ONE implementation for
 * QuoteForge's live preview and export-pdf, so the printed section rates
 * match the on-screen ones. Order: per-quote override (an explicit "this
 * job bills at $X/hr" decision) → the org's trade_rates entry whose key
 * the room name contains → the org default. A zero/negative trade rate is
 * ignored (never bill labor at $0 because of a bad settings row).
 */
export function rateForRoom(
  roomName: string,
  o: {
    defaultRate: number;
    override?: number | null;
    tradeRates?: Record<string, number> | null;
  },
): number {
  if (o.override && o.override > 0) return o.override;
  if (o.tradeRates) {
    for (const [trade, r] of Object.entries(o.tradeRates)) {
      if (typeof r === "number" && r > 0 && roomName.toLowerCase().includes(trade.toLowerCase())) return r;
    }
  }
  return o.defaultRate;
}

/**
 * Billed materials $ from shelf cost: the sales tax the business pays when it
 * BUYS the materials (org.material_tax_pct — a cost it has to recover; not the
 * customer-facing sales tax, which is tax_pct/tax_mode) then the org's markup.
 * Quote material prices (AI estimates, learned receipt items, typed costs)
 * are pre-tax shelf prices. One helper for QuoteForge + export-pdf.
 */
export function billedMaterial(raw: number, o: { materialTaxPct?: number | null; markupPct?: number | null }): number {
  const tax = o.materialTaxPct && o.materialTaxPct > 0 ? o.materialTaxPct : 0;
  const mk = o.markupPct && o.markupPct > 0 ? o.markupPct : 0;
  if (!tax && !mk) return raw;
  return Math.round(raw * (1 + tax / 100) * (1 + mk / 100) * 100) / 100;
}

/** One trade section of a quote's price breakdown. */
export interface QuoteSection {
  name: string;
  hrs: number;
  labor: number;
  /** Billed materials (purchase tax + markup). */
  mat: number;
  total: number;
  count: number;
  details: string[];
  /** Each line's own price (its hours × the section rate + its billed
   *  materials) — what a flat-price quote shows the customer. They add up to
   *  `total`. */
  lines: { detail: string; price: number }[];
}

/**
 * The per-trade price breakdown the printed quote and the customer's quote
 * page both show: rooms folded by trade name (case-insensitive), labor at
 * that trade's rate (rateForRoom: override → trade rate → default) and
 * billed materials. One helper so the customer's page can't price a section
 * differently from the PDF (it once used raw materials and the org default
 * rate, so its sections didn't add up).
 */
export function quoteSections(
  rooms: { name: string; items: { laborHrs?: number; materials?: { c?: number }[]; detail?: string }[] }[],
  o: { rate: number; override?: number | null; tradeRates?: Record<string, number> | null; materialTaxPct?: number | null; markupPct?: number | null },
  keep: (item: { laborHrs?: number; materials?: { c?: number }[]; detail?: string; tiers?: unknown }) => boolean = () => true,
): QuoteSection[] {
  const byKey: Record<string, { name: string; items: { laborHrs?: number; materials?: { c?: number }[]; detail?: string }[] }> = {};
  const order: string[] = [];
  for (const rm of rooms) {
    const items = (rm?.items || []).filter(keep);
    if (!items.length) continue;
    const key = rm.name.trim().toLowerCase();
    if (!byKey[key]) { byKey[key] = { name: rm.name, items: [] }; order.push(key); }
    byKey[key].items.push(...items);
  }
  return order.map((k) => {
    const { name, items } = byKey[k];
    const hrs = items.reduce((s, it) => s + (it.laborHrs || 0), 0);
    const rate = rateForRoom(name, { defaultRate: o.rate, override: o.override, tradeRates: o.tradeRates });
    const labor = hrs * rate;
    const lineMat = (it: (typeof items)[number]) => billedMaterial((it.materials || []).reduce((ss, m) => ss + (m.c || 0), 0), o);
    const mat = items.reduce((s, it) => s + lineMat(it), 0);
    return {
      name, hrs, labor, mat, total: labor + mat, count: items.length,
      details: items.map((it) => it.detail || "").filter(Boolean),
      lines: items.map((it) => ({ detail: it.detail || "", price: (it.laborHrs || 0) * rate + lineMat(it) })),
    };
  });
}

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
