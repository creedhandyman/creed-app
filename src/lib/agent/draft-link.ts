/**
 * Signed, short-lived link to a draft quote's printable PDF page. A purpose
 * of its own ("draft-pdf"), so it can never be used as the approval token
 * (lib/job-token.ts) — it only lets someone VIEW one draft for 7 days.
 */
import { createHmac, timingSafeEqual } from "crypto";

export const DRAFT_LINK_DAYS = 7;

function secret(): string {
  const s = process.env.PORTAL_SESSION_SECRET;
  if (!s) throw new Error("PORTAL_SESSION_SECRET is not set");
  return s;
}

function sign(jobId: string, exp: number): string {
  return createHmac("sha256", secret()).update(`draft-pdf:${jobId}:${exp}`).digest("hex").slice(0, 40);
}

export function draftPdfQuery(jobId: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + DRAFT_LINK_DAYS * 86400;
  return `job=${encodeURIComponent(jobId)}&exp=${exp}&sig=${sign(jobId, exp)}`;
}

export function verifyDraftPdf(jobId: string, exp: string | null, sig: string | null, now = Date.now()): boolean {
  const e = Number(exp);
  if (!jobId || !sig || !Number.isInteger(e) || e * 1000 < now) return false;
  const want = Buffer.from(sign(jobId, e));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
