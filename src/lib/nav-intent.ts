/**
 * Cross-screen deep-link contract — "open Jobs on Billing, filtered to unpaid",
 * "open Schedule on today's Day view", "open Time on Crew".
 *
 * AppShell routes by page name only (setPage), so the extra detail rides in a
 * short-lived sessionStorage note the destination screen reads once on mount:
 *
 *   c_nav_intent = { page, tab?, filter?, jobId?, at }   (at = Date.now())
 *
 * A note is honoured only by the page it names and only within
 * NAV_INTENT_TTL_MS of being written, so a stale one (back button an hour
 * later, a refresh) is ignored and the screen opens as usual. Blocked storage
 * (private mode) just degrades to a plain navigation — never throws.
 *
 * Readers: Jobs.tsx, Schedule.tsx, Timer.tsx. Writers: DayCards (Home),
 * Dashboard, FlipDashboard, Schedule, Operations, Financials, QuoteForge —
 * all through this module, so the shape and the TTL live only here.
 */

export const NAV_INTENT_KEY = "c_nav_intent";
export const NAV_INTENT_TTL_MS = 15000;

export type NavIntent =
  | {
      page: "jobs";
      tab?: "active" | "billing" | "paid" | "archive";
      filter?: "lead" | "toSend" | "waiting" | "toInvoice" | "unpaid";
      jobId?: string;
    }
  | { page: "sched"; tab?: "day" | "week" | "month" | "dispatch" }
  | { page: "time"; tab?: "time" | "crew" };

export function setNavIntent(i: NavIntent): void {
  try {
    sessionStorage.setItem(NAV_INTENT_KEY, JSON.stringify({ ...i, at: Date.now() }));
  } catch { /* blocked storage → plain nav */ }
}

/** Write the intent, then navigate to its page. */
export function goWithIntent(setPage: (p: string) => void, i: NavIntent) {
  setNavIntent(i);
  setPage(i.page);
}

/** The pending intent for `page`, or null when there is none, it names a
 *  different page, it's older than the TTL, or it's malformed. Doesn't
 *  consume it — call clearNavIntent() once it's been applied. */
export function peekNavIntent(page: string): (NavIntent & { at: number }) | null {
  try {
    const raw = sessionStorage.getItem(NAV_INTENT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || v.page !== page || typeof v.at !== "number" || Date.now() - v.at > NAV_INTENT_TTL_MS) return null;
    return v as NavIntent & { at: number };
  } catch {
    return null;
  }
}

/** Consume the pending intent. With `page`, only when it names that page
 *  (fresh or stale) — a note meant for another screen is left alone. */
export function clearNavIntent(page?: string): void {
  try {
    if (page !== undefined) {
      const raw = sessionStorage.getItem(NAV_INTENT_KEY);
      if (!raw || JSON.parse(raw)?.page !== page) return;
    }
    sessionStorage.removeItem(NAV_INTENT_KEY);
  } catch { /* blocked storage / malformed note */ }
}
