// Customer referrals: the pure rules, shared by the app, the portal and the
// server. A customer's link is the business's own quote request form
// (/lead/[slug]) with their code on it (?ref=…); /api/leads credits the
// referrer when a NEW customer comes in through it, and lib/referrals-server.ts
// turns that into an earned credit once the new customer pays.
// Tested in src/__tests__/referrals.test.ts.

export type ReferralStatus = "pending" | "earned" | "applied" | "void";

export interface CustomerReferral {
  id: string;
  org_id: string;
  referrer_customer_id: string;
  referred_customer_id: string;
  lead_job_id?: string | null;
  status: ReferralStatus;
  reward_cents?: number | null;
  earned_at?: string | null;
  earned_job_id?: string | null;
  applied_at?: string | null;
  applied_job_id?: string | null;
  created_at?: string;
}

/** The label a referral credit carries on a quote's discount line. */
export const REFERRAL_DISCOUNT_LABEL = "Referral credit";

/** Codes are 6-16 lowercase letters/digits. Anything else = no code. */
export function normalizeRefCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return /^[a-z0-9]{6,16}$/.test(s) ? s : null;
}

/** A customer's share link, or null when the business has no public form. */
export function referralLink(
  origin: string,
  org: { site_slug?: string | null; site_published?: boolean | null },
  code: string | null | undefined,
): string | null {
  const c = normalizeRefCode(code);
  if (!c || !org.site_slug || org.site_published === false) return null;
  return `${origin.replace(/\/+$/, "")}/lead/${encodeURIComponent(org.site_slug)}?ref=${c}`;
}

/**
 * Should a lead that came in on a referral link credit the referrer?
 * Only for a customer this lead created (someone already on file isn't new
 * business), never for referring yourself, and only while referrals are on.
 */
export function shouldCreditReferral(input: {
  enabled: boolean;
  referrerId: string | null;
  leadCustomerId: string | null;
  createdNewCustomer: boolean;
}): boolean {
  return (
    input.enabled &&
    !!input.referrerId &&
    !!input.leadCustomerId &&
    input.createdNewCustomer &&
    input.referrerId !== input.leadCustomerId
  );
}

/** Dollars of earned, not-yet-used credit a customer has. */
export function availableCreditCents(rows: Pick<CustomerReferral, "status" | "reward_cents">[]): number {
  return rows
    .filter((r) => r.status === "earned")
    .reduce((s, r) => s + Math.max(0, Number(r.reward_cents) || 0), 0);
}

export const fmtCents = (c: number): string =>
  `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  pending: "Requested work",
  earned: "Credit earned",
  applied: "Credit used",
  void: "Cancelled",
};
