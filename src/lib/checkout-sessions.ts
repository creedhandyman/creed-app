/**
 * One live checkout per job.
 *
 * Every "Pay" tap (status page, owner's Collect now / pay link) makes a NEW
 * Stripe Checkout session, and the amount is clamped to the balance at that
 * moment. Two sessions opened before either is paid (the customer's phone and
 * then their computer, or the owner's QR and the texted link) could both be
 * paid, charging the job twice. So before a new session is made, any session
 * for the same job that is still open is expired, and each session lives at
 * most CHECKOUT_TTL_SEC instead of Stripe's default 24 hours.
 *
 * Best-effort: a Stripe hiccup here never blocks the customer from paying —
 * the overpayment refund in payment-fulfillment.ts is the backstop.
 */

/** Session lifetime: 1 hour (Stripe accepts 30 min to 24 h). */
export const CHECKOUT_TTL_SEC = 60 * 60;

/** Sessions made before this change lived 24 h, so look back a little further. */
const LOOKBACK_SEC = 25 * 60 * 60;

/** Stop paging after this many open sessions (they're short-lived; a normal
 *  account has a handful). */
const MAX_SCAN = 300;

export interface OpenSession {
  id: string;
  metadata?: Record<string, string> | null;
}

/** The slice of the Stripe client this needs (injectable for tests). */
export interface CheckoutSessionsApi {
  list(params: {
    status: "open";
    created: { gte: number };
    limit: number;
    starting_after?: string;
  }): Promise<{ data: OpenSession[]; has_more: boolean }>;
  expire(id: string): Promise<unknown>;
}

/** Unix seconds when a session made now should expire. */
export function checkoutExpiresAt(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000) + CHECKOUT_TTL_SEC;
}

/**
 * Expire every still-open Checkout session for `jobId`. Returns the ids it
 * expired. Never throws.
 */
export async function expireOpenJobSessions(
  api: CheckoutSessionsApi,
  jobId: string,
  nowMs: number = Date.now(),
): Promise<string[]> {
  const expired: string[] = [];
  try {
    const gte = Math.floor(nowMs / 1000) - LOOKBACK_SEC;
    let startingAfter: string | undefined;
    let scanned = 0;
    for (;;) {
      const page = await api.list({ status: "open", created: { gte }, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
      for (const s of page.data) {
        if (s.metadata?.job_id !== jobId) continue;
        try {
          await api.expire(s.id);
          expired.push(s.id);
        } catch {
          // Already completed or expired in the meantime — nothing to do.
        }
      }
      scanned += page.data.length;
      if (!page.has_more || !page.data.length || scanned >= MAX_SCAN) break;
      startingAfter = page.data[page.data.length - 1].id;
    }
  } catch (e) {
    console.error("[checkout] couldn't expire older sessions:", e instanceof Error ? e.message : e);
  }
  return expired;
}

/**
 * Where Stripe's "back" link returns the customer. From the job's /status page
 * → that page. From a /pay link → the job's /status page (going back to /pay
 * would just open a new checkout). Anything else → the generic cancel page.
 */
export function checkoutCancelUrl(origin: string, referer: string): string {
  if (referer.startsWith(`${origin}/status?`)) return referer;
  if (referer.startsWith(`${origin}/pay?`)) return `${origin}/status?${referer.slice(`${origin}/pay?`.length)}`;
  return `${origin}/payment/cancel`;
}
