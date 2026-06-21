/**
 * AI self-learning helpers — turn real job outcomes into price_corrections
 * rows the quoter (parser.ts) reads back, so estimates get more accurate the
 * more the team works.
 *
 * The big win here: job-completion feedback now fires from ANY completion
 * path (the tech's "Complete Job" in WorkVision AND the admin status flip in
 * Jobs), where before it only fired from the admin path — so most finished
 * jobs never taught the AI their real hours.
 *
 * Rows are stamped with `source` + `job_id` (and the table's created_at
 * DEFAULT NOW()) so the quoter can de-dupe per job and weigh recent data more
 * heavily. Requires the migration in CLAUDE.md (source / job_id / created_at).
 */
import { db } from "./supabase";
import { extractZip } from "./parser";
import type { Job, TimeEntry, Room, RoomItem } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type CorrectionSource = "receipt_scan" | "manual_add" | "quote_edit" | "job_completion";

export interface CorrectionRow {
  item_name: string;
  original_hours: number;
  corrected_hours: number;
  original_mat_cost: number;
  corrected_mat_cost: number;
  material_name?: string;
  trade: string;
  zip?: string | null;
  source: CorrectionSource;
  job_id?: string | null;
}

/** Write one price_corrections row, tagged with source + job_id. */
export async function logCorrection(c: CorrectionRow): Promise<void> {
  await db.post("price_corrections", { material_name: "", job_id: null, ...c });
}

/** Hours actually logged against a job — explicit job_id link, with a legacy
 *  property-match fallback for time entries written before job_id existed. */
export function jobActualHours(job: Job, timeEntries: TimeEntry[]): number {
  return timeEntries
    .filter((e) => (e.hours || 0) > 0 && (e.job_id ? e.job_id === job.id : e.job === job.property))
    .reduce((s, e) => s + (e.hours || 0), 0);
}

function parseJobItems(job: Job): { trade: string; item: RoomItem }[] {
  let rooms: Room[] = [];
  try {
    const blob = typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms;
    if (blob && Array.isArray(blob.rooms)) rooms = blob.rooms as Room[];
  } catch {
    /* no parseable quote */
  }
  const out: { trade: string; item: RoomItem }[] = [];
  for (const r of rooms) for (const it of r.items || []) out.push({ trade: r.name, item: it });
  return out;
}

/**
 * Record estimated-vs-actual HOURS feedback when a job completes. Writes:
 *   - one `__job__:{trade}` row per trade (overall sizing context), and
 *   - one per-item row keyed by the item description (granular hour learning),
 * with the actual hours distributed across items pro-rata to their estimates.
 *
 * Materials are deliberately NOT touched here (already learned per-item from
 * receipt scans); leaving original_mat == corrected_mat keeps these rows out
 * of the material averages in parser.ts.
 *
 * Safe to call from any completion path — the quoter de-dupes job_completion
 * rows by (job_id, item_name), so a re-completed job can't double-count.
 * Best-effort: callers should wrap in try/catch so a learning failure never
 * blocks completing the job.
 */
export async function recordJobOutcome(job: Job, actualHrs: number): Promise<void> {
  if (!actualHrs || actualHrs <= 0) return;

  const items = parseJobItems(job);
  const estFromItems = items.reduce((s, x) => s + (x.item.laborHrs || 0), 0);
  const estHrs = estFromItems > 0 ? estFromItems : job.total_hrs || 0;
  if (estHrs <= 0) return;

  const zip = extractZip(job.property || "");
  const scale = actualHrs / estHrs;

  // Per-trade job-level sizing rows (actual split pro-rata by estimated trade
  // hours). Falls back to one whole-job row when there's no parseable quote.
  const tradeEst: Record<string, number> = {};
  for (const x of items) tradeEst[x.trade] = (tradeEst[x.trade] || 0) + (x.item.laborHrs || 0);
  const trades = Object.keys(tradeEst).filter((tr) => tradeEst[tr] > 0);
  if (trades.length > 0) {
    for (const trade of trades) {
      const te = tradeEst[trade];
      const ta = te * scale;
      if (Math.abs(ta - te) > 0.5) {
        await logCorrection({
          item_name: `__job__:${trade}`,
          original_hours: round2(te),
          corrected_hours: round2(ta),
          original_mat_cost: 0,
          corrected_mat_cost: 0,
          material_name: "Job completion (hours)",
          trade,
          zip,
          source: "job_completion",
          job_id: job.id,
        });
      }
    }
  } else {
    const trade = job.trade || "General";
    if (Math.abs(actualHrs - estHrs) > 0.5) {
      await logCorrection({
        item_name: `__job__:${trade}`,
        original_hours: round2(estHrs),
        corrected_hours: round2(actualHrs),
        original_mat_cost: 0,
        corrected_mat_cost: 0,
        material_name: "Job completion (hours)",
        trade,
        zip,
        source: "job_completion",
        job_id: job.id,
      });
    }
  }

  // Per-item rows — only items that landed meaningfully off, to limit noise.
  for (const x of items) {
    const eh = x.item.laborHrs || 0;
    if (eh <= 0 || !x.item.detail) continue;
    const ah = eh * scale;
    if (Math.abs(ah - eh) > 0.25) {
      await logCorrection({
        item_name: x.item.detail,
        original_hours: round2(eh),
        corrected_hours: round2(ah),
        original_mat_cost: 0,
        corrected_mat_cost: 0,
        material_name: "",
        trade: x.trade,
        zip,
        source: "job_completion",
        job_id: job.id,
      });
    }
  }
}
