import type { MetadataRoute } from "next";
import { SEO_ORIGIN } from "@/lib/seo";

/** /robots.txt — marketing pages open to crawlers; private app surfaces
 *  (customer quote/status links, the portal, payments, admin, the API) out. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin",
          "/portal",
          "/status",
          "/payment",
          "/onboarding",
          "/reset-password",
        ],
      },
    ],
    sitemap: `${SEO_ORIGIN}/sitemap.xml`,
    host: SEO_ORIGIN,
  };
}
