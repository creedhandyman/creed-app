/**
 * Reading a quote's per-quote SETTINGS out of a job's `rooms` blob — the
 * discount, labor-rate / minimum-hours / tax-mode overrides, the materials
 * purchase tax it was priced with, the three-tier option names, crew size
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
import { TIER_NAMES, itemInTier } from "./tiers";
import { rateForRoom, type PricedRates } from "./pricing";

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

/** Names of the upper two tiers. FIXED since three-tier quoting (2026-11-12):
 *  Complete / Premium, whatever an old quote saved (renaming is gone — one
 *  system). Kept as a reader so callers keep their shape. */
export function readTierNames(_v?: unknown): { better: string; best: string } {
  return { ...TIER_NAMES };
}

/** The one tier the quote was SENT as (send menu "only Essential / Complete /
 *  Premium"), or null = all tiers. Only meaningful on a tiered quote whose
 *  totals include that tier — anything else reads as null. */
export function readSentTier(blob: RoomsBlob | null | undefined): "base" | "better" | "best" | null {
  if (blob?.tieredQuote !== true) return null;
  const v = blob?.sentTier;
  if (v !== "base" && v !== "better" && v !== "best") return null;
  const tt = blob?.tierTotals as Record<string, unknown> | undefined;
  return tt && typeof tt[v] === "number" ? v : null;
}

/**
 * The labor rates this quote was priced with, so it keeps its price after the
 * owner changes their rate (2026-11-14: Creed went $55 → $76 and every saved
 * quote without a per-quote rate reopened, printed and showed the customer
 * at $76). Saves since then store `pricedRates`. For an older quote pass
 * `legacy` (its saved labor + today's org rates): the rate that reproduces
 * its saved labor is used — unless today's rates already reproduce it (then
 * null = use today's, trade rates and all). null too when a per-quote
 * laborRate governs, or nothing sensible can be inferred.
 */
export function readPricedRates(
  blob: RoomsBlob | null | undefined,
  legacy?: { totalLabor: unknown; minHrs: number; defaultRate: number; tradeRates: Record<string, number> | null },
): PricedRates | null {
  const v = blob?.pricedRates as { rate?: unknown; trades?: unknown } | null | undefined;
  if (v && isNum(v.rate) && v.rate > 0) {
    let trades: Record<string, number> | null = null;
    if (v.trades && typeof v.trades === "object" && !Array.isArray(v.trades)) {
      const t: Record<string, number> = {};
      for (const [k, r] of Object.entries(v.trades as Record<string, unknown>)) if (isNum(r) && r > 0) t[k] = r;
      trades = Object.keys(t).length ? t : null;
    }
    return { rate: v.rate, trades };
  }
  if (!legacy || readLaborRate(blob?.laborRate)) return null;
  type It = { laborHrs?: unknown; tiers?: unknown; tier?: unknown };
  const rooms = (Array.isArray(blob?.rooms) ? blob!.rooms : []) as { name?: unknown; items?: It[] }[];
  // Which lines the saved labor covers: every line, or (three-tier) one
  // priced tier's lines with that tier's saved labor.
  let saved = Number(legacy.totalLabor);
  let keep: (it: It) => boolean = () => true;
  const tb = blob?.tieredQuote === true ? (blob?.tierBreakdown as Record<string, { labor?: unknown }> | null) : null;
  if (tb && typeof tb === "object") {
    const k = (["base", "better", "best"] as const).find((t) => isNum(tb[t]?.labor) && (tb[t]!.labor as number) > 0);
    if (!k) return null;
    saved = tb[k]!.labor as number;
    keep = (it) => itemInTier(it as Parameters<typeof itemInTier>[0], k);
  }
  if (!(saved > 0)) return null;
  let hrs = 0;
  let laborToday = 0;
  for (const r of rooms) {
    for (const it of r?.items || []) {
      if (!it || !keep(it) || !isNum(it.laborHrs)) continue;
      hrs += it.laborHrs;
      laborToday += it.laborHrs * rateForRoom(typeof r.name === "string" ? r.name : "", { defaultRate: legacy.defaultRate, tradeRates: legacy.tradeRates });
    }
  }
  if (!(hrs > 0)) return null;
  const billedHrs = Math.max(hrs, legacy.minHrs);
  if (hrs < legacy.minHrs) laborToday = legacy.minHrs * legacy.defaultRate;
  if (Math.abs(laborToday - saved) <= 0.05 + saved * 0.001) return null; // today's rates still price it
  const rate = Math.round((saved / billedHrs) * 100) / 100;
  return rate >= 5 && rate <= 1000 ? { rate, trades: null } : null;
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
