import type { Job, Room, JobDiscount } from "./types";
import { exportQuotePdf } from "./export-pdf";
import { quoteApprovalFromJob } from "./approval";
import { readBlob } from "./job-blob";
import { pricingInputs, type PricedRates } from "./pricing";
import { readQuoteSettings, readSentTier, readPricedRates } from "./quote-blob";
import { itemInTier } from "./tiers";

/**
 * The subset of Organization fields the quote PDF needs. Both the full
 * `Organization` and the portal's trimmed `PortalOrg` satisfy this, so the
 * same builder serves the customer portal (Documents) and the public
 * status page (Download PDF).
 */
export interface QuotePdfOrg {
  name?: string;
  phone?: string;
  email?: string;
  logo_url?: string;
  address?: string;
  license_num?: string;
  default_rate?: number;
  /** JSON string: { "Plumbing": 65, ... } — per-trade labor rates. */
  trade_rates?: string;
  markup_pct?: number;
  tax_pct?: number;
  tax_mode?: string;
  trip_fee?: number;
  min_labor_hours?: number;
  brand_color?: string;
  brand_color_2?: string;
  deposit_pct?: number;
  quote_valid_days?: number;
  quote_terms?: string;
}

/**
 * Build + open the customer-facing quote PDF for a job — the identical
 * estimate the contractor sends. Parses the per-quote overrides (discount,
 * laborRate, minLaborHours, taxMode) off the job's `rooms` JSON blob,
 * resolves them against the org defaults, and hands everything to
 * exportQuotePdf (which recomputes the totals from rooms × rate so a stale
 * saved total never leaks in). Shared so the portal and status page can't
 * drift apart on pricing.
 */
export function openJobQuotePdf(job: Job, org: QuotePdfOrg | null) {
  let rooms: Room[] = [];
  let workers: { id: string; name: string }[] = [];
  let photos: { url: string; label: string; type: string }[] = [];
  let discount: JobDiscount | null = null;
  let laborRateOverride: number | null = null;
  let minLaborHoursOverride: number | null = null;
  let taxModeOverride: "total" | "materials" | "none" | null = null;
  // Sales tax paid buying materials, as priced into this quote when it was
  // saved. Quotes saved before the setting existed carry none (= 0), so their
  // PDF still matches their saved total.
  let materialTaxPct = 0;
  let tieredQuote = false;
  let crewSize: number | null = null;
  let estDays: number | null = null;
  let tierNames: { better: string; best: string } | undefined;
  let priced: PricedRates | null = null;
  try {
    const data = readBlob(job.rooms);
    rooms = (data?.rooms || []) as Room[];
    workers = (data?.workers || []).map((w: { id?: string; name?: string }) => ({
      id: w.id || "",
      name: w.name || "",
    }));
    photos = (data?.photos || []).map((p: { url?: string; label?: string; type?: string }) => ({
      url: p.url || "",
      label: p.label || "",
      type: p.type || "",
    }));
    // The per-quote settings, validated by the one shared reader (quote-blob.ts).
    const q = readQuoteSettings(data);
    discount = q.discount;
    laborRateOverride = q.laborRate;
    minLaborHoursOverride = q.minLaborHours;
    // The rates it was priced with, so a later rate change can't reprice it.
    const today = pricingInputs(org, { minLaborHours: q.minLaborHours });
    priced = readPricedRates(data, { totalLabor: job.total_labor, minHrs: today.minHrs, defaultRate: today.defaultRate, tradeRates: today.tradeRates });
    taxModeOverride = q.taxMode;
    tieredQuote = q.tieredQuote;
    // Only the rate this quote was priced with; none (or 0) = no purchase tax.
    materialTaxPct = q.materialTax && q.materialTax.pct > 0 ? q.materialTax.pct : 0;
    crewSize = q.crewSize;
    estDays = q.estDays;
    tierNames = q.tierNames;
    // Sent as ONE tier and not yet signed: the customer's PDF is that tier
    // alone, one price, like their quote page (a signed quote prints as
    // before — export-pdf marks the accepted tier).
    const sent = readSentTier(data);
    const at = data?.acceptedTier;
    if (sent && at !== "base" && at !== "better" && at !== "best") {
      rooms = rooms
        .map((r) => ({ ...r, items: (r.items || []).filter((it) => itemInTier(it, sent)) }))
        .filter((r) => r.items.length > 0);
      tieredQuote = false;
    }
  } catch {
    /* malformed rooms — render with defaults */
  }

  // Rate, floor, tax mode, trip fee… resolve exactly as QuoteForge's preview
  // and the AI lead draft do — one shared function (lib/pricing.ts).
  const p = pricingInputs(org, { laborRate: laborRateOverride, minLaborHours: minLaborHoursOverride, taxMode: taxModeOverride, priced });

  exportQuotePdf({
    property: job.property,
    client: job.client,
    rooms,
    rate: p.rate,
    // Per-trade rates only when no per-quote override (QuoteForge's getRateForRoom precedence).
    tradeRates: laborRateOverride ? undefined : (p.tradeRates ?? undefined),
    workers,
    grandTotal: job.total || 0,
    totalLabor: job.total_labor || 0,
    totalMat: job.total_mat || 0,
    totalHrs: job.total_hrs || 0,
    trade: job.trade,
    jobId: job.id,
    orgName: org?.name,
    accent: org?.brand_color,
    accent2: org?.brand_color_2,
    depositPct: org?.deposit_pct,
    quoteValidDays: org?.quote_valid_days,
    quoteTerms: org?.quote_terms,
    tieredQuote,
    tierNames,
    crewSize,
    estDays,
    orgPhone: org?.phone,
    orgEmail: org?.email,
    orgLicense: org?.license_num,
    orgAddress: org?.address,
    orgLogo: org?.logo_url,
    photos,
    markupPct: p.markupPct,
    materialTaxPct,
    taxPct: p.taxPct,
    tripFee: p.tripFee,
    discount,
    minLaborHours: p.minHrs,
    taxMode: p.taxMode,
    statusUrl: typeof window !== "undefined" ? `${window.location.origin}/status?job=${job.id}` : "",
    // A signed quote prints the customer's signature (unless revised since).
    approval: quoteApprovalFromJob(job),
  });
}
