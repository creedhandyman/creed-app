/**
 * A scanned receipt → the material log (docs/claude/shipped-systems.md
 * "Store purchase prices", receipt scans). Pure; tested in
 * src/__tests__/receipt-lines.test.ts. Used by the server route
 * /api/receipts/log-items (it does the writes) and by learnFromReceipt.
 *
 * In:  the receipt scan (vendor, date, items: printed name, plain product
 *      name, store item number, qty, LINE total).
 * Out: purchase lines (lib/purchase-import.ts rules: returns, fees, snacks
 *      and tools told apart) → rows for material_price_history (every bought
 *      line, price paid per unit) and material_prices (newest price per
 *      product, materials only).
 */
import {
  cleanPurchaseLines, currentPriceRow, historyRows, newestPerProduct, normStore, parseDate, planPriceChanges,
  type PurchaseLine, type StoredPrice,
} from "./purchase-import";

export interface ScannedItem {
  /** As printed on the receipt ("2X4X8 SPF #2"). */
  name?: string;
  /** Plain product name when the scan could tell ("2 in. x 4 in. x 8 ft. SPF stud"). */
  product?: string;
  /** The store's item / SKU number as printed. */
  sku?: string;
  qty?: number;
  /** LINE total (negative for a return / discount). */
  price?: number;
}

/** Stores whose receipts are material purchases. A gas station or lunch
 *  receipt is an expense, never a material price. */
const SUPPLY_STORE_RE = /home\s*depot|lowe'?s|menards|sherwin|ace\s*hardware|true\s*value|harbor\s*freight|floor\s*&?\s*(and\s*)?decor|ferguson|\b(supply|supplies|lumber|hardware|paints?|building|plumbing|electric(al)?|flooring|tile|roofing|drywall|millwork)\b/i;

export function isSupplyStore(vendor: unknown): boolean {
  return SUPPLY_STORE_RE.test(String(vendor ?? ""));
}

const squash = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, "") === b.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The store's item number, digits and letters only as printed; "" when the
 *  scan gave none (or gave junk like "N/A"). */
export function cleanSku(v: unknown): string {
  const s = squash(v).replace(/^(sku|item|#|no\.?)\s*[:#]?\s*/i, "");
  if (!s || !/\d/.test(s) || /^(n\/?a|none|null|0+)$/i.test(s)) return "";
  return s.slice(0, 40);
}

/** "Plain name (AS PRINTED)" — the plain name leads so people and the quote
 *  matcher can read it; the printed code stays so the receipt can be found. */
export function receiptDescription(it: ScannedItem): string {
  const printed = squash(it.name);
  const plain = squash(it.product);
  if (!plain) return printed;
  if (!printed || same(plain, printed)) return plain;
  return `${plain} (${printed})`.slice(0, 240);
}

const MAX_STORED_ITEMS = 300;

/**
 * The item list as it is kept on the receipt row (receipts.items), so the
 * receipt can be opened again later. Also the way to READ that column: never
 * throws, [] for anything that isn't a list. Keeps every line that has a name
 * or a price (returns and discount lines too: this is what the receipt said,
 * not what a quote may learn from).
 */
export function storedItems(raw: unknown): ScannedItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ScannedItem[] = [];
  for (const r of raw.slice(0, MAX_STORED_ITEMS)) {
    if (!r || typeof r !== "object") continue;
    const it = r as Record<string, unknown>;
    const name = squash(it.name).slice(0, 160);
    const product = squash(it.product).slice(0, 160);
    const price = typeof it.price === "number" && Number.isFinite(it.price) ? Math.round(it.price * 100) / 100 : undefined;
    if (!name && !product && price === undefined) continue;
    const qty = typeof it.qty === "number" && Number.isFinite(it.qty) && it.qty > 0 ? it.qty : undefined;
    const sku = cleanSku(it.sku);
    out.push({
      ...(name ? { name } : {}),
      ...(product ? { product } : {}),
      ...(sku ? { sku } : {}),
      ...(qty !== undefined ? { qty } : {}),
      ...(price !== undefined ? { price } : {}),
    });
  }
  return out;
}

/** Every line of a scanned receipt as a purchase line (classified). */
export function receiptPurchaseLines(
  scan: { vendor?: string | null; date?: string | null; items?: ScannedItem[] | null },
  opts: { job?: string | null } = {},
): PurchaseLine[] {
  const items = Array.isArray(scan.items) ? scan.items : [];
  const raw = items
    .filter((it) => it && typeof it.price === "number" && Number.isFinite(it.price) && it.price !== 0)
    .map((it) => {
      const qty = typeof it.qty === "number" && Number.isFinite(it.qty) && it.qty > 0 ? it.qty : 1;
      return {
        description: receiptDescription(it),
        sku: cleanSku(it.sku) || null,
        qty,
        total: it.price,
        job: opts.job || null,
      };
    });
  return cleanPurchaseLines(raw, "Receipt scan", {
    date: parseDate(scan.date),
    store: normStore(scan.vendor),
  });
}

/** Per-unit price a quote may learn from: materials only (no tools, fees,
 *  snacks, returns or discount lines). */
export function learnableItems(scan: { vendor?: string | null; items?: ScannedItem[] | null }): PurchaseLine[] {
  return receiptPurchaseLines(scan).filter((l) => l.kind === "item");
}

export interface ReceiptLog {
  /** material_price_history rows: every bought line (materials and tools). */
  history: Record<string, unknown>[];
  /** Products whose newest price this receipt has (to look up what's on file). */
  keys: string[];
  /** material_prices rows to upsert, given what's on file. */
  prices: (stored: StoredPrice[]) => Record<string, unknown>[];
  skipped: { returns: number; fees: number };
}

/**
 * What a scanned receipt writes. Tools go in the history (marked
 * department "TOOLS") but never become a material price; returns, discount
 * lines, fees and snacks are left out. A receipt older than the price on
 * file never replaces it (planPriceChanges).
 */
export function receiptLog(lines: PurchaseLine[], orgId: string): ReceiptLog {
  const bought = lines.filter((l) => l.kind === "item" || l.kind === "tool")
    .map((l) => (l.kind === "tool" && !l.department ? { ...l, department: "TOOLS" } : l));
  const newest = newestPerProduct(bought.filter((l) => l.kind === "item"));
  return {
    history: historyRows(bought, orgId),
    keys: Array.from(newest.keys()),
    prices: (stored) => planPriceChanges(newest, stored)
      .filter((c) => c.action === "new" || c.action === "update")
      .map((c) => currentPriceRow(c, orgId)),
    skipped: {
      returns: lines.filter((l) => l.kind === "return").length,
      fees: lines.filter((l) => l.kind === "fee").length,
    },
  };
}
