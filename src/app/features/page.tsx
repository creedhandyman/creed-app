import type { Metadata } from "next";
import Features from "@/components/marketing/Features";

export const metadata: Metadata = {
  title: "Handyman App Features: AI Quotes, Scheduling & Payroll · Creed Handy Manager",
  alternates: { canonical: "/features" },
  description:
    "AI quoting, AI “after” renders, hands-free Voice Walk inspections, crew scheduling & dispatch, Stripe payments, and crew quests — everything a handyman business needs, in one app.",
};

export default function FeaturesPage() {
  return <Features />;
}
