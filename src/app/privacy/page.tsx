import type { Metadata } from "next";
import MarketingShell from "@/components/marketing/MarketingShell";

export const metadata: Metadata = {
  title: "Privacy Policy · Creed Handy Manager",
  description: "How Creed Handy Manager collects, uses, and protects your data.",
};

const SECTIONS: { h: string; p: string }[] = [
  { h: "What we collect", p: "Account details (name, email), your business and customer records (jobs, quotes, schedules, photos, payments), and basic usage data needed to run the app. Customers who submit a lead or work order provide only the contact and job details they choose to share." },
  { h: "How we use it", p: "To provide the service — generate quotes, schedule crews, process payments, and send job notifications. We do not sell your data, and we don't use your business records to train models for anyone else." },
  { h: "Service providers", p: "We rely on trusted processors to operate: Supabase (database, authentication, file storage), Stripe (payments — handled in your own connected account), and AI providers (Anthropic, OpenAI) to generate quotes, transcriptions, and renders. Each processes data only to deliver that feature." },
  { h: "Payments", p: "Card payments are processed by Stripe through your own connected Stripe account. We never see or store full card numbers." },
  { h: "Data retention & deletion", p: "Your data is kept while your account is active. You can request export or deletion of your account and its data at any time by contacting us." },
  { h: "Security", p: "Data is encrypted in transit, access is scoped per organization, and we follow industry-standard practices to protect it. No method is 100% secure, but we work to keep your information safe." },
  { h: "Contact", p: "Questions about privacy or a data request? Email creedhandyman@gmail.com." },
];

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <div className="phead"><div className="wrap">
        <div className="kick">Legal</div>
        <div className="h1">Privacy <span className="g">Policy</span></div>
        <div className="lead">Plain-language summary of what we collect and how it's used. Last updated June 2026.</div>
      </div></div>
      <div className="wrap" style={{ maxWidth: 800, padding: "20px 24px 80px" }}>
        {SECTIONS.map((s) => (
          <div key={s.h} style={{ marginBottom: 26 }}>
            <h3 style={{ fontFamily: "Oswald, sans-serif", fontSize: 20, letterSpacing: ".3px", marginBottom: 8 }}>{s.h}</h3>
            <p style={{ color: "var(--mmuted)", fontSize: 15.5, lineHeight: 1.6 }}>{s.p}</p>
          </div>
        ))}
      </div>
    </MarketingShell>
  );
}
