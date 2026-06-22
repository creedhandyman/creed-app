import type { Metadata } from "next";
import MarketingShell from "@/components/marketing/MarketingShell";
import Login from "@/components/Login";

export const metadata: Metadata = {
  title: "Sign in · Creed Handy Manager",
  description: "Sign in to Creed Handy Manager, or create your account and start your free month — AI quoting, crew scheduling, and Stripe payments in one app.",
};

export default function SignInPage() {
  return (
    <MarketingShell>
      <Login />
    </MarketingShell>
  );
}
