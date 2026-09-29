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
import { extractZip, isOverheadLine, RAW_JOB_PREFIX } from "./parser";
import { itemInTier, type TierKey } from "./tiers";
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

function parseJobItems(job: Job): { items: { trade: string; item: RoomItem }[]; tierUnknown: boolean } {
  let rooms: Room[] = [];
  let acceptedTier: TierKey | null = null;
  let tiered = false;
  try {
    const blob = typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms;
    if (blob && Array.isArray(blob.rooms)) rooms = blob.rooms as Room[];
    tiered = blob?.tieredQuote === true;
    const at = blob?.acceptedTier;
    if (at === "base" || at === "better" || at === "best") acceptedTier = at;
  } catch {
    /* no parseable quote */
  }
  const out: { trade: string; item: RoomItem }[] = [];
  for (const r of rooms)
    for (const it of r.items || []) {
      // The generic "Job setup, staging & cleanup" line isn't a task — keep it
      // off the QUOTED side so actual/quoted stays clocked hours vs task
      // hours, the same basis the quoter drops it on (see isOverheadLine).
      if (isOverheadLine(it.detail)) continue;
      // Only the SOLD scope was worked: on a Good-Better-Best quote only the
      // picked option's lines were done. Counting the rest made the job look
      // faster than it was. (Legacy `optional` lines ARE billed — they roll
      // into the subtotal since 292b395 — so they stay in.)
      if (tiered && acceptedTier && !itemInTier(it, acceptedTier)) continue;
      out.push({ trade: r.name, item: it });
    }
  return { items: out, tierUnknown: tiered && !acceptedTier };
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
/** Someone is still on the clock for this job (an entry with a start and no
 *  end) — its clocked total isn't final yet. Same job match as jobActualHours. */
export function jobHasOpenEntries(job: Job, timeEntries: TimeEntry[]): boolean {
  return timeEntries.some(
    (e) => !!e.start_time && !e.end_time && (e.job_id ? e.job_id === job.id : e.job === job.property),
  );
}

export async function recordJobOutcome(
  job: Job,
  actualHrs: number,
  opts?: { crewStillClocked?: boolean },
): Promise<void> {
  if (!actualHrs || actualHrs <= 0) return;

  const { items, tierUnknown } = parseJobItems(job);
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

  // Raw-basis calibration rows (`__jobraw__:{trade}`): clocked hours vs the
  // AI parser's OWN hours for its lines (RoomItem.aiHrs, stamped before the
  // labor calibration scaled them). actual ÷ aiHrs is exactly the multiplier
  // the quoter needs — independent of whatever factor, prompt or model
  // produced the quote — so parser.ts calibrates from these once enough
  // exist. Each line's share of the actual hours is pro-rata to its FINAL
  // hours (the owner's edits inform the split); lines without aiHrs (manual
  // or AI-Assist adds) drop out with their share. Always written — an
  // on-target job has to pull the factor toward 1 as surely as a miss pulls
  // it away. Skipped when the reading isn't trustworthy: a tiered quote with
  // no recorded pick (sold scope unknown), a crew member still on the clock
  // (actual not final), or a job spawned from a recurring template / plan
  // (its lines are a copy of another job's quote, not an estimate for this
  // one).
  const spawned = /^(Recurring|Membership):/.test(String(job.created_by || ""));
  if (!tierUnknown && !opts?.crewStillClocked && !spawned && estFromItems > 0) {
    const raw: Record<string, { ai: number; fin: number }> = {};
    for (const x of items) {
      // T&M lines: aiHrs covers only the assessment visit, while the owner
      // raises the line to cover the repair — not a model estimate to grade.
      if (x.item.tnm === true) continue;
      const ai = Number(x.item.aiHrs);
      const fin = x.item.laborHrs || 0;
      if (!(ai > 0) || !(fin > 0)) continue;
      const t = raw[x.trade] || (raw[x.trade] = { ai: 0, fin: 0 });
      t.ai += ai;
      t.fin += fin;
    }
    for (const [trade, t] of Object.entries(raw)) {
      await logCorrection({
        item_name: `${RAW_JOB_PREFIX}${trade}`,
        original_hours: round2(t.ai),
        corrected_hours: round2(t.fin * scale),
        original_mat_cost: 0,
        corrected_mat_cost: 0,
        material_name: "Job completion (AI hours)",
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
