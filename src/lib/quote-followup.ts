// Quote follow-up rules — PURE (no db, no clock), shared by the view-tracking
// route, the follow-up cron and the Jobs list. Tested in
// src/__tests__/quote-followup.test.ts.
//
// Two features live here:
//   1. "Opened" alerts — when a customer opens the /status quote link the owner
//      is told (first open always; a re-open only after a quiet gap, so a
//      customer flipping back and forth doesn't buzz the owner every minute).
//   2. Automatic follow-ups — an unanswered quote gets up to two nudges.
//      "Last contact" = the later of quote_sent_at (a manual follow-up re-stamps
//      it) and quote_followup_at, so an owner who already chased by hand isn't
//      chased again by the robot.
import { tryReadBlob } from "./job-blob";

/** Days since the last contact before follow-up #1 and #2 are due. */
export const FOLLOWUP_GAP_DAYS = [2, 3] as const;
export const MAX_FOLLOWUPS = FOLLOWUP_GAP_DAYS.length;
/** A re-open only alerts the owner after this many quiet hours. */
export const VIEW_RENOTIFY_HOURS = 4;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface FollowupJob {
  status?: string | null;
  archived?: boolean | null;
  quote_sent_at?: string | null;
  quote_followup_at?: string | null;
  quote_followup_count?: number | null;
  quote_view_count?: number | null;
  rooms?: unknown;
}

const ms = (iso?: string | null): number => {
  const n = Date.parse(iso || "");
  return Number.isFinite(n) ? n : NaN;
};

/** When we last reached out about this quote (ms), or NaN if never. */
export function lastContactMs(job: FollowupJob): number {
  const a = ms(job.quote_sent_at);
  const b = ms(job.quote_followup_at);
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return Math.max(a, b);
}

/** Has the customer already signed? (A quoted job with an approval record is
 *  waiting on the owner, not the customer.) */
function isApproved(rooms: unknown): boolean {
  const a = tryReadBlob(rooms)?.approval;
  return !!a && typeof a === "object";
}

/**
 * Which follow-up (1 or 2) is due right now, or null. Only a SENT, still
 * "quoted", unsigned, unarchived quote qualifies; each step waits
 * FOLLOWUP_GAP_DAYS[step-1] days after the last contact.
 */
export function followupDue(job: FollowupJob, now: number): 1 | 2 | null {
  if (job.status !== "quoted" || job.archived) return null;
  if (isApproved(job.rooms)) return null;
  const done = Math.max(0, Math.floor(Number(job.quote_followup_count) || 0));
  if (done >= MAX_FOLLOWUPS) return null;
  const last = lastContactMs(job);
  if (Number.isNaN(last)) return null; // never sent → nothing to follow up on
  if (now - last < FOLLOWUP_GAP_DAYS[done] * DAY_MS) return null;
  return (done + 1) as 1 | 2;
}

/** Should this open of the quote link alert the owner? */
export function shouldNotifyView(prevViewedAt: string | null | undefined, prevCount: number | null | undefined, now: number): boolean {
  if (!(Number(prevCount) > 0)) return true; // first open
  const prev = ms(prevViewedAt);
  if (Number.isNaN(prev)) return true;
  return now - prev >= VIEW_RENOTIFY_HOURS * HOUR_MS;
}

/** "1st" / "2nd" / "3rd" / "4th"… for owner-facing copy. */
export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`;
}

/** Link-preview bots / crawlers — not a customer opening the quote. */
export function looksLikeBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent || "").trim();
  if (!ua) return true;
  return /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|headless|lighthouse|curl|wget|python-requests|node-fetch|axios/i.test(ua);
}

export type FollowupChannel = "sms" | "email" | "owner";

/**
 * How a follow-up goes out. Text only with the customer's recorded opt-in and
 * a phone on file (A2P 10DLC / CTIA — see sms-consent.ts); otherwise email if
 * we have one; otherwise it's the OWNER's job — they get an alert to text the
 * customer themselves (person-to-person, no consent needed).
 */
export function followupChannel(o: { consent: boolean; phone?: string | null; email?: string | null }): FollowupChannel {
  if (o.consent && (o.phone || "").trim()) return "sms";
  if ((o.email || "").includes("@")) return "email";
  return "owner";
}

/** First word of a name, or "there". */
export function firstName(full?: string | null): string {
  return (full || "").trim().split(/\s+/)[0] || "there";
}

/** The customer-facing text. Plain and short, in the owner's voice. */
export function followupMessage(o: {
  step: 1 | 2;
  customer?: string | null;
  business?: string | null;
  property?: string | null;
  link: string;
  /** The customer has already opened the quote. */
  viewed: boolean;
}): string {
  const hi = `Hi ${firstName(o.customer)}, it's ${(o.business || "").trim() || "us"}.`;
  const what = (o.property || "").trim() ? `the quote for ${(o.property || "").trim()}` : "your quote";
  if (o.step === 2) {
    return `${hi} Checking in one more time on ${what}. If the timing isn't right, no problem, just let me know. ${o.link}`;
  }
  return o.viewed
    ? `${hi} I saw you had a chance to look at ${what}. Any questions? Happy to adjust anything. ${o.link}`
    : `${hi} Just making sure you got ${what}. Here's the link: ${o.link}`;
}
