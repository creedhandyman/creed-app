/**
 * Per-customer material specs (docs/claude/customer-material-specs.md).
 *
 * A commercial client can hand over a list of required products (Shaw
 * Infinium carpet tile, Roppe 4" base, Behr Marquee Satin…). When a job's
 * customer has an active spec:
 *   1. `specPromptBlock` tells the quoting AI to use those exact products,
 *   2. `applySpec` (deterministic, after the AI) matches every material on
 *      every line to a spec item, takes the spec name + price, rounds the
 *      quantity up to how it is sold, and adds companion items.
 * Anything that matches nothing is left exactly as it was (the normal shop
 * list / receipts / generic pricing flow).
 *
 * Field meanings (columns of material_spec_items):
 *   unit         the SELLING unit: "coil", "gal", "box", "ea"
 *   unit_price   cost per selling unit, before markup; null = not on file
 *   pack_size    how many measure units one selling unit holds (120 → a
 *                120 ft coil); pack_label is its display text ("120 ft coil")
 *   coverage     what one selling unit covers (350 sqft per gal, 24 sqft per
 *                box); coverage_unit is that measure unit ("sqft")
 *   companions   [{ name, qty, per, item_id? }]: add `qty` of the companion
 *                for every `per` measure units (or selling units) of this one
 *
 * Pure: no Supabase, no React. Tested in src/__tests__/material-spec.test.ts.
 */
import type { Material, MaterialSpecTag } from "./types";
import { rankByRequest } from "./quote-grounding";

export interface SpecCompanion {
  name: string;
  /** Companion selling units added per `per` units of the parent. */
  qty: number;
  /** Parent amount (measure units, or selling units when it has no
   *  coverage/pack size) that needs `qty` of the companion. */
  per: number;
  /** Another item of the same spec, to take its name + price. */
  item_id?: string;
  /** Price per selling unit when the companion is not a spec item. */
  unit_price?: number | null;
}

export interface SpecItem {
  id: string;
  spec_id?: string;
  trade?: string | null;
  category?: string | null;
  name: string;
  brand?: string | null;
  model?: string | null;
  sku?: string | null;
  store?: string | null;
  unit?: string | null;
  unit_price?: number | null;
  pack_size?: number | null;
  pack_label?: string | null;
  coverage?: number | null;
  coverage_unit?: string | null;
  keywords?: string[];
  companions?: SpecCompanion[];
  notes?: string | null;
  sort?: number;
}

/** The tag lives in types.ts (Material.spec); stored on the saved quote, so
 *  editing the spec later never changes a quote already sent. */
export type { MaterialSpecTag };

const r2 = (n: number) => Math.round(n * 100) / 100;

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const toStr = (v: unknown): string | null => {
  if (typeof v !== "string") return typeof v === "number" ? String(v) : null;
  const s = v.trim();
  return s ? s : null;
};

/** Coerce a row from Supabase (numerics arrive as strings, companions as
 *  JSON) into a SpecItem. Rows without an id or a name are dropped. */
export function normalizeSpecItems(rows: unknown): SpecItem[] {
  if (!Array.isArray(rows)) return [];
  const out: SpecItem[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = toStr(r.id);
    const name = toStr(r.name);
    if (!id || !name) continue;
    const pos = (v: unknown) => { const n = toNum(v); return n !== null && n > 0 ? n : null; };
    const price = toNum(r.unit_price);
    let companions: unknown = r.companions;
    if (typeof companions === "string") { try { companions = JSON.parse(companions); } catch { companions = []; } }
    out.push({
      id,
      spec_id: toStr(r.spec_id) || undefined,
      trade: toStr(r.trade),
      category: toStr(r.category),
      name,
      brand: toStr(r.brand),
      model: toStr(r.model),
      sku: toStr(r.sku),
      store: toStr(r.store),
      unit: toStr(r.unit),
      unit_price: price !== null && price >= 0 ? price : null,
      pack_size: pos(r.pack_size),
      pack_label: toStr(r.pack_label),
      coverage: pos(r.coverage),
      coverage_unit: toStr(r.coverage_unit),
      keywords: Array.isArray(r.keywords) ? r.keywords.map(toStr).filter((k): k is string => !!k) : [],
      companions: normalizeCompanions(companions),
      notes: toStr(r.notes),
      sort: toNum(r.sort) ?? 0,
    });
  }
  return out.sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

export function normalizeCompanions(v: unknown): SpecCompanion[] {
  if (!Array.isArray(v)) return [];
  const out: SpecCompanion[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const name = toStr(c.name);
    const qty = toNum(c.qty);
    const per = toNum(c.per);
    if (!name || !(qty && qty > 0) || !(per && per > 0)) continue;
    const price = toNum(c.unit_price);
    out.push({
      name, qty, per,
      ...(toStr(c.item_id) ? { item_id: toStr(c.item_id)! } : {}),
      ...(price !== null && price >= 0 ? { unit_price: price } : {}),
    });
  }
  return out;
}

/* ── names ─────────────────────────────────────────────────────────────── */

const norm = (s: string | null | undefined) =>
  (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** "Roppe" + "4in wall base, charcoal" + "700" → "Roppe 4in wall base,
 *  charcoal 700". Brand / model are added only when the name doesn't
 *  already say them. */
export function specProductName(it: Pick<SpecItem, "name" | "brand" | "model">): string {
  let s = it.name.trim();
  const has = (part: string) => ` ${norm(s)} `.includes(` ${norm(part)} `);
  if (it.brand && !has(it.brand)) s = `${it.brand.trim()} ${s}`;
  if (it.model && !has(it.model)) s = `${s} ${it.model.trim()}`;
  return s;
}

/** The name a quote line shows: the product, plus how it's sold. */
export function specDisplayName(it: SpecItem): string {
  const base = specProductName(it);
  return it.pack_label && !norm(base).includes(norm(it.pack_label)) ? `${base} (${it.pack_label.trim()})` : base;
}

/* ── units ─────────────────────────────────────────────────────────────── */

const UNIT_ALIASES: Array<[RegExp, string]> = [
  [/^(sq\s*ft|sqft|sf|square\s*f(oo|ee)?t|ft2)$/, "sqft"],
  [/^(lf|lin\s*ft|linear\s*f(oo|ee)?t|ft|feet|foot)$/, "ft"],
  [/^(gal|gals|gallon|gallons)$/, "gal"],
  [/^(ea|each|pc|pcs|piece|pieces|unit|units)$/, "ea"],
  [/^(qt|qts|quart|quarts)$/, "qt"],
  [/^(bx|box|boxes|carton|cartons|ctn)$/, "box"],
  [/^(roll|rolls|coil|coils)$/, "roll"],
  [/^(pail|pails|bucket|buckets)$/, "pail"],
  [/^(tube|tubes)$/, "tube"],
];

/** "Sq Ft" → "sqft", "linear feet" → "ft", "gallons" → "gal". Unknown
 *  units come back lowercased. */
export function normUnit(u: string | null | undefined): string {
  const s = (u || "").toLowerCase().replace(/[.]/g, "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  for (const [re, v] of UNIT_ALIASES) if (re.test(s)) return v;
  return s;
}

/** The measure unit of a spec item: coverage_unit, else the unit word in
 *  its pack label ("120 ft coil" → "ft"). */
function measureUnit(it: SpecItem): string {
  if (it.coverage_unit) return normUnit(it.coverage_unit.replace(/^(per\s+)/i, "").split(/\s+per\s+/i)[0]);
  if (it.pack_label) {
    for (const w of it.pack_label.toLowerCase().split(/[^a-z0-9.]+/)) {
      const u = normUnit(w);
      if (u === "ft" || u === "sqft" || u === "gal" || u === "qt") return u;
    }
  }
  return "";
}

/** Measure units per selling unit (coverage wins over pack size). */
function perSellingUnit(it: SpecItem): number | null {
  return it.coverage || it.pack_size || null;
}

/**
 * Turn a material's quantity into whole selling units.
 * `u` is the unit the AI gave the quantity in. In the item's measure unit
 * (150 "ft" of a 120 ft coil) it is converted; otherwise the quantity is
 * already selling units (1.25 coils, 2.3 gal) and is rounded up.
 * Returns the selling units and the amount in measure units (for companions).
 */
export function toSellingUnits(qty: number, u: string | undefined, it: SpecItem): { units: number; measure: number | null } {
  const q = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const per = perSellingUnit(it);
  const mu = measureUnit(it);
  const given = normUnit(u);
  const sell = normUnit(it.unit);
  if (per && given && mu && given === mu && given !== sell) {
    return { units: Math.max(1, Math.ceil(q / per - 1e-9)), measure: q };
  }
  const units = Math.max(1, Math.ceil(q - 1e-9));
  return { units, measure: per ? units * per : null };
}

/* ── matching ──────────────────────────────────────────────────────────── */

const STOP = new Set(["and", "the", "for", "with", "per", "each", "inch", "in", "ft", "x"]);
const words = (s: string) => norm(s).split(" ").filter((w) => w.length >= 2 && !STOP.has(w));

/**
 * The spec item a material name refers to, or null. In order:
 *   1. its model number appears in the name (≥3 chars, has a digit or is
 *      the whole name) — "Elan F51A" finds the Schlage Elan item;
 *   2. the name equals / contains the item's product name (with or without
 *      brand) — what the AI writes when it follows the prompt;
 *   3. one of the owner's keywords (≥4 chars) appears in the name;
 *   4. word overlap: ≥2 shared words AND ≥70% of the item's name words, so
 *      ONE shared common word ("drill", "paint") is never enough.
 * Ties go to the earlier item in the spec.
 */
export function matchSpecItem(materialName: string, items: SpecItem[]): SpecItem | null {
  const name = norm(materialName);
  if (!name || !items.length) return null;
  const padded = ` ${name} `;
  const has = (part: string) => { const p = norm(part); return !!p && padded.includes(` ${p} `); };
  let best: { it: SpecItem; score: number } | null = null;
  const consider = (it: SpecItem, score: number) => { if (!best || score > best.score) best = { it, score }; };
  const nameWords = new Set(words(materialName));
  for (const it of items) {
    if (it.model && norm(it.model).length >= 3 && /\d/.test(it.model) && has(it.model)) { consider(it, 100); continue; }
    const product = norm(specProductName(it));
    const plain = norm(it.name);
    if (name === product || name === plain || name === norm(specDisplayName(it))) { consider(it, 90); continue; }
    if ((product.length >= 6 && padded.includes(` ${product} `)) || (plain.length >= 6 && padded.includes(` ${plain} `))) {
      consider(it, 80 + Math.min(9, plain.length / 10));
      continue;
    }
    if ((it.keywords || []).some((k) => norm(k).length >= 4 && has(k))) { consider(it, 60); continue; }
    const iw = Array.from(new Set(words(`${it.brand || ""} ${it.name}`)));
    if (iw.length) {
      const shared = iw.filter((w) => nameWords.has(w)).length;
      if (shared >= 2 && shared / iw.length >= 0.7) consider(it, 40 + shared);
    }
  }
  return (best as { it: SpecItem; score: number } | null)?.it ?? null;
}

/* ── applying a spec to a quote ────────────────────────────────────────── */

type SpecMaterial = Material & { spec?: MaterialSpecTag; u?: string };
interface RoomLike { name: string; items: Array<{ materials: Material[] }> }

export interface SpecApplyStats {
  /** Materials looked at (companions not counted). */
  materials: number;
  /** Of those, matched to a spec item. */
  matched: number;
  companionsAdded: number;
  /** Display names of matched items with no price on the spec. */
  priceNeeded: string[];
}

/** The tag a quote material carries for a spec item. */
export function specTag(it: SpecItem, extra: Partial<MaterialSpecTag> = {}): MaterialSpecTag {
  return {
    itemId: it.id,
    ...(it.brand ? { brand: it.brand } : {}),
    ...(it.model ? { model: it.model } : {}),
    ...(it.unit_price == null ? { priceNeeded: true } : {}),
    ...extra,
  };
}

/** One material → its spec version (or itself, unchanged, when nothing matches). */
function specMaterial(m: SpecMaterial, items: SpecItem[]): { mat: SpecMaterial; item: SpecItem | null; measure: number | null } {
  const byId = m.spec?.itemId ? items.find((i) => i.id === m.spec!.itemId) : undefined;
  const it = byId || matchSpecItem(m.n || "", items);
  if (!it) return { mat: m, item: null, measure: null };
  const qtyIn = typeof m.qty === "number" && m.qty > 0 ? m.qty : 1;
  const { units, measure } = toSellingUnits(qtyIn, m.u, it);
  // Price per selling unit: the spec's; else what the AI/shop priced it at,
  // re-expressed per selling unit so a converted quantity keeps the total sane.
  let unitPrice: number;
  if (it.unit_price != null) unitPrice = it.unit_price;
  else if (typeof m.unitPrice === "number" && m.unitPrice >= 0 && units === qtyIn) unitPrice = m.unitPrice;
  else unitPrice = r2((Number(m.c) || 0) / units);
  const { u: _u, ...rest } = m;
  void _u;
  return {
    mat: { ...rest, n: specDisplayName(it), qty: units, unitPrice: r2(unitPrice), c: r2(units * unitPrice), spec: specTag(it, m.spec?.companionOf ? { companionOf: m.spec.companionOf } : {}) },
    item: it,
    measure,
  };
}

/** Companion materials for one matched spec material. */
function companionsFor(parent: SpecItem, sellingUnits: number, measure: number | null, items: SpecItem[]): SpecMaterial[] {
  const out: SpecMaterial[] = [];
  for (const c of parent.companions || []) {
    const amount = measure ?? sellingUnits;
    const qty = Math.max(1, Math.ceil(amount / c.per - 1e-9)) * c.qty;
    const ref = (c.item_id && items.find((i) => i.id === c.item_id)) || matchSpecItem(c.name, items.filter((i) => i.id !== parent.id));
    if (ref) {
      const units = Math.max(1, Math.ceil(qty - 1e-9));
      const price = ref.unit_price ?? c.unit_price ?? 0;
      out.push({
        n: specDisplayName(ref), qty: units, unitPrice: r2(price), c: r2(units * price),
        spec: specTag(ref, { companionOf: parent.id, ...(ref.unit_price == null && c.unit_price == null ? { priceNeeded: true } : { priceNeeded: undefined }) }),
      });
    } else {
      const units = Math.max(1, Math.ceil(qty - 1e-9));
      const price = c.unit_price ?? 0;
      out.push({
        n: c.name, qty: units, unitPrice: r2(price), c: r2(units * price),
        spec: { itemId: `${parent.id}:${norm(c.name)}`, companionOf: parent.id, ...(c.unit_price == null ? { priceNeeded: true } : {}) },
      });
    }
  }
  // JSON-clean: drop explicit undefined flags.
  return out.map((m) => ({ ...m, spec: JSON.parse(JSON.stringify(m.spec)) }));
}

/**
 * Apply a customer's spec to quote rooms. Pure and idempotent (running it
 * twice changes nothing more). Materials that match nothing are untouched.
 * Companions are added to the same line, once: a companion already on the
 * line (added before, or written by the AI) is replaced with the computed
 * quantity, never doubled.
 */
export function applySpec<R extends RoomLike>(rooms: R[], items: SpecItem[]): { rooms: R[]; stats: SpecApplyStats } {
  const stats: SpecApplyStats = { materials: 0, matched: 0, companionsAdded: 0, priceNeeded: [] };
  if (!items.length) return { rooms, stats };
  const needed = new Set<string>();
  const outRooms = rooms.map((room) => ({
    ...room,
    items: room.items.map((line) => {
      const mats = (line.materials || []) as SpecMaterial[];
      // Companions we add are recomputed from their parents each run.
      const own = mats.filter((m) => !m.spec?.companionOf);
      const next: SpecMaterial[] = [];
      const companions: SpecMaterial[] = [];
      for (const m of own) {
        stats.materials += 1;
        const { mat, item, measure } = specMaterial(m, items);
        next.push(mat);
        if (!item) continue;
        stats.matched += 1;
        if (item.unit_price == null) needed.add(specDisplayName(item));
        companions.push(...companionsFor(item, mat.qty || 1, measure, items));
      }
      // A companion the AI wrote itself (it matched a spec item that is also
      // a computed companion) gives way to the computed one.
      const compIds = new Set(companions.map((c) => c.spec!.itemId));
      const kept = next.filter((m) => !(m.spec && compIds.has(m.spec.itemId) && companions.length));
      // Merge companions of the same item across parents on this line.
      const merged = new Map<string, SpecMaterial>();
      for (const c of companions) {
        const k = c.spec!.itemId;
        const prev = merged.get(k);
        if (prev) {
          const qty = (prev.qty || 0) + (c.qty || 0);
          merged.set(k, { ...prev, qty, c: r2(qty * (prev.unitPrice || 0)) });
        } else merged.set(k, c);
      }
      const before = new Set(mats.filter((m) => m.spec?.companionOf).map((m) => m.spec!.itemId));
      for (const k of merged.keys()) if (!before.has(k)) stats.companionsAdded += 1;
      return { ...line, materials: [...kept, ...merged.values()] as Material[] };
    }),
  })) as R[];
  stats.priceNeeded = Array.from(needed);
  return { rooms: outRooms, stats };
}

/** "18 of 20 materials match Grid's spec" style counts for a built quote. */
export function specMatchCount(rooms: RoomLike[]): { matched: number; total: number } {
  let matched = 0, total = 0;
  for (const r of rooms) for (const it of r.items) for (const m of (it.materials || []) as SpecMaterial[]) {
    if (m.spec?.companionOf) continue;
    if (!m.n || /^(materials|misc materials)$/i.test(m.n.trim())) continue;
    total += 1;
    if (m.spec?.itemId) matched += 1;
  }
  return { matched, total };
}

/** Spec items whose name / brand / model / category / keywords contain
 *  every word typed (for the Materials sheet's type-ahead). */
export function searchSpec(items: SpecItem[], query: string, limit = 5): SpecItem[] {
  const ws = norm(query).split(" ").filter(Boolean);
  if (!ws.length) return [];
  return items
    .filter((it) => {
      const hay = ` ${norm(`${specDisplayName(it)} ${it.category || ""} ${(it.keywords || []).join(" ")}`)} `;
      return ws.every((w) => hay.includes(` ${w}`));
    })
    .slice(0, limit);
}

/* ── the prompt block ──────────────────────────────────────────────────── */

const SEND_ALL_MAX = 150;

/** Which spec items to show the AI: all of a small spec; for a big one, the
 *  items worded like the request plus every item in their categories. */
export function specItemsForRequest(items: SpecItem[], request: string): SpecItem[] {
  if (items.length <= SEND_ALL_MAX) return items;
  const hits = rankByRequest(items, (i) => `${i.category || ""} ${i.name} ${(i.keywords || []).join(" ")}`, request, 80, 0.5);
  const cats = new Set(hits.map((i) => norm(i.category)).filter(Boolean));
  const picked = new Set(hits.map((i) => i.id));
  for (const i of items) if (picked.size < SEND_ALL_MAX && cats.has(norm(i.category))) picked.add(i.id);
  return items.filter((i) => picked.has(i.id));
}

const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

/**
 * The CLIENT MATERIAL SPEC system block. Empty string when there is no spec.
 * It goes BEFORE the shop prices so the AI reaches for the spec first.
 */
export function specPromptBlock(items: SpecItem[], request: string, customerName?: string): string {
  const picked = specItemsForRequest(items, request);
  if (!picked.length) return "";
  const who = (customerName || "").trim() || "This client";
  const lines = picked.map((it) => {
    const bits: string[] = [];
    const unit = (it.unit || "").trim() || "ea";
    bits.push(it.unit_price != null ? `${money(it.unit_price)}/${unit}` : `price? per ${unit}`);
    if (it.coverage) bits.push(`1 ${unit} covers ${it.coverage} ${it.coverage_unit || ""}`.trim());
    else if (it.pack_size) bits.push(`1 ${unit} = ${it.pack_size}${it.pack_label ? ` (${it.pack_label})` : ""}`);
    if (it.category || it.trade) bits.push(String(it.category || it.trade));
    if ((it.companions || []).length) bits.push(`+ companions added automatically`);
    return `- ${specDisplayName(it)} | ${bits.join(" | ")}`;
  });
  return (
    `\nCLIENT MATERIAL SPEC — ${who} requires these exact products. Any line that uses a material of one of these kinds ` +
    `MUST use the spec product: put its name in "n" exactly as listed, and do not substitute another brand or a generic item. ` +
    `Give "qty" in the unit shown (e.g. 2 gal, 3 box), or in feet / square feet with "u" (e.g. {"n": "...", "qty": 150, "u": "ft"}) ` +
    `and it will be rounded up to how it is sold. Use the listed price as unitPrice; for "price?" estimate it. ` +
    `Companion items (adhesive, tubes…) are added automatically — do not add them yourself. ` +
    `Materials this list does not cover follow the normal rules below.\n${lines.join("\n")}\n\n`
  );
}

/** Short notes for the "Check before you send" card after a spec was applied. */
export function specNotes(stats: SpecApplyStats, customerName?: string): string[] {
  if (!stats.materials && !stats.matched) return [];
  const who = (customerName || "").trim() || "the client";
  const notes = [`Client spec: ${stats.matched} of ${stats.materials} materials use ${who}'s spec products${stats.companionsAdded ? ` (+${stats.companionsAdded} companion item${stats.companionsAdded === 1 ? "" : "s"})` : ""}.`];
  if (stats.priceNeeded.length) {
    notes.push(`No price on the spec for: ${stats.priceNeeded.slice(0, 6).join(", ")}${stats.priceNeeded.length > 6 ? "…" : ""}. The cost shown is an estimate — check it.`);
  }
  return notes;
}
