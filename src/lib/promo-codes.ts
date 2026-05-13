import { db } from "./supabase";

/**
 * Promo codes that comp an org out of billing entirely. Stored client-side
 * because Bernard's intent is to comp HIS own deploys, not run a public
 * coupon program. If this app opens up to more orgs and the codes become
 * worth gaming, move validation behind a /api/promo-validate endpoint so
 * the code list isn't shipped to the browser.
 *
 * Apply path: a valid code sets `organizations.billing_enforced = false`,
 * which is the same flag BillingGate already short-circuits on (line 22).
 * The paywall and trial banner stop showing immediately on next render.
 */
const VALID_CODES = new Set<string>([
  "CREED971824",
]);

export function isValidPromoCode(code: string): boolean {
  return VALID_CODES.has(code.trim().toUpperCase());
}

export async function applyPromoCode(
  orgId: string,
  code: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!isValidPromoCode(code)) {
    return { ok: false, reason: "Invalid promo code" };
  }
  try {
    await db.patch("organizations", orgId, { billing_enforced: false });
    return { ok: true };
  } catch {
    return { ok: false, reason: "Could not apply code — try again" };
  }
}
