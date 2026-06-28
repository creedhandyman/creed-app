/**
 * Public pricing page at /pricing — restyled to the marketing design
 * (Creed_Landing_Subpages → Pricing) and wrapped in <MarketingShell>.
 *
 * TIERS + FEATURES are the single source of truth for plan data (also used
 * by the app's billing). CTAs route into the real signup funnel
 * (/signin?mode=signup) — no waitlist; first month is free.
 *
 * Server component (no client hooks) so it can export per-page SEO metadata;
 * Icon / Link / MarketingShell are client islands rendered within it.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import MarketingShell from "@/components/marketing/MarketingShell";

export const metadata: Metadata = {
  title: "Pricing · Creed Handy Manager",
  description:
    "Simple plans that grow with you — Solo $24.99, Crew $59.99, Pro $149.99. First month free, every plan includes the full toolkit. Solo/Crew add a 0.5% platform fee on payments, capped at $100/month. Pro pays zero.",
};

type Plan = "solo" | "crew" | "pro";

interface Tier {
  id: Plan;
  name: string;
  price: number;
  tagline: string;
  cap: string;
  bullets: string[];
  ctaLabel: string;
  badge?: string;
  featured?: boolean;
}

const TIERS: Tier[] = [
  {
    id: "solo",
    name: "Solo",
    price: 24.99,
    tagline: "For independent operators",
    cap: "1 user · 75 inspections/mo",
    badge: "First month free",
    ctaLabel: "Start Free Trial",
    bullets: [
      "75 AI inspections / renders per month",
      "Everything in the toolkit (below)",
      "1 user account",
    ],
  },
  {
    id: "crew",
    name: "Crew",
    price: 59.99,
    tagline: "For growing crews",
    cap: "Up to 8 users · 175 inspections/mo",
    featured: true,
    ctaLabel: "Start Free Trial",
    bullets: [
      "175 AI inspections / renders per month",
      "Up to 8 crew members",
      "Auto payroll, HR & mileage",
      "Everything in the toolkit (below)",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 149.99,
    tagline: "For full operations",
    cap: "Unlimited users · 450 inspections/mo",
    ctaLabel: "Start Free Trial",
    bullets: [
      "450 AI inspections / renders per month",
      "Unlimited crew members",
      "Zero platform fee on payments",
      "Priority support",
      "Everything in the toolkit (below)",
    ],
  },
];

interface FeatureRow {
  label: string;
  solo: boolean | string;
  crew: boolean | string;
  pro: boolean | string;
}

const FEATURES: FeatureRow[] = [
  { label: "Voice Walk AI inspection", solo: true, crew: true, pro: true },
  { label: "AI quote generation", solo: true, crew: true, pro: true },
  { label: "Quote PDF export", solo: true, crew: true, pro: true },
  { label: "Customer portal & status pages", solo: true, crew: true, pro: true },
  { label: "Digital business card", solo: true, crew: true, pro: true },
  { label: "Stripe Connect deposits", solo: true, crew: true, pro: true },
  { label: "SMS notifications (Twilio)", solo: true, crew: true, pro: true },
  { label: "AI photo renderings", solo: true, crew: true, pro: true },
  { label: "Custom branding", solo: true, crew: true, pro: true },
  { label: "Recurring jobs", solo: true, crew: true, pro: true },
  { label: "Multi-property dashboard", solo: true, crew: true, pro: true },
  { label: "Auto-payroll", solo: true, crew: true, pro: true },
  { label: "Gamification & quests", solo: true, crew: true, pro: true },
  { label: "User accounts", solo: "1", crew: "Up to 8", pro: "Unlimited" },
  { label: "Included inspections / mo", solo: "75", crew: "175", pro: "450" },
  { label: "Platform fee on payments", solo: "0.5% · $100/mo cap", crew: "0.5% · $100/mo cap", pro: "None" },
  { label: "Tenant intake workflows", solo: false, crew: false, pro: true },
  { label: "Owner sub-accounts", solo: false, crew: false, pro: true },
  { label: "Priority support", solo: false, crew: true, pro: true },
];

interface FAQ {
  q: string;
  a: string;
}

// Marketing FAQ copy. Payments answer reflects the live fee model:
// 0.5% capped at $100/mo for Solo/Crew, $0 for Pro.
// Source of truth: src/lib/platform-fee.ts (PLATFORM_FEE_RATE + PLATFORM_FEE_CAP_CENTS).
const FAQS: FAQ[] = [
  { q: 'Is there really a free month?', a: 'Yes — every plan’s first month is free. No charge until it ends, and you can cancel anytime before then.' },
  { q: 'What counts as an “inspection”?', a: 'Each AI quote or photo render you generate. Most solo operators stay well under 75 a month; upgrade anytime if you grow.' },
  { q: 'Do you take a cut of my payments?', a: 'A small one — and it’s capped. Customer payments run through your own Stripe account and land in your bank. On Solo and Crew plans, Creed adds a 0.5% platform fee, never more than $100/month total. Standard Stripe processing fees are separate. Pro plans pay zero platform fee. Your monthly subscription is billed separately.' },
  { q: 'Can I change plans later?', a: 'Anytime, up or down. Add crew seats as you hire — your plan grows with the business.' },
];

export default function PricingPage() {
  // "Every plan includes" = the features that are on for all three tiers.
  const included = FEATURES.filter((f) => f.solo === true && f.crew === true && f.pro === true);

  return (
    <MarketingShell>
      <div className="phead"><div className="wrap">
        <div className="kick">Pricing</div>
        <div className="h1">Simple plans that <span className="g">grow with you</span></div>
        <div className="lead">Start free. Upgrade when your crew does. Every plan includes the full toolkit — plans differ by team size and AI volume.</div>
      </div></div>

      <div className="wrap">
        {/* Tiers */}
        <div className="tiers">
          {TIERS.map((t) => (
            <div className={`tier${t.featured ? " pop" : ""}`} key={t.id}>
              {t.featured && <div className="pop-tag">Most popular</div>}
              <div className="tn">{t.name}</div>
              <div className="price" style={t.featured ? { color: "#3ee08f" } : undefined}>
                ${t.price}<small style={t.featured ? { color: "#9a9aa8" } : undefined}>/mo</small>
              </div>
              <div className="cap">{t.cap}</div>
              <div className="badge">{t.badge || "First month free"}</div>
              <ul>
                {t.bullets.map((b) => (
                  <li key={b}><Icon name="check" size={16} color="#3ee08f" /> {b}</li>
                ))}
              </ul>
              <Link
                className={`btn btn-full ${t.featured ? "btn-glow" : "btn-blue"}`}
                href="/signin?mode=signup"
              >
                {t.featured && <Icon name="rocket" size={18} />} {t.ctaLabel}
              </Link>
            </div>
          ))}
        </div>

        {/* Every plan includes */}
        <div className="allinc">
          <h4>Every plan includes</h4>
          <div className="incgrid">
            {included.map((f) => (
              <div key={f.label}><Icon name="check" size={15} color="#7fb6ff" /> {f.label}</div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="faq">
          {FAQS.map((f) => (
            <div className="q" key={f.q}><b>{f.q}</b><p>{f.a}</p></div>
          ))}
        </div>

        <div style={{ textAlign: "center", padding: "50px 0" }}>
          <Link className="btn btn-glow btn-lg" href="/signin?mode=signup"><Icon name="rocket" size={18} /> Start your free month</Link>
        </div>
      </div>
    </MarketingShell>
  );
}
