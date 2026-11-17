/**
 * Turning a client's material spec into reviewable items
 * (docs/claude/customer-material-specs.md). Pure; tested in
 * src/__tests__/spec-import.test.ts.
 *
 * Three ways in, one shape out (SpecDraft, an item with no id yet):
 *   - CSV / Excel rows → `rowsToDrafts`: when the header row is recognizable
 *     the columns map straight across (no AI); otherwise `mapped` is false and
 *     the caller sends the rows to the AI as text.
 *   - PDF / pasted text → /api/specs/extract → the AI's JSON → `cleanDrafts`.
 * Everything goes through `cleanDrafts`, so the review screen always gets the
 * same validated fields. A price is never invented here: no price = null.
 */
import { normalizeCompanions, type SpecCompanion } from "./material-spec";

export interface SpecDraft {
  name: string;
  brand: string | null;
  model: string | null;
  sku: string | null;
  store: string | null;
  trade: string | null;
  category: string | null;
  unit: string | null;
  unit_price: number | null;
  pack_size: number | null;
  pack_label: string | null;
  coverage: number | null;
  coverage_unit: string | null;
  keywords: string[];
  companions: SpecCompanion[];
  notes: string | null;
}

export const SPEC_FIELDS: Array<keyof SpecDraft> = [
  "name", "brand", "model", "sku", "store", "trade", "category", "unit", "unit_price",
  "pack_size", "pack_label", "coverage", "coverage_unit", "keywords", "notes",
];

/** Max items one import keeps (a spec book bigger than this is split). */
export const MAX_IMPORT_ITEMS = 500;

/* ── CSV ───────────────────────────────────────────────────────────────── */

/** RFC-4180-ish CSV: quoted fields, "" escapes, commas/newlines in quotes,
 *  CRLF. Tabs are used as the separator when the first line has tabs and no
 *  commas (a paste from a spreadsheet). Blank rows are dropped. */
export function parseCsv(text: string): string[][] {
  const src = (text || "").replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] || "";
  const sep = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") { quoted = true; continue; }
    if (ch === sep) { row.push(field); field = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

/* ── header mapping ────────────────────────────────────────────────────── */

const HEADER_RULES: Array<[keyof SpecDraft, RegExp]> = [
  ["unit_price", /^(unit\s*)?(price|cost)(\s*(each|ea|per\s*unit|\(\$\)|\$))?$|^(\$|price\s*\$|cost\s*\$|unit\s*cost|our\s*cost)$/],
  ["pack_label", /^(pack|package|packaging|sold\s*as|sold\s*by|pack\s*label)$/],
  ["pack_size", /^(pack\s*size|qty\s*per\s*(pack|unit|box)|units?\s*per\s*(pack|box)|per\s*(pack|box|coil|roll))$/],
  ["coverage_unit", /^(coverage\s*unit|covers\s*unit)$/],
  ["coverage", /^(coverage|covers|sq\s*ft\s*per|sqft\s*per\s*(box|gal|unit))$/],
  ["model", /^(model|model\s*(#|no|number)|style|style\s*(#|no)|color\s*\/?\s*model|item\s*(#|no))$/],
  ["sku", /^(sku|sku\s*(#|no)|part\s*(#|no|number)|store\s*sku|item\s*number|internet\s*(#|no))$/],
  ["brand", /^(brand|manufacturer|mfr|mfg|make|vendor\s*brand)$/],
  ["store", /^(store|supplier|vendor|source|where\s*to\s*buy|retailer)$/],
  ["trade", /^(trade)$/],
  ["category", /^(category|type|class|division|area|section|spec\s*section)$/],
  ["unit", /^(unit|uom|unit\s*of\s*measure|sold\s*per|per)$/],
  ["keywords", /^(keywords?|also\s*called|aliases?|match\s*words?)$/],
  ["notes", /^(notes?|comments?|remarks?|description\s*notes)$/],
  ["name", /^(name|item|item\s*name|product|product\s*name|description|material|spec|specification)$/],
];

/** Header cell → field, or null. */
export function headerField(cell: string): keyof SpecDraft | null {
  const h = (cell || "").toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").replace(/[:.]$/, "").trim();
  if (!h) return null;
  for (const [field, re] of HEADER_RULES) if (re.test(h)) return field;
  return null;
}

/** Column index → field for a header row. Each field is used once (first
 *  column wins). */
export function mapHeaders(header: string[]): Partial<Record<keyof SpecDraft, number>> {
  const map: Partial<Record<keyof SpecDraft, number>> = {};
  header.forEach((cell, i) => {
    const f = headerField(cell);
    if (f && map[f] === undefined) map[f] = i;
  });
  return map;
}

/**
 * Sheet rows → drafts. The header row is the first row (within the first
 * five) that maps a name column plus at least one more field. `mapped` is
 * false when no such row exists — send the rows to the AI instead.
 */
export function rowsToDrafts(rows: string[][]): { mapped: boolean; drafts: SpecDraft[]; columns: string[] } {
  for (let h = 0; h < Math.min(5, rows.length); h++) {
    const map = mapHeaders(rows[h]);
    const fields = Object.keys(map);
    if (map.name === undefined || fields.length < 2) continue;
    const raw = rows.slice(h + 1).map((r) => {
      const o: Record<string, unknown> = {};
      for (const [f, i] of Object.entries(map)) o[f] = r[i as number] ?? "";
      return o;
    });
    return { mapped: true, drafts: cleanDrafts(raw), columns: fields };
  }
  return { mapped: false, drafts: [], columns: [] };
}

/** Sheet rows as plain text for the AI (tab-separated, capped). */
export function rowsToText(rows: string[][], maxChars = 60_000): string {
  let out = "";
  for (const r of rows) {
    const line = r.join("\t");
    if (out.length + line.length + 1 > maxChars) break;
    out += `${line}\n`;
  }
  return out;
}

/* ── cleaning ──────────────────────────────────────────────────────────── */

const str = (v: unknown, max = 200): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
const money = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;
  const s = String(v).trim();
  if (!s || /^(n\/?a|tbd|call|quote|varies|-+|—)$/i.test(s)) return null;
  const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
const positive = (v: unknown): number | null => {
  const n = money(v);
  return n !== null && n > 0 ? n : null;
};

/** Validate + trim whatever came in (AI JSON or mapped sheet rows). Rows
 *  without a name are dropped; exact duplicates (same name + brand + model)
 *  keep the first. */
export function cleanDrafts(input: unknown): SpecDraft[] {
  if (!Array.isArray(input)) return [];
  const out: SpecDraft[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = str(r.name, 160);
    if (!name) continue;
    const brand = str(r.brand, 80);
    const model = str(r.model, 80);
    const key = `${name}|${brand || ""}|${model || ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const kw = Array.isArray(r.keywords)
      ? r.keywords
      : typeof r.keywords === "string" ? r.keywords.split(/[,;|]/) : [];
    out.push({
      name,
      brand,
      model,
      sku: str(r.sku, 60),
      store: str(r.store, 80),
      trade: str(r.trade, 40),
      category: str(r.category, 60),
      unit: str(r.unit, 30),
      unit_price: money(r.unit_price ?? r.price),
      pack_size: positive(r.pack_size),
      pack_label: str(r.pack_label, 60),
      coverage: positive(r.coverage),
      coverage_unit: str(r.coverage_unit, 30),
      keywords: kw.map((k) => str(k, 60)).filter((k): k is string => !!k).slice(0, 12),
      companions: normalizeCompanions(r.companions),
      notes: str(r.notes, 300),
    });
    if (out.length >= MAX_IMPORT_ITEMS) break;
  }
  return out;
}

/** A draft as a material_spec_items insert row. */
export function draftToRow(d: SpecDraft, orgId: string, specId: string, sort: number): Record<string, unknown> {
  return {
    org_id: orgId,
    spec_id: specId,
    name: d.name,
    brand: d.brand,
    model: d.model,
    sku: d.sku,
    store: d.store,
    trade: d.trade,
    category: d.category,
    unit: d.unit,
    unit_price: d.unit_price,
    pack_size: d.pack_size,
    pack_label: d.pack_label,
    coverage: d.coverage,
    coverage_unit: d.coverage_unit,
    keywords: d.keywords,
    companions: d.companions,
    notes: d.notes,
    sort,
  };
}

/** "1 Shaw 4151 adhesive per 400" per line ⇄ companions. */
export function companionsToText(cs: SpecCompanion[]): string {
  return cs.map((c) => `${c.qty} ${c.name} per ${c.per}`).join("\n");
}
export function textToCompanions(text: string): SpecCompanion[] {
  const out: SpecCompanion[] = [];
  for (const line of text.split(/\n+/)) {
    const m = line.trim().match(/^(\d+(?:\.\d+)?)\s+(.+?)\s+per\s+(\d+(?:\.\d+)?)\b/i);
    if (m) out.push({ qty: Number(m[1]), name: m[2].trim(), per: Number(m[3]) });
  }
  return out.slice(0, 6);
}

/** The AI extraction instructions (used by /api/specs/extract). */
export const SPEC_EXTRACT_PROMPT = `You turn a property manager's or client's MATERIAL SPECIFICATION into a list of products a contractor must buy.

Return ONLY JSON: {"items": [ ... ], "notes": ["..."]}
Each item:
{
  "name": product name as the spec writes it, without the brand (e.g. "Infinium carpet tile", "4in wall base, charcoal"),
  "brand": manufacturer (e.g. "Shaw", "Roppe", "Behr", "Halco", "Schlage") or null,
  "model": model / style / color number exactly as written (e.g. "700 Series", "F51A ACC 619") or null,
  "sku": store SKU if given, else null,
  "store": where to buy if given (e.g. "Home Depot", "Sherwin-Williams"), else null,
  "trade": one of Flooring, Painting, Electrical, Plumbing, Carpentry, Doors & Hardware, Drywall, HVAC, Appliances, General,
  "category": short kind of material (e.g. "Carpet tile", "Wall base", "Interior paint", "Light fixture", "Door lever"),
  "unit": how it is SOLD (e.g. "box", "coil", "gal", "ea", "pail"),
  "unit_price": price per selling unit as a number if the spec states one, else null,
  "pack_size": how many feet / square feet / pieces one selling unit holds if stated (120 for a 120 ft coil), else null,
  "pack_label": short text for the selling unit if useful (e.g. "120 ft coil", "case of 24"), else null,
  "coverage": what one selling unit covers if stated (e.g. 350 for paint that covers 350 sq ft per gallon), else null,
  "coverage_unit": the unit of coverage (e.g. "sqft"), else null,
  "keywords": 2-5 other words a contractor or inspection report would use for this (e.g. ["baseboard", "cove base", "rubber base"]),
  "companions": items always bought with it, ONLY when the spec says so: [{"name": "...", "qty": 1, "per": 400}] meaning qty per "per" units, else [],
  "notes": short spec notes (finish, color, where it applies), else null
}

Rules:
- NEVER invent a price, model, SKU or coverage. If the spec does not state it, use null.
- Keep brand and model text exactly as written.
- One item per distinct product / color / size / finish. If the spec lists one product in two colors, that is two items.
- Skip labor, scope paragraphs, warranty text and anything that is not a product to buy.
- If the spec is a table, every product row becomes one item.
- Use "notes" (top level) for anything the reviewer should check (unclear rows, items that could not be read).`;
