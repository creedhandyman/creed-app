/**
 * New-business sign-up alerts for Creed itself (the platform owner, not a
 * customer business). Pure helpers for the hourly cron at
 * /api/admin/signups: which stretch of time a run covers, and what the email
 * says. The route does the reading and sending.
 */

/** Where the alert goes unless SIGNUP_NOTIFY_EMAIL says otherwise. */
export const DEFAULT_SIGNUP_NOTIFY_EMAIL = "bernard@creedhm.com";

const HOUR = 3_600_000;
/** A run never reaches further back than this, so a long outage cannot
 *  produce a flood of week-old "new sign-up" emails. */
export const MAX_LOOKBACK_MS = 48 * HOUR;
/** With no earlier run on record, cover the last hour only: the first run
 *  must not announce every business that already exists. */
export const FIRST_RUN_LOOKBACK_MS = HOUR;

/**
 * The stretch a run reports on: after `since`, up to and including `until`.
 * `lastUntil` is where the previous successful run stopped (ISO), if any.
 */
export function signupWindow(nowMs: number, lastUntil?: string | null): { since: string; until: string } {
  const last = lastUntil ? Date.parse(lastUntil) : NaN;
  const floor = nowMs - MAX_LOOKBACK_MS;
  const since = Number.isFinite(last) && last <= nowMs ? Math.max(last, floor) : nowMs - FIRST_RUN_LOOKBACK_MS;
  return { since: new Date(since).toISOString(), until: new Date(nowMs).toISOString() };
}

export interface NewSignup {
  name: string | null;
  created_at: string;
  owner_name?: string | null;
  owner_email?: string | null;
  phone?: string | null;
  primary_trade?: string | null;
  plan?: string | null;
  subscription_status?: string | null;
}

const line = (label: string, value?: string | null) => (value && value.trim() ? `${label}: ${value.trim()}` : null);

/** One email per run, covering every business created in the window. */
export function signupEmail(signups: NewSignup[], totalBusinesses: number): { subject: string; body: string } {
  const n = signups.length;
  const first = signups[0]?.name?.trim() || "a new business";
  const subject = n === 1
    ? `New Creed Handy Manager sign-up: ${first}`
    : `${n} new Creed Handy Manager sign-ups`;
  const blocks = signups.map((s) => [
    s.name?.trim() || "(no business name yet)",
    line("Owner", [s.owner_name?.trim(), s.owner_email?.trim() ? `<${s.owner_email.trim()}>` : ""].filter(Boolean).join(" ")),
    line("Phone", s.phone),
    line("Trade", s.primary_trade),
    line("Plan", [s.plan, s.subscription_status].filter((x) => x && x.trim()).join(", ")),
    `Signed up: ${s.created_at}`,
  ].filter(Boolean).join("\n"));
  const body = [
    n === 1 ? "A new business created an account on Creed Handy Manager." : `${n} new businesses created accounts on Creed Handy Manager.`,
    "",
    blocks.join("\n\n"),
    "",
    `Businesses on the platform now: ${totalBusinesses}`,
  ].join("\n");
  return { subject, body };
}
