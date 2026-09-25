import type { Metadata } from "next";
import { SITE, CITY_PAGES } from "@/lib/site";
import CityPage from "@/components/CityPage";

const data = CITY_PAGES.find((c) => c.slug === "handyman-haysville-ks")!;

export const metadata: Metadata = {
  title: "Handyman in Haysville, KS",
  description: `Creed Handyman serves Haysville with plumbing, drywall, flooring, deck, and door work. ${SITE.rate}/hr, two-hour minimum, quoted before the work starts. Call ${SITE.phone}.`,
  alternates: { canonical: "/handyman-haysville-ks" },
};

export default function HaysvillePage() {
  return <CityPage data={data} />;
}
