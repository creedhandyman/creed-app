/**
 * Store purchase price import (docs/claude/shipped-systems.md "Store purchase
 * prices"). Pure; tested in src/__tests__/purchase-import.test.ts.
 *
 * In:  a Home Depot Pro "Purchase Tracking" item export (CSV / XLSX), any
 *      item-level purchase sheet with recognizable headers, or the AI's read
 *      of a receipt PDF / photo (cleanPurchaseLines).
 * Out: purchase lines → the NEWEST price per product (productKey) → a plan:
 *      which org prices are new / updated / unchanged / older than what's on
 *      file, and which customer spec items match (SKU → model → brand + name)
 *      and would get a refreshed unit_price. Nothing here writes anything.
 *
 * Real-file facts (checked on Bernard's exports, 2026-11-18):
 *  - HD item export: a 6-row preamble, then the header. "Unit Price" is
 *    EMPTY; "Net Unit Price" is really the line total BEFORE discount and
 *    "Extended Retail (before discount)" is the line total AFTER discount
 *    (17.96 − 1.80 = 16.16). Price per unit paid = Extended Retail ÷ Quantity.
 *    Returns are negative. "Job Name" is the job / PO.
 *  - HD "transaction" export and the Lowe's Pro export list ORDERS (totals,
 *    no items) — no product prices to learn; we say so instead of guessing.
 */

export type LineKind = "item" | "return" | "fee" | "tool";

export interface PurchaseLine {
  /** YYYY-MM-DD, or null when the source has no date. */
  date: string | null;
  store: string | null;
  sku: string | null;
  model: string | null;
  description: string;
  qty: number;
  /** Price paid per unit (after discounts), never negative. */
  unit_price: number;
  /** Line total as the source states it (negative for returns). */
  total: number | null;
  job: string | null;
  po: string | null;
  department: string | null;
  kind: LineKind;
  /** File name it came from. */
  source: string;
  /** 0-based position in its file (stable hash for re-imports). */
  index: number;
}

export type PurchaseFormat = "hd-items" | "items" | "orders" | "unknown";

/* ── small parsers ─────────────────────────────────────────────────────── */

/** "$1,234.50", "-$150.65", "- $3.40", "(12.00)", 8 → number; junk → null. */
export function parseMoney(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim();
  if (!s || /^(n\/?a|-+|—)$/i.test(s)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^-/.test(s.replace(/\s+/g, ""))) neg = true;
  const m = s.replace(/[,\s]/g, "").match(/\d+(\.\d+)?|\.\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
};

/** 2026-07-03 · 07/03/2026 · 7/3/26 · 31-Mar-2026 · Mar 31, 2026 · Excel serial → YYYY-MM-DD. */
export function parseDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (m) return ymd(+m[3], +m[1], +m[2]);
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,4})[a-z]*[-\s,]+(\d{2,4})\b/);
  if (m && MONTHS[m[2].toLowerCase()]) return ymd(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = s.match(/^([A-Za-z]{3,4})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && MONTHS[m[1].toLowerCase()]) return ymd(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    // Excel serial date (days since 1899-12-30).
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return null;
}

/** "The Home Depot", "HD", "Lowe's #1547" → canonical store name. */
export function normStore(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/home\s*depot|^hd\b|^thd\b/i.test(s)) return "Home Depot";
  if (/lowe'?s/i.test(s)) return "Lowe's";
  if (/menards/i.test(s)) return "Menards";
  if (/sherwin/i.test(s)) return "Sherwin-Williams";
  return s.slice(0, 60);
}

const clean = (v: unknown, max = 200): string | null => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s && !/^(n\/a|none|null|0)$/i.test(s) ? s.slice(0, max) : null;
};
/** SKU / model compare form: letters and digits only, upper case. */
export const normCode = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/* ── what a line is ────────────────────────────────────────────────────── */

const FEE_RE = /\b(delivery|deliver|fee|fees|protection\s*plan|hdpp|haul\s*away|bag\s*fee|sales\s*tax|recycling|core\s*charge|deposit|gift\s*card|rental|rent)\b/i;
/** Snacks and drinks bought on a store run — never materials. */
const FOOD_RE = /\b(powerade|gatorade|mountain\s*dew|monster|red\s*bull|coke|pepsi|sprite|soda|bottled\s*water|water\s*bottle|coffee|energy\s*drink|candy|snacks?|chips|jerky|gum|sandwich)\b/i;
/** A tools department / class ("TOOLS", "TOOLS/SAFETY") — but not
 *  "TOOLS & ACCESSORIES" or "POWER TOOL ACCESSORIES", where HD files wire
 *  connectors and bits. */
const TOOL_DEPT_RE = /\btools?\b(?![^/]*accessor)/i;
const TOOL_DESC_RE = /\b(drill|driver|impact\s*driver|saw|sander|grinder|router|multi-?tool|oscillating|nail\s*gun|nailer|stapler|wrench|pliers|screwdriver|hammer|level|tape\s*measure|utility\s*knife|shop\s*vac|wet\/dry|ladder|step\s*stool|tool\s*(bag|box|belt)|charger|coverall|gloves?|safety\s*glasses|respirator|knee\s*pads?|taping\s*knife|joint\s*knife|putty\s*knife|pencils?)\b/i;
/** Consumables that share a tool's word but ARE materials (bits, blades…). */
const CONSUMABLE_RE = /\b(bits?|blades?|sanding\s*(discs?|sheets?|sponges?)|sandpaper|abrasive|anchors?|screws?|nails|staples|caulk)\b/i;

/** Returns, fees and tools are kept out of material prices by default. */
export function classifyLine(l: { qty: number; total: number | null; unit_price: number; description: string; department?: string | null }): LineKind {
  if (l.qty < 0 || (l.total ?? 0) < 0) return "return";
  if (!(l.unit_price > 0) || FEE_RE.test(l.description) || FOOD_RE.test(l.description)) return "fee";
  if (CONSUMABLE_RE.test(l.description)) return "item";
  if (l.department && TOOL_DEPT_RE.test(l.department)) return "tool";
  if (TOOL_DESC_RE.test(l.description)) return "tool";
  return "item";
}

/* ── sheets ────────────────────────────────────────────────────────────── */

type Field = "date" | "store" | "sku" | "model" | "internet" | "description" | "qty" | "unit_price"
  | "ext_after" | "ext_before" | "total" | "job" | "po" | "department" | "class";

const HEADERS: Array<[Field, RegExp]> = [
  ["ext_after", /^extended\s*retail(\s*\(before\s*discount\))?$/],
  ["ext_before", /^net\s*unit\s*price$/],
  ["unit_price", /^(unit\s*price|price\s*each|each|unit\s*cost|price|cost|item\s*price|sale\s*price)$/],
  ["total", /^(total|line\s*total|extended(\s*price)?|ext\.?\s*price|amount|line\s*amount|item\s*total)$/],
  ["qty", /^(qty|quantity|qty\.?\s*(ordered|purchased)?|units?)$/],
  ["description", /^(sku\s*description|item\s*description|description|product|product\s*name|item\s*name|item)$/],
  ["internet", /^(internet\s*(sku|#|number|no)|online\s*(#|number))$/],
  ["model", /^(model|model\s*(#|no\.?|number)|mfr\.?\s*(part|model)\s*(#|no)?|manufacturer\s*part\s*(#|number))$/],
  ["sku", /^(sku|sku\s*(number|#|no\.?)|item\s*(#|no\.?|number)|store\s*sku|article)$/],
  ["date", /^(date|purchase\s*date|order\s*date|transaction\s*date|invoice\s*date)$/],
  ["store", /^(store|store\s*name|retailer|vendor|supplier|purchased\s*from|store\s*location)$/],
  ["job", /^(job|job\s*name|project|project\s*name)$/],
  ["po", /^(po|po\s*(#|number|no\.?)|purchase\s*order)$/],
  ["department", /^(department|department\s*name|dept)$/],
  ["class", /^(class|class\s*name)$/],
];

export function purchaseHeaderField(cell: string): Field | null {
  const h = (cell || "").toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").replace(/[:]$/, "").trim();
  if (!h) return null;
  for (const [f, re] of HEADERS) if (re.test(h)) return f;
  return null;
}

/** Headers that mark an ORDER-level export (no items). */
const ORDER_RE = /^(order\s*total|total\s*amount\s*paid|pre-?tax\s*amount|order\s*#\s*\/\s*trans\.?\s*#|fulfillment\s*type)$/i;

/**
 * Find the header row (within the first 20 rows — HD puts a 6-row preamble
 * first) and say what kind of export this is.
 */
export function detectPurchaseSheet(rows: string[][]): {
  format: PurchaseFormat; header: number; map: Partial<Record<Field, number>>; store: string | null;
} {
  // A preamble line like "Source,Purchase Tracking" means Home Depot Pro.
  const pre = rows.slice(0, 8).map((r) => r.join(" ")).join(" ");
  const preStore = /purchase\s*tracking|home\s*depot/i.test(pre) ? "Home Depot" : /lowe'?s/i.test(pre) ? "Lowe's" : null;
  for (let h = 0; h < Math.min(20, rows.length); h++) {
    const map: Partial<Record<Field, number>> = {};
    rows[h].forEach((cell, i) => { const f = purchaseHeaderField(cell); if (f && map[f] === undefined) map[f] = i; });
    const hasPrice = map.unit_price !== undefined || map.ext_after !== undefined || map.total !== undefined;
    if (map.description !== undefined && hasPrice) {
      const hd = map.ext_after !== undefined && map.ext_before !== undefined;
      return { format: hd ? "hd-items" : "items", header: h, map, store: hd ? "Home Depot" : preStore };
    }
    if (rows[h].some((c) => ORDER_RE.test((c || "").trim()))) {
      const lowes = rows[h].some((c) => /fulfillment|purchased\s*from|cc\s*type/i.test(c || ""));
      return { format: "orders", header: h, map, store: lowes ? "Lowe's" : preStore };
    }
  }
  return { format: "unknown", header: -1, map: {}, store: preStore };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A sheet → purchase lines (every line, classified). */
export function sheetToPurchases(rows: string[][], source: string): {
  format: PurchaseFormat; lines: PurchaseLine[]; store: string | null;
} {
  const det = detectPurchaseSheet(rows);
  if (det.format !== "hd-items" && det.format !== "items") return { format: det.format, lines: [], store: det.store };
  const { map } = det;
  const at = (r: string[], f: Field) => (map[f] === undefined ? "" : r[map[f]!] ?? "");
  const lines: PurchaseLine[] = [];
  rows.slice(det.header + 1).forEach((r, i) => {
    const description = clean(at(r, "description"), 240);
    if (!description) return;
    const qtyRaw = parseMoney(at(r, "qty"));
    const qty = qtyRaw === null || qtyRaw === 0 ? 1 : qtyRaw;
    let total: number | null;
    let unit: number | null;
    if (det.format === "hd-items") {
      // See the header comment: Extended Retail (before discount) is what was paid.
      total = parseMoney(at(r, "ext_after"));
      const listed = parseMoney(at(r, "unit_price"));
      unit = total !== null ? total / qty : listed;
    } else {
      total = parseMoney(at(r, "total"));
      const listed = parseMoney(at(r, "unit_price"));
      unit = listed !== null ? listed : total !== null ? total / qty : null;
    }
    if (unit === null) return;
    const department = clean([at(r, "department"), at(r, "class")].filter(Boolean).join(" / "), 120);
    const sku = clean(at(r, "sku"), 40);
    const internet = clean(at(r, "internet"), 40);
    const base = {
      date: parseDate(at(r, "date")),
      store: normStore(at(r, "store")) || det.store,
      sku,
      model: clean(at(r, "model"), 60) || internet,
      description,
      qty,
      unit_price: round2(Math.abs(unit)),
      total: total === null ? null : round2(total),
      job: clean(at(r, "job"), 80),
      po: clean(at(r, "po"), 80),
      department,
      source,
      index: i,
    };
    lines.push({ ...base, kind: classifyLine(base) });
  });
  return { format: det.format, lines, store: det.store };
}

/** The AI's read of a receipt / invoice → purchase lines (same validation). */
export function cleanPurchaseLines(input: unknown, source: string, fallback: { date?: string | null; store?: string | null } = {}): PurchaseLine[] {
  if (!Array.isArray(input)) return [];
  const out: PurchaseLine[] = [];
  input.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") return;
    const r = raw as Record<string, unknown>;
    const description = clean(r.description ?? r.name, 240);
    if (!description) return;
    const qtyRaw = parseMoney(r.qty ?? r.quantity);
    const qty = qtyRaw === null || qtyRaw === 0 ? 1 : qtyRaw;
    const total = parseMoney(r.total);
    const listed = parseMoney(r.unit_price ?? r.price);
    const unit = listed !== null ? listed : total !== null ? total / qty : null;
    if (unit === null) return;
    const base = {
      date: parseDate(r.date) || fallback.date || null,
      store: normStore(r.store) || fallback.store || null,
      sku: clean(r.sku, 40),
      model: clean(r.model, 60),
      description,
      qty,
      unit_price: round2(Math.abs(unit)),
      total: total === null ? null : round2(total),
      job: clean(r.job, 80),
      po: clean(r.po, 80),
      department: clean(r.department, 120),
      source,
      index: i,
    };
    out.push({ ...base, kind: classifyLine(base) });
  });
  return out;
}

/* ── products and newest prices ────────────────────────────────────────── */

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();

/** One product = store + SKU (else model, else the description's words). */
export function productKey(l: Pick<PurchaseLine, "store" | "sku" | "model" | "description">): string {
  const store = (l.store || "any").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (l.sku && normCode(l.sku)) return `${store}:sku:${normCode(l.sku)}`;
  if (l.model && normCode(l.model)) return `${store}:model:${normCode(l.model)}`;
  return `${store}:desc:${words(l.description).slice(0, 120)}`;
}

/** Newest line per product among `lines` (later date wins; same date → the
 *  later line in the file). Lines without a date lose to dated ones. */
export function newestPerProduct(lines: PurchaseLine[]): Map<string, PurchaseLine> {
  const out = new Map<string, PurchaseLine>();
  for (const l of lines) {
    const k = productKey(l);
    const cur = out.get(k);
    if (!cur || isNewer(l, cur)) out.set(k, l);
  }
  return out;
}

function isNewer(a: { date: string | null; index: number; source?: string }, b: { date: string | null; index: number; source?: string }): boolean {
  const da = a.date || "", db = b.date || "";
  if (da !== db) return da > db;
  // HD lists newest first; within one day a later row is no newer, so the
  // first one seen stays unless sources differ (then the later file wins).
  return a.source !== b.source;
}

/** A price already on file for a product (material_prices row). */
export interface StoredPrice {
  product_key: string;
  unit_price: number;
  purchased_on: string | null;
}

export type ChangeAction = "new" | "update" | "same" | "older";

export interface PriceChange {
  key: string;
  line: PurchaseLine;
  old: StoredPrice | null;
  action: ChangeAction;
}

/** Compare each product's newest line with what's on file. Only "new" and
 *  "update" are written; "older" (the file is older than the price we have)
 *  and "same" are shown and left alone. */
export function planPriceChanges(newest: Map<string, PurchaseLine>, stored: StoredPrice[]): PriceChange[] {
  const byKey = new Map(stored.map((s) => [s.product_key, s]));
  const out: PriceChange[] = [];
  newest.forEach((line, key) => {
    const old = byKey.get(key) || null;
    let action: ChangeAction = "new";
    if (old) {
      const oldDate = old.purchased_on || "";
      const newDate = line.date || "";
      // An undated line never replaces a dated price; an earlier one never does.
      if (oldDate && (!newDate || newDate < oldDate)) action = "older";
      else if (round2(old.unit_price) === line.unit_price) action = "same";
      else action = "update";
    }
    out.push({ key, line, old, action });
  });
  const rank: Record<ChangeAction, number> = { update: 0, new: 1, same: 2, older: 3 };
  return out.sort((a, b) => rank[a.action] - rank[b.action] || a.line.description.localeCompare(b.line.description));
}

/* ── customer spec matches ─────────────────────────────────────────────── */

/** The spec item fields matching needs (+ who it belongs to, for review). */
export interface SpecPriceTarget {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  sku: string | null;
  store: string | null;
  unit: string | null;
  unit_price: number | null;
  price_updated_at: string | null;
  spec_name?: string;
  customer_name?: string;
}

export interface SpecMatch {
  item: SpecPriceTarget;
  line: PurchaseLine;
  by: "sku" | "model" | "name";
  /** The line is older than the spec item's current price date. */
  older: boolean;
  same: boolean;
}

const STOP = new Set(["the", "and", "with", "for", "in", "of", "a", "an", "ft", "in.", "ft.", "x", "pack", "pk", "ea", "each", "per"]);
const contentWords = (s: string) => words(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+(\.\d+)?$/.test(w));

/** Does a spec's "store" rule this purchase out? (Spec says Sherwin-Williams,
 *  receipt is Home Depot.) An unknown store on either side never does. */
function storeConflict(spec: string | null, line: string | null): boolean {
  const a = normStore(spec), b = normStore(line);
  return !!a && !!b && a.toLowerCase() !== b.toLowerCase();
}

/** Is `code` (a model / SKU, ≥4 chars with a digit) a whole token of `text`? */
function codeIn(code: string, text: string): boolean {
  const c = normCode(code);
  if (c.length < 4 || !/\d/.test(c)) return false;
  return text.toUpperCase().split(/[^A-Z0-9-]+/).some((tok) => normCode(tok) === c);
}

/**
 * The best purchase line for one spec item: SKU, then model number, then
 * brand + name (the brand in the description AND ≥2 of the spec name's
 * words covering ≥70% of them — one shared word like "drill" never matches).
 */
export function matchLineForSpec(item: SpecPriceTarget, lines: PurchaseLine[]): { line: PurchaseLine; by: SpecMatch["by"] } | null {
  const pool = lines.filter((l) => l.kind === "item" && !storeConflict(item.store, l.store));
  const newestFirst = (xs: PurchaseLine[]) => xs.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (item.sku && normCode(item.sku)) {
    const hit = newestFirst(pool.filter((l) => (l.sku && normCode(l.sku) === normCode(item.sku)) || (l.model && normCode(l.model) === normCode(item.sku))));
    if (hit.length) return { line: hit[0], by: "sku" };
  }
  if (item.model && normCode(item.model)) {
    const hit = newestFirst(pool.filter((l) =>
      (l.model && normCode(l.model) === normCode(item.model)) || codeIn(item.model!, l.description)));
    if (hit.length) return { line: hit[0], by: "model" };
  }
  if (item.brand) {
    const brand = words(item.brand);
    const need = Array.from(new Set(contentWords(item.name)));
    if (brand && need.length >= 2) {
      const hit = newestFirst(pool.filter((l) => {
        const desc = ` ${words(l.description)} `;
        if (!desc.includes(` ${brand} `)) return false;
        const have = new Set(contentWords(l.description));
        const shared = need.filter((w) => have.has(w) || have.has(w.replace(/s$/, "")) || have.has(`${w}s`)).length;
        return shared >= 2 && shared / need.length >= 0.7;
      }));
      if (hit.length) return { line: hit[0], by: "name" };
    }
  }
  return null;
}

/** Every spec item that matches a purchase line. Items with no match are
 *  left out entirely — they are never touched. */
export function matchSpecItems(items: SpecPriceTarget[], lines: PurchaseLine[]): SpecMatch[] {
  const out: SpecMatch[] = [];
  for (const item of items) {
    const m = matchLineForSpec(item, lines);
    if (!m) continue;
    const curDate = (item.price_updated_at || "").slice(0, 10);
    const older = !!curDate && !!m.line.date && m.line.date < curDate;
    const same = item.unit_price !== null && round2(item.unit_price) === m.line.unit_price;
    out.push({ item, line: m.line, by: m.by, older, same });
  }
  return out;
}

/* ── rows to write ─────────────────────────────────────────────────────── */

/** A stable id for one purchase line, so importing the same purchases twice
 *  (the same file again, or two exports whose date ranges overlap) adds no
 *  duplicate history (unique per org in the DB). The file name and row
 *  number are NOT part of it; `occurrence` tells identical lines of one
 *  receipt apart (HD lists 3 identical coveralls as 3 rows). */
export function lineHash(l: PurchaseLine, occurrence = 0): string {
  const s = [l.store, l.date, normCode(l.sku), normCode(l.model), words(l.description), l.qty, l.unit_price, l.total, l.job, l.po, occurrence].join("|");
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/** History rows for a batch: identical lines get occurrence 0, 1, 2… so a
 *  repeated row is kept, while re-importing the same batch matches. */
export function historyRows(lines: PurchaseLine[], orgId: string): Record<string, unknown>[] {
  // Count repeats per FILE, then drop rows another file already gave (two
  // exports covering the same days).
  const seen = new Map<string, number>();
  const out = new Map<string, Record<string, unknown>>();
  for (const l of lines) {
    const base = `${l.source}|${lineHash(l)}`;
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    const row = historyRow(l, orgId, n);
    if (!out.has(row.line_hash as string)) out.set(row.line_hash as string, row);
  }
  return Array.from(out.values());
}

export function historyRow(l: PurchaseLine, orgId: string, occurrence = 0): Record<string, unknown> {
  return {
    org_id: orgId,
    product_key: productKey(l),
    line_hash: lineHash(l, occurrence),
    store: l.store,
    sku: l.sku,
    model: l.model,
    description: l.description,
    qty: l.qty,
    unit_price: l.unit_price,
    total: l.total,
    purchased_on: l.date,
    job_ref: l.job,
    po: l.po,
    department: l.department,
    source: l.source.slice(0, 160),
  };
}

export function currentPriceRow(c: PriceChange, orgId: string): Record<string, unknown> {
  const l = c.line;
  return {
    org_id: orgId,
    product_key: c.key,
    store: l.store,
    sku: l.sku,
    model: l.model,
    description: l.description,
    unit_price: l.unit_price,
    purchased_on: l.date,
    job_ref: l.job || l.po,
    source: l.source.slice(0, 160),
    updated_at: new Date().toISOString(),
  };
}

/** The spec item patch for an accepted match. */
export function specPricePatch(m: SpecMatch, nowIso = new Date().toISOString()): Record<string, unknown> {
  const l = m.line;
  return {
    unit_price: l.unit_price,
    price_updated_at: l.date ? `${l.date}T12:00:00Z` : nowIso,
    price_source: `${l.store || "Store"} ${l.date || ""} · ${l.source}`.replace(/\s+/g, " ").trim().slice(0, 200),
    updated_at: nowIso,
  };
}

/* ── the AI read of receipts / invoices ───────────────────────────────── */

export const PURCHASE_EXTRACT_PROMPT = `You read a contractor's store RECEIPT, INVOICE or PURCHASE HISTORY (Home Depot, Lowe's, a supply house) and list every purchased line item.

Return ONLY JSON: {"store": "...", "date": "YYYY-MM-DD", "items": [ ... ], "notes": ["..."]}
Each item:
{
  "date": "YYYY-MM-DD" if this line has its own date, else null (the top-level date applies),
  "store": the store if it differs from the top-level one, else null,
  "sku": the store's item / SKU number exactly as printed, else null,
  "model": the manufacturer model number if printed, else null,
  "description": the item description as printed (expand obvious receipt abbreviations only if you are sure),
  "qty": quantity bought (negative for a returned item),
  "unit_price": price paid PER UNIT after any line discount,
  "total": the line total as printed (negative for returns),
  "job": job name if printed, else null,
  "po": PO number if printed, else null
}

Rules:
- NEVER invent a SKU, model, price or date. Use null when it is not printed.
- One entry per printed line item. Skip subtotals, tax, totals, payment and change lines.
- Fees (delivery, bag fee, protection plan) may be listed; they are filtered later.
- If a line's quantity is like "3 @ 4.98", qty is 3 and unit_price is 4.98.
- Put anything unreadable or doubtful in notes.`;
