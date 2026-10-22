/**
 * Receipt AI scan — shared by the review sheet (ReceiptScanSheet) and the
 * offline upload queue (a receipt snapped with no signal is scanned when it
 * finally uploads).
 *
 * The receipt's GRAND TOTAL (incl. tax) is what was spent; the sum of item
 * prices is only a fallback when the total couldn't be read.
 */
import { apiFetch } from "./api";
import { db } from "./supabase";
import { extractZip } from "./parser";

export type ReceiptItem = { name?: string; qty?: number; price?: number };
export type ReceiptScan = {
  vendor: string;
  items: ReceiptItem[];
  total: number;
  /** transaction date printed on the receipt, "YYYY-MM-DD" ("" if unread) */
  date: string;
  /** sales-tax portion if the receipt listed one, else 0 */
  tax: number;
};

/** Sum of line prices (discounts/returns are negative lines and subtract). */
export function itemSum(items: ReceiptItem[]): number {
  const s = items.reduce((acc, it) => acc + (typeof it?.price === "number" ? it.price : 0), 0);
  return Math.round(s * 100) / 100;
}

/**
 * Cross-check the scan's arithmetic: items + tax should land on the total.
 * Returns the expected sum when it's off by more than $1 (so the sheet can
 * warn "double-check the total"), or null when it reconciles / can't be
 * checked (no items, or no independent total to compare against).
 */
export function scanMismatch(scan: Pick<ReceiptScan, "items" | "tax" | "total">): number | null {
  if (!scan.items.length || !(scan.total > 0)) return null;
  const expected = Math.round((itemSum(scan.items) + (scan.tax > 0 ? scan.tax : 0)) * 100) / 100;
  if (expected <= 0) return null;
  return Math.abs(expected - scan.total) > 1 ? expected : null;
}

/** Per-UNIT price of a line (the scan's `price` is the line total). */
export function unitPrice(it: ReceiptItem): number {
  const p = typeof it.price === "number" ? it.price : 0;
  const q = typeof it.qty === "number" && it.qty > 1 ? it.qty : 1;
  return Math.round((p / q) * 100) / 100;
}

/** "2026-10-18" when valid, else "". */
function cleanScanDate(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const d = new Date(`${s}T12:00:00`);
  if (isNaN(d.getTime())) return "";
  // A receipt can't be from the future (misread year); allow a day of slack.
  if (d.getTime() > Date.now() + 86_400_000) return "";
  return s;
}

/** Scan one receipt (all pages together). Throws with the server's message on failure. */
export async function scanReceipt(urls: string[]): Promise<ReceiptScan> {
  const res = await apiFetch("/api/ai/receipt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrls: urls }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || res.statusText || "scan failed");
  }
  const { data } = await res.json();
  const vendor = (data?.vendor as string | undefined)?.trim() || "";
  const items = (Array.isArray(data?.items) ? data.items : []) as ReceiptItem[];
  const sum = itemSum(items);
  const total = typeof data?.total === "number" && data.total > 0 ? data.total : sum > 0 ? sum : 0;
  const tax = typeof data?.tax === "number" && data.tax > 0 ? Math.round(data.tax * 100) / 100 : 0;
  return { vendor, items, total: Math.round(total * 100) / 100, date: cleanScanDate(data?.date), tax };
}

/** "Home Depot — 2x4 stud, Drywall screws (+3 more)" */
export function receiptNote(scan: Pick<ReceiptScan, "vendor" | "items">): string {
  const summary = scan.items.filter((it) => it?.name).slice(0, 4).map((it) => it.name).join(", ");
  const more = scan.items.length > 4 ? ` (+${scan.items.length - 4} more)` : "";
  return (scan.vendor ? `${scan.vendor}${summary ? ` — ${summary}${more}` : ""}` : `${summary}${more}`).trim();
}

/** Write each priced item to price_corrections so the quoting AI learns real
 *  supply costs (ZIP-tagged so same-area pricing wins). Costs are per UNIT —
 *  "10 × 2x4 … $35.00" teaches $3.50, not $35. Returns the count. */
export async function learnFromReceipt(
  scan: Pick<ReceiptScan, "vendor" | "items">,
  job: { property?: string | null; trade?: string | null },
): Promise<number> {
  const trade = job.trade || "General";
  const zip = extractZip(job.property || "");
  const logs = scan.items
    .filter((it) => it?.name && typeof it.price === "number" && it.price > 0)
    .map((it) => ({
      item_name: it.name!.slice(0, 120),
      material_name: (scan.vendor ? `${scan.vendor}: ${it.name}` : it.name!).slice(0, 160),
      original_mat_cost: 0,
      corrected_mat_cost: unitPrice(it),
      original_hours: 0,
      corrected_hours: 0,
      trade,
      zip,
    }));
  for (const entry of logs) await db.post("price_corrections", entry);
  return logs.length;
}
