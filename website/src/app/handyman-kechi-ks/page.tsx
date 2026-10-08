import type { Metadata } from "next";
import { SITE, CITY_PAGES } from "@/lib/site";
import CityPage from "@/components/CityPage";

const data = CITY_PAGES.find((c) => c.slug === "handyman-kechi-ks")!;

export const metadata: Metadata = {
  title: "Handyman in Kechi, KS",
  description: `Creed Handyman serves Kechi with doors and locks, fence gates, floors and subfloors, outlets and fixtures, and patch-and-paint. ${SITE.rate}/hr, two-hour minimum, quoted before the work starts. Call ${SITE.phone}.`,
  alternates: { canonical: "/handyman-kechi-ks" },
};

export default function KechiPage() {
  return <CityPage data={data} />;
}
