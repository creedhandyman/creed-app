import type { Metadata } from "next";
import { SITE, CITY_PAGES } from "@/lib/site";
import CityPage from "@/components/CityPage";

const data = CITY_PAGES.find((c) => c.slug === "handyman-goddard-ks")!;

export const metadata: Metadata = {
  title: "Handyman in Goddard, KS",
  description: `Creed Handyman serves Goddard with mounting, assembly, fixture upgrades, drywall, and full handyman work. ${SITE.rate}/hr, two-hour minimum, quoted before the work starts. Call ${SITE.phone}.`,
  alternates: { canonical: "/handyman-goddard-ks" },
};

export default function GoddardPage() {
  return <CityPage data={data} />;
}
