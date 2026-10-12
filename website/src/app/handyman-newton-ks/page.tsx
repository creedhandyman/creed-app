import type { Metadata } from "next";
import { SITE, CITY_PAGES } from "@/lib/site";
import CityPage from "@/components/CityPage";

const data = CITY_PAGES.find((c) => c.slug === "handyman-newton-ks")!;

export const metadata: Metadata = {
  title: "Handyman in Newton, KS",
  description: `Creed Handyman serves Newton with rental make-ready turnovers, move-out inspections, vinyl plank flooring, plumbing, and electrical fixes. ${SITE.rate}/hr, two-hour minimum, quoted before the work starts. Call ${SITE.phone}.`,
  alternates: { canonical: "/handyman-newton-ks" },
};

export default function NewtonPage() {
  return <CityPage data={data} />;
}
