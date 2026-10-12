import type { Metadata } from "next";
import { SITE, CITY_PAGES } from "@/lib/site";
import CityPage from "@/components/CityPage";

const data = CITY_PAGES.find((c) => c.slug === "handyman-bel-aire-ks")!;

export const metadata: Metadata = {
  title: "Handyman in Bel Aire, KS",
  description: `Creed Handyman serves Bel Aire with closet and garage doors, door trim and sills, fence and deck boards, plumbing leaks, drywall, and paint. ${SITE.rate}/hr, two-hour minimum, quoted before the work starts. Call ${SITE.phone}.`,
  alternates: { canonical: "/handyman-bel-aire-ks" },
};

export default function BelAirePage() {
  return <CityPage data={data} />;
}
