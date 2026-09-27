import type { Room } from "./types";
import { itemTiers, type TierKey } from "./tiers";
import { canonicalDetail, isSuppliesOnlyLine } from "./line-canon";

/**
 * Customer quote approval (the /status "Approve & Sign") → what the printed
 * quote needs to show it.
 *
 * The signature itself lives on the job row (`client_signature` = typed name
 * or a `data:image/png` of the inked canvas, `signature_date`, `approved_at`).
 * /api/jobs/approve ALSO stamps an `approval` record onto the rooms blob:
 * a fingerprint of the line items that were on the quote when it was signed,
 * plus the approved amount. The PDF only prints the signature while the
 * items it's printing still match that fingerprint — a quote revised after
 * the customer signed (edited items, a later upsell) must not carry their
 * signature onto work they never approved. Approvals from before the record
 * existed have no fingerprint and print as signed (nothing to compare); see
 * approvalState for the full rules.
 */

export interface ApprovalRecord {
  v: 1;
  /** scopeFingerprint(blob.rooms) at the moment of signing. */
  fp: string;
  /** The amount the customer approved (the picked option's total for a
   *  Good-Better-Best quote, else the quote total they were shown). */
  total: number;
  /** Server ISO timestamp of the approval. */
  at: string;
  tier?: TierKey;
}

/** Everything exportQuotePdf needs to render a signed quote. */
export interface QuoteApproval {
  signature: string;
  approvedAt?: string;
  signatureDate?: string;
  record?: ApprovalRecord | null;
  acceptedTier?: TierKey | null;
}

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const num = (n: unknown, dp: number) => {
  const v = Number(n);
  const f = 10 ** dp;
  return Number.isFinite(v) ? String(Math.round(v * f) / f) : "0";
};

/**
 * Order-insensitive fingerprint of a quote's billable scope: every line's
 * task text, hours, priced materials and Good-Better-Best membership. Room
 * (trade bucket) names, item ids, $0 placeholder materials and line order are
 * deliberately left out, and the task text + hours are taken in validateQuote's
 * canonical form (line-canon.ts) — reopening a saved quote in QuoteForge
 * re-runs validateQuote, which re-buckets and re-ids items, prefixes bare
 * details with their room ("Replace faucet" → "Plumbing — …" → "Whole
 * Property — …") and zeroes supplies-line hours, none of which changes the
 * customer's scope or may read as "revised".
 */
export function scopeFingerprint(rooms: Room[] | null | undefined): string {
  // Every line counts — a duplicated line (billed twice) is a real change.
  const lines: string[] = [];
  for (const r of Array.isArray(rooms) ? rooms : []) {
    for (const it of Array.isArray(r?.items) ? r.items : []) {
      const raw = String(it?.detail ?? "");
      const detail = canonicalDetail(raw, String(r?.name ?? ""));
      // validateQuote zeroes a supplies line's hours (checked on the detail
      // it had at the time) — so both forms count as zero here.
      const hrs = isSuppliesOnlyLine(raw) || isSuppliesOnlyLine(detail) ? 0 : it?.laborHrs;
      const mats = (Array.isArray(it?.materials) ? it.materials : [])
        .filter((m) => (Number(m?.c) || 0) > 0)
        .map((m) => `${norm(m.n)}=${num(m.c, 2)}`)
        .sort()
        .join(",");
      const tiers = itemTiers(it).slice().sort().join("+");
      lines.push(`${norm(detail)}|${num(hrs, 2)}|${mats}|${tiers}`);
    }
  }
  // FNV-1a (32-bit) over the sorted lines — a change detector, not security.
  const s = lines.slice().sort().join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0") + ":" + lines.length;
}

/**
 * Approvals from this moment on always get a record written with them (it
 * sits safely after the deploy that started writing records). Before it, a
 * missing record just means "approved before records existed".
 */
const RECORD_SINCE_MS = Date.parse("2026-09-28T06:00:00Z");

/**
 * How a signed quote should print, given the items about to be printed:
 *   signed     — the items still match what the customer approved (or it's a
 *                pre-record approval there's nothing to compare against);
 *   revised    — the quote changed after they signed (items edited/added, or
 *                a picked Good-Better-Best option printed without the options);
 *   unverified — approved, but the record of WHAT was approved is missing
 *                (an in-app save working from a stale copy of the job, within
 *                the ~15s before it refreshed, rewrote the blob without it), so
 *                we can't show their signature against any particular version.
 */
export type ApprovalState = "signed" | "revised" | "unverified";

export function approvalState(
  a: QuoteApproval,
  rooms: Room[] | null | undefined,
  opts: { tiersShown: boolean },
): ApprovalState {
  const pickedTier = !!(a.record?.tier || a.acceptedTier);
  if (a.record) {
    if (a.record.fp !== scopeFingerprint(rooms)) return "revised";
    return pickedTier && !opts.tiersShown ? "revised" : "signed";
  }
  const at = a.approvedAt ? Date.parse(a.approvedAt) : NaN;
  if (Number.isFinite(at) && at >= RECORD_SINCE_MS) return "unverified";
  return pickedTier && !opts.tiersShown ? "revised" : "signed";
}

const isTier = (t: unknown): t is TierKey => t === "base" || t === "better" || t === "best";

/** Parse the blob's approval record, tolerating anything malformed. */
export function readApprovalRecord(blob: unknown): ApprovalRecord | null {
  const a = (blob as { approval?: Partial<ApprovalRecord> } | null)?.approval;
  if (!a || typeof a !== "object" || typeof a.fp !== "string" || !a.fp) return null;
  return {
    v: 1,
    fp: a.fp,
    total: typeof a.total === "number" && Number.isFinite(a.total) ? a.total : 0,
    at: typeof a.at === "string" ? a.at : "",
    ...(isTier(a.tier) ? { tier: a.tier } : {}),
  };
}

/** Build the PDF approval input from a job row (null when it isn't signed). */
export function quoteApprovalFromJob(job: {
  client_signature?: string | null;
  signature_date?: string | null;
  approved_at?: string | null;
  rooms?: unknown;
} | null | undefined): QuoteApproval | null {
  const signature = typeof job?.client_signature === "string" ? job.client_signature.trim() : "";
  if (!signature) return null;
  let blob: Record<string, unknown> | null = null;
  try {
    const raw = job?.rooms;
    blob = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown> | null) ?? null;
  } catch {
    blob = null;
  }
  const record = readApprovalRecord(blob);
  const at = blob?.acceptedTier;
  return {
    signature,
    approvedAt: job?.approved_at || undefined,
    signatureDate: job?.signature_date || undefined,
    record,
    acceptedTier: isTier(at) ? at : record?.tier ?? null,
  };
}
