import { apiFetch } from "./api";

/**
 * Apply a comp code to the current org.
 *
 * Validation and the `billing_enforced` write now happen SERVER-SIDE
 * (/api/promo/apply): the valid-code list is no longer shipped to the browser,
 * and the entitlement write goes through the service role after an owner-session
 * check — so a logged-in user can no longer comp themselves from the console.
 * The valid codes live in the PROMO_CODES env var on the server.
 *
 * `orgId` is kept in the signature for the existing call sites, but the server
 * derives the org from the authenticated session and does not trust it.
 */
export async function applyPromoCode(
  _orgId: string,
  code: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await apiFetch("/api/promo/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return { ok: false, reason: data.error || "Invalid promo code" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "Could not apply code — try again" };
  }
}
