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
export type ReceiptScan = { vendor: string; items: ReceiptItem[]; total: number };

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
  const itemSum = items.reduce((s, it) => s + (typeof it.price === "number" && it.price > 0 ? it.price : 0), 0);
  const total = typeof data?.total === "number" && data.total > 0 ? data.total : itemSum;
  return { vendor, items, total: Math.round(total * 100) / 100 };
}

/** "Home Depot — 2x4 stud, Drywall screws (+3 more)" */
export function receiptNote(scan: ReceiptScan): string {
  const summary = scan.items.filter((it) => it?.name).slice(0, 4).map((it) => it.name).join(", ");
  const more = scan.items.length > 4 ? ` (+${scan.items.length - 4} more)` : "";
  return (scan.vendor ? `${scan.vendor}${summary ? ` — ${summary}${more}` : ""}` : `${summary}${more}`).trim();
}

/** Write each priced item to price_corrections so the quoting AI learns real
 *  supply costs (ZIP-tagged so same-area pricing wins). Returns the count. */
export async function learnFromReceipt(
  scan: ReceiptScan,
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
      corrected_mat_cost: Number(it.price),
      original_hours: 0,
      corrected_hours: 0,
      trade,
      zip,
    }));
  for (const entry of logs) await db.post("price_corrections", entry);
  return logs.length;
}
