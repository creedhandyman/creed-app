import type { Metadata } from "next";
import { SITE, CITY_PAGES } from "@/lib/site";
import CityPage from "@/components/CityPage";

const data = CITY_PAGES.find((c) => c.slug === "handyman-andover-ks")!;

export const metadata: Metadata = {
  title: "Handyman in Andover, KS",
  description: `Creed Handyman serves Andover with deck repairs and restaining, storm-damage fixes for garage doors, gates, and sheds, plumbing, and general repairs. ${SITE.rate}/hr, two-hour minimum, quoted before the work starts. Call ${SITE.phone}.`,
  alternates: { canonical: "/handyman-andover-ks" },
};

export default function AndoverPage() {
  return <CityPage data={data} />;
}
