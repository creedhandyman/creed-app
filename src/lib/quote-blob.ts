/**
 * Reading a quote's per-quote SETTINGS out of a job's `rooms` blob — the
 * discount, labor-rate / minimum-hours / tax-mode overrides, the materials
 * purchase tax it was priced with, the Good-Better-Best option names, crew size
 * and estimated days. QuoteForge writes them on save; the editor load, the
 * printed quote (quote-pdf), the Jobs invoice and the customer /status page all
 * read them back. Each of those used to carry its own copy of the validity rules
 * ("a discount only counts with a positive value", "0 min hours is valid, a
 * negative one isn't"…), so a rule changed in one place could drift from the
 * others. One set of rules here; each reader turns "bad / absent" into the same
 * `null` / default.
 *
 * Pure, never throws. Pass the blob (job-blob.ts readBlob(job.rooms)), not the row.
 * The quote's PHOTOS are deliberately not here: the editor and the PDF read them
 * differently on purpose (the PDF keeps `rendered` photos as such).
 */
import type { JobDiscount } from "./types";
import type { TaxMode } from "./tax";
import type { RoomsBlob } from "./job-blob";

const isNum = (v: unknown): v is number => typeof v === "number" && !Number.isNaN(v);

/** A per-quote discount only counts as percent/fixed with a positive value. */
export function readDiscount(v: unknown): JobDiscount | null {
  const d = v as { type?: unknown; value?: unknown; label?: unknown } | null | undefined;
  if (d && (d.type === "percent" || d.type === "fixed") && isNum(d.value) && d.value > 0) {
    return { type: d.type, value: d.value, label: typeof d.label === "string" ? d.label : undefined };
  }
  return null;
}

/** "This job bills at $X/hr" — positive numbers only; anything else = org rate. */
export const readLaborRate = (v: unknown): number | null => (isNum(v) && v > 0 ? v : null);

/** Per-quote minimum billable hours. 0 is valid (turns the floor off for this
 *  quote); negative / non-numbers mean "use the org's". */
export const readMinLaborHours = (v: unknown): number | null => (isNum(v) && v >= 0 ? v : null);

export const readTaxMode = (v: unknown): TaxMode | null =>
  v === "total" || v === "materials" || v === "none" ? v : null;

/** The materials purchase-tax rate the quote was priced with (0 is a real,
 *  saved rate; null = a new / legacy quote that carries none). */
export function readMaterialTax(blob: RoomsBlob | null | undefined): { pct: number; zip: string } | null {
  const pct = blob?.materialTaxPct;
  if (!isNum(pct) || pct < 0) return null;
  return { pct, zip: typeof blob?.materialTaxZip === "string" ? blob.materialTaxZip : "" };
}

/** Names of the Better / Best options, defaulting blanks to "Better" / "Best". */
export function readTierNames(v: unknown): { better: string; best: string } {
  const tn = v as { better?: unknown; best?: unknown } | null | undefined;
  return {
    better: typeof tn?.better === "string" && tn.better.trim() ? tn.better : "Better",
    best: typeof tn?.best === "string" && tn.best.trim() ? tn.best : "Best",
  };
}

export const readCrewSize = (v: unknown): number | null => (isNum(v) && v > 0 ? Math.round(v) : null);

export const readEstDays = (v: unknown): number | null => (isNum(v) && v > 0 ? v : null);

export interface QuoteSettings {
  discount: JobDiscount | null;
  laborRate: number | null;
  minLaborHours: number | null;
  taxMode: TaxMode | null;
  materialTax: { pct: number; zip: string } | null;
  tieredQuote: boolean;
  tierNames: { better: string; best: string };
  crewSize: number | null;
  estDays: number | null;
}

export function readQuoteSettings(blob: RoomsBlob | null | undefined): QuoteSettings {
  return {
    discount: readDiscount(blob?.discount),
    laborRate: readLaborRate(blob?.laborRate),
    minLaborHours: readMinLaborHours(blob?.minLaborHours),
    taxMode: readTaxMode(blob?.taxMode),
    materialTax: readMaterialTax(blob),
    tieredQuote: blob?.tieredQuote === true,
    tierNames: readTierNames(blob?.tierNames),
    crewSize: readCrewSize(blob?.crewSize),
    estDays: readEstDays(blob?.estDays),
  };
}
