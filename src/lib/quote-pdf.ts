import type { Job, Room, JobDiscount } from "./types";
import { exportQuotePdf } from "./export-pdf";

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
  markup_pct?: number;
  tax_pct?: number;
  tax_mode?: string;
  trip_fee?: number;
  min_labor_hours?: number;
  brand_color?: string;
  brand_color_2?: string;
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
  try {
    const data = typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms;
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
  } catch {
    /* malformed rooms — render with defaults */
  }

  // Resolve the effective floor: per-quote override → org default → 1.
  const orgMin = org?.min_labor_hours;
  const effectiveMinLaborHours =
    minLaborHoursOverride !== null
      ? minLaborHoursOverride
      : (typeof orgMin === "number" && orgMin >= 0 ? orgMin : 1);
  // Resolve tax-mode: per-quote override → org default → "total" (legacy).
  const orgTaxMode = org?.tax_mode;
  const effectiveTaxMode: "total" | "materials" | "none" =
    taxModeOverride ??
    (orgTaxMode === "materials" || orgTaxMode === "none" || orgTaxMode === "total"
      ? orgTaxMode
      : "total");

  exportQuotePdf({
    property: job.property,
    client: job.client,
    rooms,
    rate: laborRateOverride || org?.default_rate || 55,
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
    orgPhone: org?.phone,
    orgEmail: org?.email,
    orgLicense: org?.license_num,
    orgAddress: org?.address,
    orgLogo: org?.logo_url,
    photos,
    markupPct: org?.markup_pct,
    taxPct: org?.tax_pct,
    tripFee: org?.trip_fee,
    discount,
    minLaborHours: effectiveMinLaborHours,
    taxMode: effectiveTaxMode,
    statusUrl: typeof window !== "undefined" ? `${window.location.origin}/status?job=${job.id}` : "",
  });
}
