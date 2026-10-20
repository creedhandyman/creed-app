/**
 * Sales tax the business pays BUYING materials, by ZIP.
 *
 * Quote material prices are pre-tax shelf prices; the real cost includes the
 * sales tax charged where the job is (the store is usually nearby). Rates are
 * looked up per ZIP (/api/tax/material-rate — Claude with web search) and
 * cached on the org (`organizations.material_tax_by_zip`); the owner can
 * correct any of them in Ops → Settings. `organizations.material_tax_pct` is
 * the fallback for a job address with no ZIP. Pure helpers here (tested).
 */
export type ZipTaxEntry = { rate: number; place?: string; source: "lookup" | "owner"; at: string };
export type ZipTaxMap = Record<string, ZipTaxEntry>;

/** Highest combined US sales tax is ~11.5%; anything outside 0–15 is a bad read. */
export const MAX_SANE_RATE = 15;

export function zipTaxMap(raw: unknown): ZipTaxMap {
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return {}; } }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: ZipTaxMap = {};
  for (const [zip, e] of Object.entries(v as Record<string, unknown>)) {
    const r = (e as { rate?: unknown })?.rate;
    if (/^\d{5}$/.test(zip) && typeof r === "number" && r >= 0 && r <= MAX_SANE_RATE) out[zip] = e as ZipTaxEntry;
  }
  return out;
}

/** The rate to price materials with for a job ZIP: that ZIP's rate when known,
 *  else the org default. `known` = whether it came from the ZIP table. */
export function materialTaxFor(
  org: { material_tax_pct?: number | null; material_tax_by_zip?: unknown } | null | undefined,
  zip: string | null | undefined,
): { rate: number; known: boolean; place?: string } {
  const map = zipTaxMap(org?.material_tax_by_zip);
  const e = zip ? map[zip] : undefined;
  if (e) return { rate: e.rate, known: true, place: e.place };
  return { rate: Number(org?.material_tax_pct) || 0, known: false };
}

/** Pull {rate, place} out of the model's reply (JSON somewhere in the text). */
export function parseRateReply(text: string): { rate: number; place?: string } | null {
  const m = text.match(/\{[^{}]*"rate"[^{}]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { rate?: unknown; place?: unknown };
    const rate = typeof j.rate === "number" ? j.rate : parseFloat(String(j.rate));
    if (!isFinite(rate) || rate < 0 || rate > MAX_SANE_RATE) return null;
    return { rate: Math.round(rate * 1000) / 1000, place: typeof j.place === "string" ? j.place.slice(0, 60) : undefined };
  } catch { return null; }
}
