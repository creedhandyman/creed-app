/**
 * The one production origin search engines should index. Every marketing
 * page's canonical URL, the sitemap and robots.txt point here.
 *
 * Hardcoded on purpose (not NEXT_PUBLIC_SITE_URL): a canonical must name the
 * production www host even on preview deploys, and the apex creedhm.com
 * serves the same pages — without one agreed origin Google splits the site
 * into two duplicates. Customer-facing links (magic links etc.) keep using
 * site-url.ts siteOrigin(), which honours the env var.
 */
export const SEO_ORIGIN = "https://www.creedhm.com";
