import type { MetadataRoute } from "next";
import { SITE, SERVICES } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = [
    "",
    "/services",
    ...SERVICES.map((s) => `/services/${s.slug}`),
    "/gallery",
    "/pricing",
    "/property-managers",
    "/about",
    "/churches",
    "/contact",
  ];
  return pages.map((p) => ({
    url: `${SITE.domain}${p}`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: p === "" ? 1 : 0.7,
  }));
}
