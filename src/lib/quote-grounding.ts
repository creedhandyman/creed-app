/**
 * Quote grounding — what the AI quoter is shown from THIS shop's own records
 * for the request in front of it. Pure (no I/O), tested in
 * src/__tests__/quote-grounding.test.ts.
 *
 * Why this exists: the old "LEARNED PRICING" block keyed a lesson on a line's
 * whole text ("Kitchen — Replace GFCI outlet that will not reset") and needed
 * two rows with that exact text — which in practice only happened when the
 * SAME quote was edited twice. So a new quote almost never saw anything
 * relevant, and what it did see was the first 45 keys in arbitrary order.
 * Now every past line is one example, the location is stripped ("Replace GFCI
 * outlet…" learned in a kitchen applies in a bathroom), an edit chain collapses
 * to its final value, and only the examples that actually resemble the request
 * are sent. Three sources, all matched to the request text:
 *   1. pastWork      — the team's own quoted + clocked lines (price_corrections)
 *   2. receipt prices — what the team paid per unit (receipt scans)
 *   3. knowledge base — the shop's reference hands-on hours (price_book)
 *   4. shop prices   — the curated materials list (materials-db)
 */
import { MATERIALS_DB } from "./materials-db";

/** A price_corrections row, as grounding reads it (newest-first). */
export interface GroundingRow {
  item_name: string;
  original_hours: number;
  corrected_hours: number;
  original_mat_cost: number;
  corrected_mat_cost: number;
  trade?: string;
  zip?: string;
  job_id?: string | null;
  source?: string | null;
  material_name?: string | null;
  created_at?: string;
}

/** A price_book row (the repair knowledge base). */
export interface KbRow {
  item_name: string;
  labor_hours_low?: number | string | null;
  labor_hours_high?: number | string | null;
  labor_hours?: number | string | null;
  unit?: string | null;
  scope?: string | null;
  active?: boolean | null;
  meta?: { basis?: string } | null;
}

/* ── text matching ─────────────────────────────────────────────────────── */

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "are", "was", "has", "have", "not",
  "will", "new", "old", "all", "any", "per", "its", "one", "two", "needs", "need", "needed", "where",
  "approx", "about", "est", "see", "also", "each", "out", "off", "over", "under", "side",
]);

const stem = (w: string) => {
  // "re-caulk" / "recaulk" / "caulking" → "caulk"; "repaint" → "paint".
  const base = w.length >= 6 && w.startsWith("re") ? w.slice(2) : w;
  const s = base.replace(/(?:ings?|ed|es|e|s)$/, "");
  return s.length >= 3 ? s : base;
};

/** Content words of a line: lowercase, letters only, ≥3 chars, crudely stemmed. */
export function tokens(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/([a-z])-([a-z])/g, "$1$2") // re-caulk → recaulk, pre-hung → prehung
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map(stem);
}

/** "Kitchen — Replace GFCI outlet" → "Replace GFCI outlet". Only the first
 *  segment is the location; "[T&M]" markers go too. */
export function taskOf(detail: string): string {
  const parts = (detail || "").split(/\s+—\s+/);
  const task = parts.length > 1 ? parts.slice(1).join(" — ") : parts[0] || "";
  return task.replace(/\[t&m\]\s*/gi, "").replace(/\s+/g, " ").trim();
}

const median = (xs: number[]): number => {
  const a = xs.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

interface Scored<T> { item: T; weight: number }

/** The request, one finding at a time: lines and sentences. Matching inside
 *  one finding (not across the whole report) is what keeps "door knob
 *  missing" in one room and "touch up paint" in another from adding up to
 *  "paint interior doors". */
function findings(request: string): Set<string>[] {
  return (request || "")
    .split(/[\n\r]+|[.;!?]+(?=\s|$)/)
    .map((seg) => new Set(tokens(seg)))
    .filter((set) => set.size > 0)
    .slice(0, 800);
}

/**
 * Rank candidates by how much of each one's wording appears in a single
 * finding of the request. A candidate qualifies when at least `minShare`
 * (default 70%) of its rarity-weighted words are in that finding and at least
 * two words match (or all of them, for a 1-2 word candidate). Rarer shared
 * words rank higher — "anode" says more than "replace".
 */
export function rankByRequest<T>(
  candidates: T[],
  textOf: (c: T) => string,
  request: string,
  limit: number,
  minShare = 0.7,
): T[] {
  const segs = findings(request);
  if (segs.length === 0 || candidates.length === 0) return [];
  const toks = candidates.map((c) => Array.from(new Set(tokens(textOf(c)))));
  const df = new Map<string, number>();
  for (const ts of toks) for (const t of ts) df.set(t, (df.get(t) || 0) + 1);
  const n = candidates.length;
  const idf = (t: string) => Math.log(1 + n / (df.get(t) || 1));
  const scored: Scored<T>[] = [];
  candidates.forEach((c, i) => {
    const ts = toks[i];
    if (ts.length === 0) return;
    const w = ts.map(idf);
    const all = w.reduce((x, y) => x + y, 0);
    let best = 0;
    for (const seg of segs) {
      let shared = 0, sharedCount = 0;
      ts.forEach((t, k) => { if (seg.has(t)) { shared += w[k]; sharedCount += 1; } });
      const enoughWords = sharedCount >= 2 || sharedCount === ts.length;
      if (enoughWords && shared / all >= minShare && shared > best) best = shared;
    }
    if (best > 0) scored.push({ item: c, weight: best });
  });
  // Stable: equal weights keep input order (callers pass newest-first).
  return scored
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.weight - a.s.weight || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.s.item);
}

/* ── 1. past work ──────────────────────────────────────────────────────── */

export interface PastWork {
  task: string;
  /** Final quoted hours (median across jobs). */
  hrs: number;
  /** Hours the job's clock put on it (median), when trustworthy. */
  actualHrs?: number;
  /** Final quoted materials $ (median of the non-zero ones). */
  mat?: number;
  jobs: number;
}

const isJobRow = (name: string) => name.startsWith("__job__:") || name.startsWith("__jobraw__:");
const isReceiptRow = (r: GroundingRow) =>
  !(r.original_hours > 0) && !(r.corrected_hours > 0) && r.corrected_mat_cost > 0 && r.source !== "quote_edit";
const isOverhead = (detail: string) =>
  /\bjob\s*set-?up\b[^—]*\bclean-?\s*up\b|\blarge-job overhead\b/i.test(detail);

/**
 * One example per distinct task from the team's quote edits, hand-added lines
 * and completed jobs. Rows must be NEWEST-FIRST: the first row seen for a
 * (job, task) is that quote's final value, so an edit chain (4h → 5h → 4h)
 * counts once, at where the owner left it.
 */
export function pastWorkFrom(rows: GroundingRow[]): PastWork[] {
  interface Point { task: string; hrs?: number; actual?: number; mat?: number }
  const points = new Map<string, Point>();
  const order: string[] = [];
  for (const r of rows) {
    const name = typeof r.item_name === "string" ? r.item_name : "";
    if (!name || isJobRow(name) || isReceiptRow(r)) continue;
    if (/\[t&m\]/i.test(name) || isOverhead(name)) continue;
    const task = taskOf(name);
    const key = task.toLowerCase();
    if (tokens(task).length === 0) continue;
    // No job id = an edit made before the quote was first saved; the day
    // stands in for the quote so one sitting's edits still collapse.
    const group = `${r.job_id || `day:${(r.created_at || "").slice(0, 10)}`}|${key}`;
    let p = points.get(group);
    if (!p) { p = { task }; points.set(group, p); order.push(group); }
    if (r.source === "job_completion") {
      const q = Number(r.original_hours) || 0;
      const a = Number(r.corrected_hours) || 0;
      if (q > 0 && p.hrs === undefined) p.hrs = q;
      // The clocked figure is the job's total split pro-rata, so one badly
      // clocked job mustn't teach "this takes 20 minutes": trust it only
      // within 0.5-2x of what was quoted.
      if (q > 0 && a > 0 && a / q >= 0.5 && a / q <= 2 && p.actual === undefined) p.actual = a;
    } else {
      const h = Number(r.corrected_hours) || 0;
      const m = Number(r.corrected_mat_cost) || 0;
      // Newest row wins — but a completion row seen first only set the quoted
      // hours from the same final quote, so there is nothing to overwrite.
      if (p.hrs === undefined && h > 0) p.hrs = h;
      if (p.mat === undefined && m > 0) p.mat = m;
    }
  }
  const byTask = new Map<string, { task: string; hrs: number[]; actual: number[]; mat: number[]; jobs: number }>();
  const taskOrder: string[] = [];
  for (const g of order) {
    const p = points.get(g)!;
    if (!(p.hrs && p.hrs > 0)) continue;
    const key = p.task.toLowerCase();
    let t = byTask.get(key);
    if (!t) { t = { task: p.task, hrs: [], actual: [], mat: [], jobs: 0 }; byTask.set(key, t); taskOrder.push(key); }
    t.hrs.push(p.hrs);
    if (p.actual) t.actual.push(p.actual);
    if (p.mat) t.mat.push(p.mat);
    t.jobs += 1;
  }
  return taskOrder.map((k) => {
    const t = byTask.get(k)!;
    return {
      task: t.task,
      hrs: Math.round(median(t.hrs) * 100) / 100,
      ...(t.actual.length ? { actualHrs: Math.round(median(t.actual) * 100) / 100 } : {}),
      ...(t.mat.length ? { mat: Math.round(median(t.mat)) } : {}),
      jobs: t.jobs,
    };
  });
}

/* ── 2. receipt prices ─────────────────────────────────────────────────── */

export interface ReceiptPrice { name: string; price: number; n: number }

// A receipt has more on it than materials. Nothing here belongs in a quote.
const NOT_MATERIAL =
  /\b(powerade|gatorade|monster|red\s*bull|coke|pepsi|sprite|soda|water\s*bottle|bottled\s*water|coffee|energy\s*drink|candy|snack|chips|jerky|gum|sandwich|donut|bag\s*fee|sales\s*tax|subtotal|deposit|crv|gift\s*card|rental|fuel|gasoline|diesel)\b/i;

/** Per-unit prices the team actually paid, median per item. Same-ZIP
 *  purchases win when there are any for that item. Rows newest-first. */
export function receiptPricesFrom(rows: GroundingRow[], zip?: string): ReceiptPrice[] {
  const by = new Map<string, { name: string; local: number[]; all: number[] }>();
  const order: string[] = [];
  for (const r of rows) {
    const name = typeof r.item_name === "string" ? r.item_name.trim() : "";
    if (!name || isJobRow(name) || !isReceiptRow(r) || NOT_MATERIAL.test(name)) continue;
    const key = name.toLowerCase().replace(/\s+/g, " ");
    let e = by.get(key);
    if (!e) { e = { name, local: [], all: [] }; by.set(key, e); order.push(key); }
    e.all.push(r.corrected_mat_cost);
    if (zip && r.zip === zip) e.local.push(r.corrected_mat_cost);
  }
  return order.map((k) => {
    const e = by.get(k)!;
    const xs = e.local.length ? e.local : e.all;
    return { name: e.name, price: Math.round(median(xs) * 100) / 100, n: xs.length };
  });
}

/* ── 3. knowledge base ─────────────────────────────────────────────────── */

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** Knowledge-base rows a quote line can lean on: active, handyman scope
 *  (H / HP — GC rows are crew-hours with huge ranges; L / S are licensed or
 *  specialist work the shop doesn't self-perform), with a real hours range. */
export function usableKbRows(rows: KbRow[]): KbRow[] {
  return rows.filter((r) => {
    if (!r || r.active === false) return false;
    if (r.scope && r.scope !== "H" && r.scope !== "HP") return false;
    const lo = num(r.labor_hours_low), hi = num(r.labor_hours_high);
    return lo > 0 && hi >= lo && hi <= 16;
  });
}

/** What a knowledge-base row is matched on: its task without the category,
 *  without "(qualifiers)", and only the first of "A / B" alternative wordings
 *  ("Running toilet / phantom refill" → "Running toilet"). */
export function kbTask(r: KbRow): string {
  return taskOf(r.item_name).replace(/\([^)]*\)/g, " ").split(/\s+\/\s+/)[0].replace(/\s+/g, " ").trim();
}

/* ── 4. shop price list ────────────────────────────────────────────────── */

/** materials-db items whose match phrases appear in the request. Longer
 *  (more specific) phrases first; one entry per item. */
export function shopPricesFor(request: string, limit = 40): { name: string; price: number }[] {
  const hay = ` ${(request || "").toLowerCase().replace(/[^a-z0-9"/.]+/g, " ")} `;
  if (hay.trim().length < 3) return [];
  const hits: { name: string; price: number; len: number; i: number }[] = [];
  MATERIALS_DB.forEach((m, i) => {
    let best = 0;
    for (const k of m.keywords) {
      const kw = k.toLowerCase().replace(/[^a-z0-9"/.]+/g, " ").trim();
      if (kw.length >= 4 && hay.includes(` ${kw}`) && kw.length > best) best = kw.length;
    }
    if (best) hits.push({ name: m.name, price: m.price, len: best, i });
  });
  return hits
    .sort((a, b) => b.len - a.len || a.i - b.i)
    .slice(0, limit)
    .map(({ name, price }) => ({ name, price }));
}

/* ── the prompt block ──────────────────────────────────────────────────── */

const hrsText = (h: number) => `${Math.round(h * 100) / 100}h`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export interface GroundingInput {
  /** The request being quoted (inspection text, description, voice walk). */
  request: string;
  /** price_corrections rows, newest-first, de-duped by the caller. */
  corrections?: GroundingRow[];
  /** price_book rows (any scope — filtered here). */
  kb?: KbRow[];
  zip?: string;
}

export interface Grounding {
  prompt: string;
  /** Counts per source, for tests and debugging. */
  used: { pastWork: number; receipts: number; kb: number; shop: number };
}

/**
 * The per-request grounding block for the quoter's system prompt. Empty
 * string when nothing on file resembles the request (photo-only quotes, a
 * brand-new shop) — the quoter then runs on its generic tables, as before.
 */
export function buildGrounding(input: GroundingInput): Grounding {
  const request = input.request || "";
  const rows = input.corrections || [];
  const past = rankByRequest(pastWorkFrom(rows), (p) => p.task, request, 20);
  const receipts = rankByRequest(receiptPricesFrom(rows, input.zip), (p) => p.name, request, 12);
  const kb = rankByRequest(usableKbRows(input.kb || []), kbTask, request, 25);
  const shop = shopPricesFor(request);

  const parts: string[] = [];
  if (past.length) {
    parts.push(
      `YOUR PAST WORK — lines from this team's own quotes and finished jobs that resemble this request. ` +
        `Size matching work from these BEFORE the generic tables: the same task gets the same hours and materials ` +
        `unless the count, size or condition differs (then scale it). "took" = hours the crew actually clocked.\n` +
        past
          .map((p) => {
            const bits = [`quoted ${hrsText(p.hrs)}`];
            if (p.actualHrs !== undefined) bits.push(`took ~${hrsText(p.actualHrs)}`);
            if (p.mat !== undefined) bits.push(`materials ~$${p.mat}`);
            if (p.jobs > 1) bits.push(`${p.jobs} jobs`);
            return `- ${clip(p.task, 110)}: ${bits.join(", ")}`;
          })
          .join("\n"),
    );
  }
  if (kb.length) {
    parts.push(
      `REPAIR KNOWLEDGE BASE — this shop's reference HANDS-ON hours for one worker doing one such task ` +
        `(setup, supply runs and cleanup are extra and shared across the visit). The rows were picked by wording, so ` +
        `ignore any that are not the same task as one of your lines (same object, same action, same extent). Where a ` +
        `row IS your line: do not quote below its low end, and if the line needs more than about twice its high end, ` +
        `say why in the comment (quantity, access, demo, hidden damage). A row covers ONE unit — multiply by count.\n` +
        kb
          .map((r) => {
            const lo = num(r.labor_hours_low), hi = num(r.labor_hours_high);
            const basis = (r.meta?.basis || (r.unit ? `per ${r.unit}` : "")).trim();
            return `- ${clip(r.item_name, 110)}: ${lo === hi ? hrsText(lo) : `${lo}–${hi}h`}${basis ? ` (${basis})` : ""}`;
          })
          .join("\n"),
    );
  }
  if (shop.length || receipts.length) {
    const lines: string[] = [];
    if (shop.length) lines.push(`Shop list (use only the items your lines need): ${shop.map((s) => `${s.name} $${s.price}`).join(", ")}`);
    if (receipts.length) {
      lines.push(`Recent receipts (per unit): ${receipts.map((r) => `${clip(r.name, 60)} $${r.price}`).join(", ")}`);
    }
    parts.push(
      `SHOP MATERIAL COSTS — what this contractor really pays, before markup (the pricing layer adds markup and tax). ` +
        `For a material the input does not price, use the matching cost here instead of the generic price table or a guess; ` +
        `never override a price the input states.\n${lines.join("\n")}`,
    );
  }
  return {
    prompt: parts.length ? `\n${parts.join("\n\n")}\n\n` : "",
    used: { pastWork: past.length, receipts: receipts.length, kb: kb.length, shop: shop.length },
  };
}
