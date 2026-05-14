"use client";
/**
 * Public pricing page. Lives at /pricing — no auth required. Visual
 * styling matches the other public pages (/lead, /card, /status):
 * dark gradient background, Oswald headings, brand-blue accent.
 * Mobile-first; cards stack under 720px.
 *
 * The CTAs open a waitlist modal that posts to /api/waitlist — actual
 * Stripe subscription billing isn't wired yet, so the page captures
 * launch-interest instead of charging a card.
 */
import { useState } from "react";

const PRIMARY = "#2E75B6";
const ACCENT = "#00cc66";
const BG = "linear-gradient(135deg, #0a0a0f, #0d1530)";

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
    price: 19,
    tagline: "For independent operators",
    cap: "1 user",
    badge: "First month free",
    ctaLabel: "Start Free Trial",
    bullets: [
      "1 user account",
      "Voice Walk AI inspections",
      "AI quote generation + PDFs",
      "Customer portal & status pages",
      "Digital business card",
      "Stripe Connect payments",
      "SMS notifications",
      "Time tracking & gamification",
    ],
  },
  {
    id: "crew",
    name: "Crew",
    price: 50,
    tagline: "For growing crews",
    cap: "Up to 8 users · 200 inspections/mo",
    featured: true,
    ctaLabel: "Get Started",
    bullets: [
      "Up to 8 user accounts",
      "200 AI inspections / renderings per month",
      "Everything in Solo",
      "Recurring jobs",
      "Multi-property dashboard",
      "Auto-payroll",
      "Custom branding",
      "Team leaderboards & quests",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 100,
    tagline: "For full operations",
    cap: "Unlimited users · 500 inspections/mo",
    ctaLabel: "Get Started",
    bullets: [
      "Unlimited user accounts",
      "500 AI inspections / renderings per month",
      "Everything in Crew",
      "Advanced gamification quests",
      "Tenant intake workflows",
      "Owner sub-accounts",
      "Priority support",
      "Early access to new features",
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
  { label: "User accounts", solo: "1", crew: "Up to 8", pro: "Unlimited" },
  { label: "Included inspections / mo", solo: "—", crew: "200", pro: "500" },
  { label: "Recurring jobs", solo: false, crew: true, pro: true },
  { label: "Multi-property dashboard", solo: false, crew: true, pro: true },
  { label: "Auto-payroll", solo: false, crew: true, pro: true },
  { label: "Advanced gamification quests", solo: false, crew: false, pro: true },
  { label: "Tenant intake workflows", solo: false, crew: false, pro: true },
  { label: "Owner sub-accounts", solo: false, crew: false, pro: true },
  { label: "Priority support", solo: false, crew: false, pro: true },
];

interface FAQ {
  q: string;
  a: string;
}

const FAQS: FAQ[] = [
  {
    q: "What if I exceed the inspection cap?",
    a: "We don't block you — extra inspections bill at $0.50 each on top of your monthly subscription. You'll see overage usage in your billing dashboard.",
  },
  {
    q: "Do I need a credit card to start the free trial?",
    a: "Yes, the Solo plan requires a card upfront to start the 30-day free trial. You won't be charged until the trial ends, and you can cancel anytime in the first month at no charge.",
  },
  {
    q: "What counts as a 'door' for the PM add-on?",
    a: "Each unique address record under a customer marked as a Property Manager. The first 10 doors are free with any plan — anything beyond that is $2/door/month. Internal team properties don't count.",
  },
  {
    q: "Can I switch plans later?",
    a: "Yes — upgrades and downgrades are prorated to the day. Move up the moment you need the extra seats or inspections, drop down whenever you don't.",
  },
  {
    q: "Do you offer a free tier?",
    a: "Not a permanent free tier — but the Solo plan includes a 30-day free trial with full access. That's our entry point. No card-only-just-to-look gates.",
  },
  {
    q: "What payment processors do you support?",
    a: "Stripe Connect. You connect your own Stripe account and customers pay you directly — funds land in your bank account, not ours. We never hold customer payments.",
  },
  {
    q: "Is there a contract?",
    a: "No. Monthly subscription, cancel anytime from your billing dashboard. No annual lock-in, no termination fee.",
  },
  {
    q: "Do I get the AI renderings on all tiers?",
    a: "Yes — AI photo renderings are available on every plan. They draw from the same monthly pool as inspections, so the cap that applies to inspections also applies to renderings.",
  },
];

export default function PricingPage() {
  const [modalPlan, setModalPlan] = useState<Plan | null>(null);
  const [modalPM, setModalPM] = useState(false);

  return (
    <div style={{ minHeight: "100vh", background: BG, color: "#e2e2e8" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 18px 60px" }}>
        {/* Top bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 30,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <a
            href="https://www.creedhm.com"
            style={{
              fontFamily: "Oswald, sans-serif",
              fontSize: 18,
              color: PRIMARY,
              textTransform: "uppercase",
              letterSpacing: ".08em",
              textDecoration: "none",
            }}
          >
            Creed
          </a>
          <a
            href="/"
            style={{
              fontSize: 12,
              color: "#888",
              textDecoration: "none",
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #1e1e2e",
            }}
          >
            Sign in →
          </a>
        </div>

        {/* Hero */}
        <div style={{ textAlign: "center", marginBottom: 38 }}>
          <h1
            style={{
              fontFamily: "Oswald, sans-serif",
              fontSize: "clamp(28px, 6vw, 44px)",
              color: "#fff",
              textTransform: "uppercase",
              letterSpacing: ".03em",
              margin: "0 0 12px",
              lineHeight: 1.1,
            }}
          >
            Pricing that <span style={{ color: PRIMARY }}>grows with you</span>
          </h1>
          <p
            style={{
              fontSize: 15,
              color: "#aaa",
              maxWidth: 640,
              margin: "0 auto",
              lineHeight: 1.5,
            }}
          >
            Built for handymen, painters, HVAC, plumbers, electricians, property
            managers — and the crews behind them.
          </p>
        </div>

        {/* Pricing cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 18,
            alignItems: "stretch",
            marginBottom: 32,
          }}
        >
          {TIERS.map((t) => (
            <PricingCard key={t.id} tier={t} onCta={() => setModalPlan(t.id)} />
          ))}
        </div>

        {/* PM add-on callout */}
        <div
          style={{
            background: "#12121a",
            border: `1px solid ${PRIMARY}55`,
            borderLeft: `4px solid ${PRIMARY}`,
            borderRadius: 10,
            padding: "18px 20px",
            marginBottom: 44,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <div style={{ flex: "1 1 320px" }}>
            <div
              style={{
                fontFamily: "Oswald, sans-serif",
                fontSize: 14,
                color: PRIMARY,
                textTransform: "uppercase",
                letterSpacing: ".08em",
                marginBottom: 4,
              }}
            >
              Property Manager add-on
            </div>
            <div style={{ fontSize: 14, color: "#ccc", lineHeight: 1.5 }}>
              Managing properties? Add <strong>$2/door/month</strong> above 10
              doors. Bring your full portfolio in. Works with any plan, billed
              alongside your subscription.
            </div>
          </div>
          <button
            onClick={() => {
              setModalPlan("crew");
              setModalPM(true);
            }}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              fontFamily: "Oswald, sans-serif",
              fontSize: 13,
              textTransform: "uppercase",
              letterSpacing: ".06em",
              background: "transparent",
              color: PRIMARY,
              border: `1px solid ${PRIMARY}`,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            I manage properties
          </button>
        </div>

        {/* Comparison table */}
        <SectionTitle>Compare features</SectionTitle>
        <div
          style={{
            background: "#12121a",
            border: "1px solid #1e1e2e",
            borderRadius: 10,
            overflow: "hidden",
            marginBottom: 44,
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                minWidth: 520,
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ background: "#0d0d15" }}>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "12px 14px",
                      fontFamily: "Oswald, sans-serif",
                      fontSize: 12,
                      color: "#888",
                      textTransform: "uppercase",
                      letterSpacing: ".06em",
                      fontWeight: 500,
                    }}
                  >
                    Feature
                  </th>
                  {(["Solo", "Crew", "Pro"] as const).map((n) => (
                    <th
                      key={n}
                      style={{
                        textAlign: "center",
                        padding: "12px 14px",
                        fontFamily: "Oswald, sans-serif",
                        fontSize: 12,
                        color: n === "Crew" ? PRIMARY : "#ccc",
                        textTransform: "uppercase",
                        letterSpacing: ".06em",
                        fontWeight: 500,
                      }}
                    >
                      {n}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FEATURES.map((row, i) => (
                  <tr
                    key={row.label}
                    style={{
                      borderTop: "1px solid #1e1e2e",
                      background: i % 2 === 0 ? "transparent" : "#0e0e16",
                    }}
                  >
                    <td style={{ padding: "10px 14px", color: "#ddd" }}>{row.label}</td>
                    <CellValue v={row.solo} />
                    <CellValue v={row.crew} highlight />
                    <CellValue v={row.pro} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQ */}
        <SectionTitle>Frequently asked</SectionTitle>
        <div style={{ display: "grid", gap: 10, marginBottom: 44 }}>
          {FAQS.map((f) => (
            <FAQItem key={f.q} q={f.q} a={f.a} />
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            borderTop: "1px solid #1e1e2e",
            paddingTop: 22,
            textAlign: "center",
            color: "#666",
            fontSize: 12,
            lineHeight: 1.7,
          }}
        >
          <div style={{ marginBottom: 6 }}>
            <a
              href="https://www.creedhm.com"
              style={{ color: PRIMARY, textDecoration: "none" }}
            >
              www.creedhm.com
            </a>
            {" · "}
            <a
              href="mailto:hello@creedhm.com"
              style={{ color: PRIMARY, textDecoration: "none" }}
            >
              hello@creedhm.com
            </a>
          </div>
          <div style={{ color: "#555" }}>
            Creed is a real, shipping product — used daily by field-service crews.
            Not vaporware.
          </div>
          <div style={{ color: "#444", marginTop: 10, fontSize: 11 }}>
            © {new Date().getFullYear()} Creed App
          </div>
        </div>
      </div>

      {modalPlan && (
        <WaitlistModal
          plan={modalPlan}
          pm={modalPM}
          onClose={() => {
            setModalPlan(null);
            setModalPM(false);
          }}
        />
      )}
    </div>
  );
}

function PricingCard({ tier, onCta }: { tier: Tier; onCta: () => void }) {
  const featured = !!tier.featured;
  return (
    <div
      style={{
        position: "relative",
        background: featured ? "#13182a" : "#12121a",
        border: featured ? `2px solid ${PRIMARY}` : "1px solid #1e1e2e",
        borderRadius: 14,
        padding: featured ? "32px 22px 24px" : "26px 22px 24px",
        display: "flex",
        flexDirection: "column",
        boxShadow: featured ? `0 8px 24px ${PRIMARY}33` : "none",
        transform: featured ? "translateY(-6px)" : "none",
      }}
    >
      {featured && (
        <div
          style={{
            position: "absolute",
            top: -12,
            left: "50%",
            transform: "translateX(-50%)",
            background: PRIMARY,
            color: "#fff",
            fontFamily: "Oswald, sans-serif",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: ".08em",
            padding: "4px 12px",
            borderRadius: 12,
            whiteSpace: "nowrap",
          }}
        >
          ★ Most Popular
        </div>
      )}

      {tier.badge && !featured && (
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            background: `${ACCENT}22`,
            color: ACCENT,
            fontSize: 10,
            fontFamily: "Oswald, sans-serif",
            textTransform: "uppercase",
            letterSpacing: ".06em",
            padding: "3px 8px",
            borderRadius: 10,
            border: `1px solid ${ACCENT}55`,
          }}
        >
          {tier.badge}
        </div>
      )}

      <div
        style={{
          fontFamily: "Oswald, sans-serif",
          fontSize: 22,
          color: featured ? PRIMARY : "#fff",
          textTransform: "uppercase",
          letterSpacing: ".05em",
          marginBottom: 4,
        }}
      >
        {tier.name}
      </div>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{tier.tagline}</div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 6 }}>
        <span style={{ fontFamily: "Oswald, sans-serif", fontSize: 38, color: "#fff" }}>
          ${tier.price}
        </span>
        <span style={{ fontSize: 13, color: "#888" }}>/month</span>
      </div>
      <div
        style={{
          fontSize: 12,
          color: featured ? "#bbb" : "#888",
          marginBottom: 18,
          minHeight: 32,
        }}
      >
        {tier.cap}
      </div>

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "0 0 22px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          flex: 1,
        }}
      >
        {tier.bullets.map((b) => (
          <li
            key={b}
            style={{
              fontSize: 13,
              color: "#ccc",
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              lineHeight: 1.45,
            }}
          >
            <span style={{ color: ACCENT, flexShrink: 0, marginTop: 1 }}>✓</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <button
        onClick={onCta}
        style={{
          width: "100%",
          padding: "12px",
          borderRadius: 8,
          fontFamily: "Oswald, sans-serif",
          fontSize: 14,
          textTransform: "uppercase",
          letterSpacing: ".05em",
          background: featured ? PRIMARY : "transparent",
          color: featured ? "#fff" : PRIMARY,
          border: featured ? "none" : `1px solid ${PRIMARY}`,
          cursor: "pointer",
        }}
      >
        {tier.ctaLabel}
      </button>
    </div>
  );
}

function CellValue({ v, highlight }: { v: boolean | string; highlight?: boolean }) {
  const bg = highlight ? "#13182a" : "transparent";
  if (typeof v === "boolean") {
    return (
      <td
        style={{
          padding: "10px 14px",
          textAlign: "center",
          background: bg,
          color: v ? ACCENT : "#444",
          fontSize: 16,
        }}
      >
        {v ? "✓" : "—"}
      </td>
    );
  }
  return (
    <td
      style={{
        padding: "10px 14px",
        textAlign: "center",
        background: bg,
        color: "#ccc",
        fontSize: 13,
      }}
    >
      {v}
    </td>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: "Oswald, sans-serif",
        fontSize: 20,
        color: "#fff",
        textTransform: "uppercase",
        letterSpacing: ".05em",
        textAlign: "center",
        margin: "0 0 18px",
      }}
    >
      {children}
    </h2>
  );
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        background: "#12121a",
        border: "1px solid #1e1e2e",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          textAlign: "left",
          background: "none",
          border: "none",
          padding: "14px 16px",
          color: "#e2e2e8",
          fontSize: 14,
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          fontFamily: "inherit",
        }}
      >
        <span>{q}</span>
        <span
          style={{
            color: PRIMARY,
            fontSize: 18,
            lineHeight: 1,
            transform: open ? "rotate(45deg)" : "none",
            transition: "transform .15s",
          }}
        >
          +
        </span>
      </button>
      {open && (
        <div
          style={{
            padding: "0 16px 14px",
            color: "#aaa",
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          {a}
        </div>
      )}
    </div>
  );
}

function WaitlistModal({
  plan,
  pm,
  onClose,
}: {
  plan: Plan;
  pm: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [interestedPM, setInterestedPM] = useState(pm);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    const e = email.trim();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setError("Please enter a valid email.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: e,
          company_name: company.trim(),
          interested_plan: plan,
          interested_pm: interestedPM,
          source: "pricing_page",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Something went wrong — try again.");
      } else {
        setDone(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
    setSubmitting(false);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#12121a",
          border: "1px solid #1e1e2e",
          borderRadius: 12,
          padding: 24,
          position: "relative",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            background: "none",
            border: "none",
            color: "#888",
            fontSize: 20,
            cursor: "pointer",
            lineHeight: 1,
            padding: 6,
          }}
        >
          ×
        </button>

        {done ? (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <div style={{ fontSize: 42, marginBottom: 10 }}>✅</div>
            <h2
              style={{
                fontFamily: "Oswald, sans-serif",
                fontSize: 20,
                color: ACCENT,
                textTransform: "uppercase",
                margin: "0 0 8px",
              }}
            >
              You&apos;re on the list
            </h2>
            <p style={{ color: "#aaa", fontSize: 13, lineHeight: 1.5, margin: 0 }}>
              We&apos;ll email <strong style={{ color: "#ddd" }}>{email}</strong> as
              soon as the {plan === "solo" ? "Solo" : plan === "crew" ? "Crew" : "Pro"} plan
              is open for signup.
            </p>
            <button
              onClick={onClose}
              style={{
                marginTop: 18,
                padding: "10px 22px",
                background: PRIMARY,
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontFamily: "Oswald, sans-serif",
                fontSize: 13,
                textTransform: "uppercase",
                letterSpacing: ".05em",
                cursor: "pointer",
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <h2
              style={{
                fontFamily: "Oswald, sans-serif",
                fontSize: 20,
                color: "#fff",
                textTransform: "uppercase",
                margin: "0 0 4px",
              }}
            >
              Get on the launch list
            </h2>
            <p style={{ color: "#888", fontSize: 12, margin: "0 0 18px" }}>
              Interested in the{" "}
              <strong style={{ color: PRIMARY }}>
                {plan === "solo" ? "Solo" : plan === "crew" ? "Crew" : "Pro"}
              </strong>{" "}
              plan. We&apos;ll email when billing opens — no card needed today.
            </p>

            <label style={labelStyle}>Email *</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourbusiness.com"
              inputMode="email"
              autoComplete="email"
              style={{ ...inputStyle, marginBottom: 12 }}
            />

            <label style={labelStyle}>Company name (optional)</label>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Acme Handyman"
              style={{ ...inputStyle, marginBottom: 12 }}
            />

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                color: "#aaa",
                marginBottom: 14,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={interestedPM}
                onChange={(e) => setInterestedPM(e.target.checked)}
                style={{ accentColor: PRIMARY }}
              />
              I manage properties (interested in the PM add-on)
            </label>

            {error && (
              <div
                style={{
                  background: "#3a0d0d",
                  border: "1px solid #C00000",
                  borderRadius: 6,
                  padding: "8px 10px",
                  marginBottom: 12,
                  fontSize: 12,
                  color: "#ff8888",
                }}
              >
                {error}
              </div>
            )}

            <button
              onClick={submit}
              disabled={submitting}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: 8,
                fontFamily: "Oswald, sans-serif",
                fontSize: 14,
                textTransform: "uppercase",
                letterSpacing: ".05em",
                background: PRIMARY,
                color: "#fff",
                border: "none",
                cursor: submitting ? "wait" : "pointer",
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? "Adding you..." : "Join the launch list"}
            </button>
            <p
              style={{
                color: "#555",
                fontSize: 11,
                textAlign: "center",
                margin: "10px 0 0",
              }}
            >
              No spam. One email when your plan goes live.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 13px",
  borderRadius: 8,
  border: "1px solid #1e1e2e",
  background: "#0d0d15",
  color: "#e2e2e8",
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#888",
  fontFamily: "Oswald, sans-serif",
  textTransform: "uppercase",
  letterSpacing: ".06em",
  marginBottom: 4,
  display: "block",
};
