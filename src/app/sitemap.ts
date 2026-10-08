import type { MetadataRoute } from "next";
import { SEO_ORIGIN } from "@/lib/seo";

/** /sitemap.xml — the public marketing pages, on the canonical www origin.
 *  Add a page here when it gets a canonical (alternates.canonical) of its own. */
const PAGES: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/features", priority: 0.9 },
  { path: "/pricing", priority: 0.9 },
  { path: "/contact", priority: 0.5 },
  { path: "/privacy", priority: 0.3 },
  { path: "/terms", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((p) => ({
    url: p.path === "/" ? SEO_ORIGIN : `${SEO_ORIGIN}${p.path}`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: p.priority,
  }));
}
