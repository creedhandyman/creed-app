// Canonical, TRUSTED site origin for building customer-facing links
// (magic links we text/email, etc.). Mirrors app/layout.tsx's SITE_URL.
//
// SECURITY: never derive customer-facing link origins from the request
// Host/Origin header. An attacker who can trigger a link (e.g. the public
// /api/portal/request-link[-email] endpoints) could otherwise spoof Host to
// point the emailed/texted magic link at their own domain and capture the
// one-time portal token when the victim clicks it (open redirect → token
// theft). Pinning to a configured origin closes that.

/** Trusted absolute origin, no trailing slash. Override with NEXT_PUBLIC_SITE_URL. */
export function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://creedhm.com").replace(/\/+$/, "");
}

/**
 * Absolute URL of the one-time portal magic-link redeem PAGE (not the API).
 * The page only redeems via client JS, so SMS/email link-preview bots that
 * GET the URL can't consume the single-use token.
 */
export function portalRedeemUrl(token: string): string {
  return `${siteOrigin()}/portal/redeem/${encodeURIComponent(token)}`;
}
