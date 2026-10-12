/**
 * The one place a quote approval is applied to a job — shared by the
 * customer's online approval (/api/jobs/approve) and an approval the owner
 * records for a customer who doesn't do it online (/api/jobs/record-approval),
 * so both lock the job exactly the same way:
 *   - status quoted → accepted;
 *   - Good-Better-Best: the picked option sets the job total + labor/material/
 *     hour totals (from the blob's stored tierTotals/tierBreakdown, computed by
 *     the editor's pricing cascade) and the crew work order is cut down to that
 *     option's tasks; `acceptedTier` is stamped;
 *   - an approval record (scope fingerprint + approved amount, + how it was
 *     approved) goes on the rooms blob so the PDF knows what was signed.
 */
import { itemInTier, type TierKey } from "./tiers";
import { scopeFingerprint, type ApprovalRecord, type ApprovalVia } from "./approval";

type JobRow = { status?: string | null; rooms?: unknown; total?: number | string | null };

export function applyApproval(
  job: JobRow,
  opts: { signature: string; tier?: TierKey | null; nowIso: string; via?: ApprovalVia; by?: string; signer?: string; ip?: string | null },
): { patch: Record<string, unknown>; blob: Record<string, unknown> | null; approval: ApprovalRecord | null } {
  const patch: Record<string, unknown> = {
    client_signature: opts.signature,
    signature_date: new Date(opts.nowIso).toLocaleDateString(),
    approved_at: opts.nowIso,
    approved_ip: opts.ip || null,
  };
  if (job.status === "quoted") patch.status = "accepted";

  let blob: Record<string, unknown> | null = null;
  try {
    const raw = typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms;
    blob = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    blob = null; // malformed blob — approve on the stored total, no record
  }

  const tier = opts.tier;
  if (blob && (tier === "base" || tier === "better" || tier === "best")) {
    const tt = blob.tierTotals as Record<string, number> | undefined;
    if (blob.tieredQuote === true && tt && typeof tt[tier] === "number" && tt[tier] >= 0) {
      patch.total = tt[tier];
      blob.acceptedTier = tier;
      const bk = (blob.tierBreakdown as Record<string, { labor?: number; mat?: number; hrs?: number }> | undefined)?.[tier];
      if (bk) {
        if (typeof bk.labor === "number") patch.total_labor = bk.labor;
        if (typeof bk.mat === "number") patch.total_mat = bk.mat;
        if (typeof bk.hrs === "number") patch.total_hrs = bk.hrs;
      }
      // Tasks carry their line's option membership; untagged/legacy tasks
      // fall back to itemInTier's cumulative reading (never silently hidden).
      if (Array.isArray(blob.workOrder)) {
        blob.workOrder = (blob.workOrder as { tier?: string; tiers?: TierKey[] }[]).filter((w) => itemInTier(w, tier));
      }
    }
  }

  let approval: ApprovalRecord | null = null;
  if (blob) {
    const at = blob.acceptedTier;
    approval = {
      v: 1,
      fp: scopeFingerprint(Array.isArray(blob.rooms) ? (blob.rooms as never) : []),
      total: typeof patch.total === "number" ? patch.total : Number(job.total) || 0,
      at: opts.nowIso,
      ...(at === "base" || at === "better" || at === "best" ? { tier: at as TierKey } : {}),
      ...(opts.via && opts.via !== "online" ? { via: opts.via } : {}),
      ...(opts.by ? { by: opts.by.slice(0, 80) } : {}),
      ...(opts.signer ? { signer: opts.signer.slice(0, 100) } : {}),
    };
    blob.approval = approval;
  }
  return { patch, blob, approval };
}
