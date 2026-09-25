import type { Metadata } from "next";
import { SITE, CITY_PAGES } from "@/lib/site";
import CityPage from "@/components/CityPage";

const data = CITY_PAGES.find((c) => c.slug === "handyman-derby-ks")!;

export const metadata: Metadata = {
  title: "Handyman in Derby, KS",
  description: `Creed Handyman serves Derby with plumbing, electrical, drywall, doors, mounting, and make-ready work. ${SITE.rate}/hr, two-hour minimum, quoted before the work starts. Call ${SITE.phone}.`,
  alternates: { canonical: "/handyman-derby-ks" },
};

export default function DerbyPage() {
  return <CityPage data={data} />;
}
