import type { Job, Room, JobDiscount } from "./types";
import { exportQuotePdf } from "./export-pdf";
import { quoteApprovalFromJob } from "./approval";
import { readBlob } from "./job-blob";
import { pricingInputs } from "./pricing";

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
    const d = data?.discount;
    if (d && (d.type === "percent" || d.type === "fixed") && typeof d.value === "number" && d.value > 0) {
      discount = { type: d.type, value: d.value, label: typeof d.label === "string" ? d.label : undefined };
    }
    if (typeof data?.laborRate === "number" && data.laborRate > 0) {
      laborRateOverride = data.laborRate;
    }
    if (typeof data?.minLaborHours === "number" && data.minLaborHours >= 0) {
      minLaborHoursOverride = data.minLaborHours;
    }
    const tm = data?.taxMode;
    if (tm === "total" || tm === "materials" || tm === "none") {
      taxModeOverride = tm;
    }
    tieredQuote = data?.tieredQuote === true;
    if (typeof data?.materialTaxPct === "number" && data.materialTaxPct > 0) materialTaxPct = data.materialTaxPct;
    if (typeof data?.crewSize === "number" && data.crewSize > 0) crewSize = Math.round(data.crewSize);
    if (typeof data?.estDays === "number" && data.estDays > 0) estDays = data.estDays;
    const tn = data?.tierNames;
    if (tn && (typeof tn.better === "string" || typeof tn.best === "string")) {
      tierNames = {
        better: typeof tn.better === "string" && tn.better.trim() ? tn.better : "Better",
        best: typeof tn.best === "string" && tn.best.trim() ? tn.best : "Best",
      };
    }
  } catch {
    /* malformed rooms — render with defaults */
  }

  // Rate, floor, tax mode, trip fee… resolve exactly as QuoteForge's preview
  // and the AI lead draft do — one shared function (lib/pricing.ts).
  const p = pricingInputs(org, { laborRate: laborRateOverride, minLaborHours: minLaborHoursOverride, taxMode: taxModeOverride });

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
