/**
 * QuickBooks Online CSV export — PURE builders (no I/O). The API route
 * (/api/export/quickbooks) loads the rows and calls buildQuickBooksExport.
 * Totals come straight from job.total / payments.amount / receipts.amount —
 * no pricing or profit math here.
 */
import { parseEntryDate } from "./dates";

export interface QbJob {
  id: string; client?: string | null; property?: string | null; job_date?: string | null;
  created_at?: string | null; total?: number | string | null; status?: string | null;
  archived?: boolean | null; rooms?: unknown; customer_id?: string | null; title?: string | null;
}
export interface QbPayment {
  job_id: string; amount: number | string; kind?: string | null;
  stripe_session_id?: string | null; created_at?: string | null;
}
export interface QbReceipt { job_id?: string | null; note?: string | null; amount?: number | string | null; receipt_date?: string | null; created_at?: string | null }
export interface QbCustomer {
  id: string; name?: string | null; primary_contact?: string | null; type?: string | null;
  email?: string | null; phone?: string | null;
  street?: string | null; city?: string | null; state?: string | null; zip?: string | null;
}
export interface QbRange { from?: string | null; to?: string | null }

const INVOICED = new Set(["complete", "invoiced", "paid"]);

export function csvField(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function csvLine(vals: unknown[]): string { return vals.map(csvField).join(","); }
function csv(header: string[], rows: unknown[][]): string {
  return [csvLine(header), ...rows.map(csvLine)].join("\r\n") + "\r\n";
}
export function money(n: unknown): string {
  const x = Math.round((Number(n) || 0) * 100) / 100;
  return (x === 0 ? 0 : x).toFixed(2);
}
const p2 = (n: number) => String(n).padStart(2, "0");
/** MM/DD/YYYY from any date string the app stores (local parse). */
export function qbDate(raw?: string | null): string {
  const d = parseEntryDate(raw);
  return d ? `${p2(d.getMonth() + 1)}/${p2(d.getDate())}/${d.getFullYear()}` : "";
}
function dayKey(raw?: string | null): number | null {
  const d = parseEntryDate(raw);
  return d ? d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate() : null;
}
export function inQbRange(raw: string | null | undefined, range: QbRange): boolean {
  const k = dayKey(raw);
  if (k == null) return !range.from && !range.to;
  const f = range.from ? dayKey(range.from) : null;
  const t = range.to ? dayKey(range.to) : null;
  return (f == null || k >= f) && (t == null || k <= t);
}

function jobNumber(j: QbJob): string {
  let r: unknown = j.rooms;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch { r = null; } }
  const n = r && typeof r === "object" ? (r as { jobNumber?: unknown }).jobNumber : "";
  if (typeof n === "string" && n.trim()) return n.trim();
  return String(j.id || "").replace(/-/g, "").slice(0, 8).toUpperCase();
}
const jobDate = (j: QbJob) => j.job_date || j.created_at || "";
function description(j: QbJob): string {
  return (j.title || j.property || "Services").toString().trim() || "Services";
}

export function invoiceJobs(jobs: QbJob[], range: QbRange): QbJob[] {
  return jobs.filter((j) => !j.archived && INVOICED.has(String(j.status)) && inQbRange(jobDate(j), range));
}

export function buildInvoicesCsv(jobs: QbJob[], range: QbRange): string {
  const rows = invoiceJobs(jobs, range).map((j) => {
    const d = qbDate(jobDate(j));
    return [jobNumber(j), j.client || "", d, d, description(j), money(j.total)];
  });
  return csv(["InvoiceNo", "Customer", "InvoiceDate", "DueDate", "ItemDescription", "ItemAmount"], rows);
}

export function paymentMethod(p: QbPayment): string {
  const sid = String(p.stripe_session_id || "");
  const kind = String(p.kind || "");
  if (kind === "refund" || sid.startsWith("refund_")) return "refund";
  if (sid.startsWith("manual_")) return ["cash", "check", "card", "other"].includes(kind) ? kind : "other";
  if (sid) return "card (online)";
  return kind || "other";
}

export function buildPaymentsCsv(payments: QbPayment[], jobs: QbJob[], range: QbRange): string {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const rows = payments
    .filter((p) => inQbRange(p.created_at, range))
    .map((p) => {
      const j = byId.get(p.job_id);
      return [qbDate(p.created_at), j?.client || "", j ? jobNumber(j) : "", money(p.amount), paymentMethod(p), p.stripe_session_id || ""];
    });
  return csv(["Date", "Customer", "InvoiceNo", "Amount", "Method", "Reference"], rows);
}

/** receiptNote format: "Vendor — item, item (+N more)". */
export function parseVendor(note?: string | null): { vendor: string; description: string } {
  const s = (note || "").trim();
  const i = s.indexOf(" — ");
  if (i > 0) return { vendor: s.slice(0, i).trim() || "Receipt", description: s.slice(i + 3).trim() };
  return { vendor: "Receipt", description: s };
}

export function buildExpensesCsv(receipts: QbReceipt[], range: QbRange): string {
  const rows = receipts
    .filter((r) => inQbRange(r.receipt_date || r.created_at, range))
    .map((r) => {
      const { vendor, description: desc } = parseVendor(r.note);
      return [qbDate(r.receipt_date || r.created_at), vendor, desc, money(r.amount)];
    });
  return csv(["Date", "Vendor", "Description", "Amount"], rows);
}

export function buildCustomersCsv(customers: QbCustomer[], jobs: QbJob[], range: QbRange): string {
  const allTime = !range.from && !range.to;
  const used = new Set<string>();
  const usedNames = new Set<string>();
  for (const j of invoiceJobs(jobs, range)) {
    if (j.customer_id) used.add(j.customer_id);
    if (j.client) usedNames.add(j.client.trim().toLowerCase());
  }
  const seen = new Set<string>();
  const rows: unknown[][] = [];
  for (const c of customers) {
    const name = (c.name || "").trim();
    if (!name) continue;
    if (!allTime && !used.has(c.id) && !usedNames.has(name.toLowerCase())) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const company = c.type && c.type !== "individual" ? name : "";
    rows.push([name, company, c.email || "", c.phone || "", c.street || "", c.city || "", c.state || "", c.zip || ""]);
  }
  return csv(["Name", "Company", "Email", "Phone", "Street", "City", "State", "Zip"], rows);
}

export function buildQuickBooksExport(
  data: { jobs: QbJob[]; payments: QbPayment[]; receipts: QbReceipt[]; customers: QbCustomer[] },
  range: QbRange,
) {
  return {
    invoices: buildInvoicesCsv(data.jobs, range),
    payments: buildPaymentsCsv(data.payments, data.jobs, range),
    expenses: buildExpensesCsv(data.receipts, range),
    customers: buildCustomersCsv(data.customers, data.jobs, range),
  };
}
