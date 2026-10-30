/**
 * Assembling what QuoteForge SAVES — the job row + its `rooms` blob — from the
 * editor's state. This used to be ~200 inline lines of `saveJob`, tangled with
 * toasts, the database write and resetting the screen. It's pure now (state in →
 * `{ row, blob, droppedDone }` out), so each rule is tested on its own:
 *
 *  - WORK ORDER: every task takes its editable fields (room, detail, action, pri,
 *    hrs) from the incoming step, and inherits ONLY the field-owned state
 *    (`done`, `completed_at`) from the previously saved task — matched by the
 *    quote line's id first (so renaming a line keeps its checkmark), else by the
 *    room|detail text key, each prior task used once. Tasks are tagged with their
 *    line's Good-Better-Best option membership (by line id, then text key, else
 *    all three — a mis-tag never hides a task). A quote with lines never saves an
 *    empty work order.
 *  - PHOTOS: every existing photo is kept; new ones are appended unless their url
 *    is already there.
 *  - PRIOR BLOB: spread first, so keys QuoteForge doesn't own (jobNotes, approval,
 *    leadDraft, future keys) survive an edit-save; the keys it owns are then
 *    written explicitly so CLEARING one (no discount, Auto crew…) really clears.
 *  - STATUS: a new quote starts "quoted"; an edit keeps its status (mid-job edits
 *    never demote a job), except a "lead" being quoted for the first time.
 *  - ACCEPTED OPTION: if the customer already accepted a Good-Better-Best option,
 *    the job stays locked to it (its recomputed totals, work order pruned to it);
 *    pre-approval it locks to the headline option — never to `gt`, which
 *    double-counts mutually exclusive scope.
 *  - `job_date` is set only when CREATING (re-saving an old quote mustn't move it
 *    to today).
 *
 * The pricing numbers (gt/tl/tm/th, tier totals…) are inputs: the price cascade
 * lives in pricing.ts and runs in the editor.
 */
import type { Room } from "./types";
import type { GuideStep } from "./parser";
import type { JobDiscount } from "./types";
import type { TaxMode } from "./tax";
import { woKey, type RoomsBlob } from "./job-blob";
import { itemInTier, itemTiers, type TierKey } from "./tiers";

type Photo = { url: string; label?: string; type?: string };

/** A saved work-order task. */
export type WorkOrderTask = {
  room: string; detail: string; action: string; pri: string; hrs: number; done: boolean;
  tiers?: TierKey[]; itemId?: string; custom?: boolean; completed_at?: string;
};

/** The slice of the Inspector's data the blob keeps. */
export interface InspectionLike {
  inspection_type?: string;
  property: string;
  client: string;
  rooms: {
    name: string; sqft?: unknown; width?: unknown; length?: unknown;
    items: { name: string; condition: unknown; notes?: unknown; photos?: unknown }[];
  }[];
}

export interface QuoteSaveInput {
  rooms: Room[];
  /** Crew on the quote, already resolved to names. */
  workers: { id: string; name: string }[];
  jobPhotos: Photo[];
  /** Work-order tasks after syncing with the quote (the edited work order, else the generated guide steps). */
  steps: GuideStep[];
  /** The generated guide steps — the fallback when `steps` comes back empty for a quote with lines. */
  guideSteps: GuideStep[];
  guideState: {
    customTools: unknown[]; customShop: unknown[]; checkedTools: unknown[]; checkedShop: unknown[]; removedGuideShop: unknown[];
  };
  settings: {
    discount: JobDiscount | null; laborRate: number | null; minLaborHours: number | null; taxMode: TaxMode | null;
    /** The materials purchase-tax rate (+ zip) these prices include. */
    materialTaxPct: number; materialTaxZip: string;
    tieredQuote: boolean; tierNames: { better: string; best: string };
    crewSize: number | null; estDays: number | null;
  };
  pricing: {
    gt: number; tl: number; tm: number; th: number;
    tierTotals: Record<TierKey, number>;
    tierBreakdown: Record<TierKey, { labor: number; mat: number; hrs: number }>;
    headlineKey: TierKey;
    /** Whether the options differ in SCOPE, not just price. */
    hasSplit: boolean;
  };
  /** Set only when the Inspector ran in this session; otherwise the saved `inspection` is kept. */
  inspection: InspectionLike | null;
  /** The previously saved job when it was found (blob + status); null for a new quote. */
  prev: { blob: RoomsBlob; status: string } | null;
  identity: {
    /** Saving over an existing quote (true even if its row wasn't found in the store). */
    editing: boolean;
    property: string; client: string; customerId?: string; addressId?: string;
    createdBy: string; trade: string;
    /** YYYY-MM-DD, used only when creating. */
    today: string;
  };
}

export interface QuoteSaveResult {
  /** The `jobs` row to insert / patch (its `rooms` is the JSON text of `blob`). */
  row: Record<string, unknown> & { rooms: string; total: number; status: string };
  blob: RoomsBlob;
  /** Finished tasks that no longer exist in the new quote (dropped — surfaced so a save can't silently erase field work). */
  droppedDone: string[];
}

/** The job's trade label: one trade carrying a MAJORITY (>50%) of the labor
 *  hours names the job; mixed jobs stay "General". Hours-weighted so a 30-hr
 *  flooring job with a 1-hr caulk line still reads "Flooring"; a bucket with no
 *  hours falls back to a small per-item weight so a materials-only bucket isn't
 *  invisible. */
export function dominantTrade(rooms: Room[]): string {
  const hrsByTrade: Record<string, number> = {};
  let total = 0;
  rooms.forEach((r) => {
    const hrs = r.items.reduce((s, it) => s + (it.laborHrs || 0), 0) || r.items.length * 0.5;
    hrsByTrade[r.name] = (hrsByTrade[r.name] || 0) + hrs;
    total += hrs;
  });
  const top = Object.entries(hrsByTrade).sort((a, b) => b[1] - a[1])[0];
  return top && total > 0 && top[1] / total > 0.5 ? top[0] : "General";
}

export function buildQuoteSave(input: QuoteSaveInput): QuoteSaveResult {
  const { rooms, jobPhotos, settings: s, pricing: p, identity: id } = input;
  const prevData: RoomsBlob = input.prev?.blob ?? {};

  // ── Work order ──
  // A quote with lines never saves an empty work order (the crew's Tasks tab and
  // the customer's progress list would go blank).
  const hasLines = rooms.some((r) => r.items.length > 0);
  const sourceSteps = input.steps.length === 0 && hasLines ? input.guideSteps : input.steps;
  const prevWO: WorkOrderTask[] = Array.isArray(prevData.workOrder) ? (prevData.workOrder as WorkOrderTask[]) : [];
  const prevWOByKey = new Map(prevWO.map((w) => [woKey(w), w]));
  // Prior tasks by quote-line id — a task whose line text was edited keeps its
  // `done` checkmark from the field (the text key changed).
  const prevWOByItem = new Map(prevWO.filter((w) => w.itemId).map((w) => [w.itemId as string, w]));
  const usedPrior = new Set<WorkOrderTask>();
  const tierByKey = new Map<string, TierKey[]>();
  const tierById = new Map<string, TierKey[]>();
  for (const r of rooms) {
    for (const it of r.items) {
      tierByKey.set(woKey({ room: r.name, detail: it.detail }), itemTiers(it));
      if (it.id) tierById.set(it.id, itemTiers(it));
    }
  }
  const workOrder: WorkOrderTask[] = sourceSteps.map((step) => {
    const key = woKey(step);
    const byItem = step.itemId ? prevWOByItem.get(step.itemId) : undefined;
    const byKey = prevWOByKey.get(key);
    const prior = byItem || (byKey && !usedPrior.has(byKey) ? byKey : undefined);
    if (prior) usedPrior.add(prior);
    const next: WorkOrderTask = {
      // editable fields — always from the new step
      room: step.room,
      detail: step.detail,
      action: step.action,
      pri: step.pri,
      hrs: step.hrs,
      tiers: (step.itemId && tierById.get(step.itemId)) || tierByKey.get(key) || ["base", "better", "best"],
      // completion state — inherited from the prior task, "not done" when new
      done: prior?.done === true,
      // link back to the quote line so the next edit (and WorkVision) can follow it
      ...(step.itemId ? { itemId: step.itemId } : {}),
      ...(step.custom ? { custom: true } : {}),
    };
    if (prior?.completed_at) next.completed_at = prior.completed_at;
    return next;
  });
  const droppedDone = prevWO
    .filter((w) => w.done && !usedPrior.has(w))
    .map((w) => `${w.room} — ${w.detail}`);

  // ── Photos: keep every existing one, append new ones by url ──
  const prevPhotos: Photo[] = Array.isArray(prevData.photos) ? (prevData.photos as Photo[]) : [];
  const seenUrls = new Set(prevPhotos.map((ph) => ph.url));
  const mergedPhotos = [...prevPhotos, ...jobPhotos.filter((ph) => !seenUrls.has(ph.url))];

  // ── The blob: prior first (unknown keys survive), then the keys QuoteForge owns ──
  const blob: RoomsBlob = {
    ...prevData,
    rooms,
    workers: input.workers,
    photos: mergedPhotos,
    workOrder,
    // Guide-tab state — the same keys WorkVision writes, so shopping-list adds
    // and checks stay in sync between the two views.
    customTools: input.guideState.customTools,
    customShop: input.guideState.customShop,
    checkedTools: input.guideState.checkedTools,
    checkedShop: input.guideState.checkedShop,
    removedGuideShop: input.guideState.removedGuideShop,
    // Per-quote overrides, written explicitly (not via the spread) so clearing
    // one clears the saved value instead of inheriting the old entry.
    discount: s.discount,
    laborRate: s.laborRate,
    minLaborHours: s.minLaborHours,
    taxMode: s.taxMode,
    // The materials sales-tax rate these prices include — kept with the quote so
    // a later change to the org setting can't reprice it.
    materialTaxPct: s.materialTaxPct,
    materialTaxZip: s.materialTaxZip,
    // Good-Better-Best. tierTotals / tierBreakdown are stored so the approval
    // page + approve API read each option's price without re-deriving the math.
    tieredQuote: s.tieredQuote,
    tierNames: s.tierNames,
    crewSize: s.crewSize,
    estDays: s.estDays,
    tierTotals: s.tieredQuote ? p.tierTotals : null,
    tierBreakdown: s.tieredQuote ? p.tierBreakdown : null,
    // Whether the options differ in SCOPE (not just price), so the customer picker
    // still shows for two distinct options at the same price.
    tierSplit: s.tieredQuote ? p.hasSplit : false,
    // Only overwrite `inspection` if the Inspector ran this session; otherwise
    // the saved one stays (the spread).
    ...(input.inspection ? {
      inspection: {
        type: input.inspection.inspection_type || "move-out",
        rooms: input.inspection.rooms.map((r) => ({
          name: r.name,
          sqft: r.sqft,
          width: r.width,
          length: r.length,
          items: r.items.map((it) => ({ name: it.name, condition: it.condition, comment: it.notes, photos: it.photos })),
        })),
        property: input.inspection.property,
        client: input.inspection.client,
      },
    } : {}),
  };

  // ── Status: new → "quoted"; an edit keeps its status, except lead → quoted ──
  const status = input.prev ? (input.prev.status === "lead" ? "quoted" : input.prev.status) : "quoted";

  // ── Totals: locked to the accepted option, else the headline option; plain
  //    quotes use the editor's totals. ──
  let total = p.gt, labor = p.tl, mat = p.tm, hrs = p.th;
  const acceptedTier = prevData.acceptedTier as string | undefined;
  if (s.tieredQuote) {
    const isAccepted = acceptedTier === "base" || acceptedTier === "better" || acceptedTier === "best";
    const key: TierKey = isAccepted ? (acceptedTier as TierKey) : p.headlineKey;
    total = p.tierTotals[key];
    labor = p.tierBreakdown[key].labor;
    mat = p.tierBreakdown[key].mat;
    hrs = p.tierBreakdown[key].hrs;
    // Prune the crew work order only once a specific option was accepted;
    // pre-approval keeps every task (legacy single-tier tasks fall back to the
    // cumulative reading via itemInTier).
    if (isAccepted) blob.workOrder = workOrder.filter((w) => itemInTier(w, key));
  }

  const row = {
    property: id.property,
    client: id.client || "",
    ...(id.customerId ? { customer_id: id.customerId } : {}),
    ...(id.addressId ? { address_id: id.addressId } : {}),
    // Only on create — re-saving an old quote must not move it to today.
    ...(id.editing ? {} : { job_date: id.today }),
    rooms: JSON.stringify(blob),
    total,
    total_labor: labor,
    total_mat: mat,
    total_hrs: hrs,
    status,
    trade: id.trade,
    created_by: id.createdBy,
  };

  return { row, blob, droppedDone };
}
