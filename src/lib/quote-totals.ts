/**
 * The money a job ROW carries for its quote — one rule, so the Jobs card, the
 * invoice, the editor's save and the send menu can't disagree (2026-11-14).
 *
 *  - `rowTier` / `tierRowTotals`: on a three-tier quote the row's total /
 *    labor / materials / hours are ONE tier's: the tier the customer accepted,
 *    else the one tier the quote was sent as, else the recommended tier
 *    (Complete). Before this a quote sent as "Essential only" kept Complete's
 *    price on the job card and the invoice.
 *  - `jobMoney`: what the Jobs screen shows. A lead whose AI draft isn't
 *    saved yet shows the DRAFT's numbers (they live on the blob; the row is
 *    still $0), and a job with no quote built says so instead of printing
 *    "$0 labor / $0 materials".
 */
import { tryReadBlob, type RoomsBlob } from "./job-blob";
import { readSentTier } from "./quote-blob";
import { RECOMMENDED_TIER, type TierKey } from "./tiers";
import { leadDraftMoney } from "./lead-draft-info";

const isTier = (v: unknown): v is TierKey => v === "base" || v === "better" || v === "best";
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Which tier's price the job row carries: accepted → sent as one tier →
 *  `fallback` (the editor's headline tier; Complete by default). */
export function rowTier(blob: RoomsBlob | null | undefined, fallback: TierKey = RECOMMENDED_TIER): TierKey {
  if (isTier(blob?.acceptedTier)) return blob.acceptedTier;
  return readSentTier(blob) ?? fallback;
}

export type RowTotals = {
  total: number;
  total_labor?: number;
  total_mat?: number;
  total_hrs?: number;
};

/**
 * The row totals a three-tier quote should carry right now (see `rowTier`),
 * read from the tier prices the editor stored on the blob. null when the
 * quote isn't tiered or that tier has no stored price — leave the row alone.
 */
export function tierRowTotals(blob: RoomsBlob | null | undefined, fallback?: TierKey): RowTotals | null {
  if (blob?.tieredQuote !== true) return null;
  const tt = blob.tierTotals as Record<string, unknown> | null | undefined;
  const key = rowTier(blob, fallback);
  const total = num(tt?.[key]);
  if (total === null) return null;
  const bk = (blob.tierBreakdown as Record<string, { labor?: unknown; mat?: unknown; hrs?: unknown }> | null | undefined)?.[key];
  const out: RowTotals = { total };
  const labor = num(bk?.labor), mat = num(bk?.mat), hrs = num(bk?.hrs);
  if (labor !== null) out.total_labor = labor;
  if (mat !== null) out.total_mat = mat;
  if (hrs !== null) out.total_hrs = hrs;
  return out;
}

/** Does the row already carry these totals (to the cent)? */
export function rowMatches(
  row: { total?: unknown; total_labor?: unknown; total_mat?: unknown; total_hrs?: unknown },
  t: RowTotals,
): boolean {
  const same = (a: unknown, b: number | undefined) => b === undefined || Math.abs((Number(a) || 0) - b) < 0.005;
  return same(row.total, t.total) && same(row.total_labor, t.total_labor) && same(row.total_mat, t.total_mat) && same(row.total_hrs, t.total_hrs);
}

export interface JobMoney {
  total: number;
  /** null = not known (shown as a dash, never as $0). */
  labor: number | null;
  mat: number | null;
  hrs: number | null;
  /** "quote": the saved quote's numbers · "draft": an AI draft the owner
   *  hasn't saved yet · "none": no quote has been built for this job. */
  state: "quote" | "draft" | "none";
}

/** Does the blob hold at least one quote line? */
export function hasQuoteLines(blob: RoomsBlob | null | undefined): boolean {
  const rooms = blob?.rooms;
  return Array.isArray(rooms) && rooms.some((r) => Array.isArray((r as { items?: unknown })?.items) && (r as { items: unknown[] }).items.length > 0);
}

/** What the Jobs screen shows for a job's money (see the file header). */
export function jobMoney(job: {
  rooms?: unknown; total?: unknown; total_labor?: unknown; total_mat?: unknown; total_hrs?: unknown;
}): JobMoney {
  const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const total = n(job.total), labor = n(job.total_labor), mat = n(job.total_mat), hrs = n(job.total_hrs);
  if (total > 0 || labor > 0 || mat > 0 || hrs > 0) return { total, labor, mat, hrs, state: "quote" };
  const draft = leadDraftMoney(job.rooms);
  if (draft) return { total: draft.total, labor: draft.labor, mat: draft.materials, hrs: draft.hours, state: "draft" };
  // A saved quote that really prices to $0 still reads as a quote.
  if (hasQuoteLines(tryReadBlob(job.rooms))) return { total: 0, labor: 0, mat: 0, hrs: 0, state: "quote" };
  return { total: 0, labor: null, mat: null, hrs: null, state: "none" };
}

/**
 * The row totals to write after a quote is sent as `sentTier` (one tier, or
 * null = all tiers): the job card and invoice follow the tier the customer
 * was actually sent. null = the row already says that (or it isn't tiered).
 */
export function sendRowPatch(
  job: { rooms?: unknown; total?: unknown; total_labor?: unknown; total_mat?: unknown; total_hrs?: unknown },
  sentTier: TierKey | null,
): RowTotals | null {
  const blob = tryReadBlob(job.rooms);
  if (!blob) return null;
  const t = tierRowTotals({ ...blob, sentTier });
  return t && !rowMatches(job, t) ? t : null;
}
