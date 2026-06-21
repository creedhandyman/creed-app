"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { applyPromoCode } from "@/lib/promo-codes";

// localStorage key for trial-banner dismissal. Keyed by the days-remaining
// count so a dismiss at "7 days left" doesn't suppress the banner once we
// drop to 6 — every new day's banner gets one fresh chance to be dismissed.
const trialDismissKey = (daysLeft: number) => `c_trial_banner_dismissed_${daysLeft}`;

const PLANS = [
  { key: "solo", name: "Solo", price: "$19", desc: "1 user", amount: 1900 },
  { key: "crew", name: "Crew", price: "$49", desc: "Up to 8 users", amount: 4900 },
  { key: "pro",  name: "Pro",  price: "$99", desc: "Unlimited users", amount: 9900 },
];

export default function BillingGate({ children }: { children: React.ReactNode }) {
  const org = useStore((s) => s.org);
  const user = useStore((s) => s.user);
  const [selectedPlan, setSelectedPlan] = useState(org?.plan || "solo");
  const [loading, setLoading] = useState(false);

  // No org or no user — let other gates handle it
  if (!org || !user) return <>{children}</>;

  // Billing not enforced — everything is free
  if (!org.billing_enforced) return <>{children}</>;

  // Active subscription — pass through
  if (org.subscription_status === "active") return <>{children}</>;

  // Stripe-confirmed trial (post-Checkout). trial_ends_at is authoritative
  // here, set by the webhook on subscription.created/updated. We still
  // surface the trial banner so the days-left countdown is visible.
  if (org.subscription_status === "trialing") {
    const trialEnd = org.trial_ends_at ? new Date(org.trial_ends_at) : null;
    const daysLeft = trialEnd
      ? Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : 30;
    if (daysLeft > 0) {
      return <TrialBanner daysLeft={daysLeft} org={org} user={user}>{children}</TrialBanner>;
    }
  }

  // Pre-Stripe trial (signed up but hasn't hit Stripe Checkout yet) —
  // we compute from trial_start, the org-create timestamp.
  if (org.trial_start) {
    const trialStart = new Date(org.trial_start);
    const trialEnd = new Date(trialStart);
    trialEnd.setDate(trialEnd.getDate() + 30);
    const daysLeft = Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

    if (daysLeft > 0) {
      // Still in trial — show banner but allow access. Banner is
      // dismissable per day (key includes daysLeft) so the user can
      // close "7 days left" today and still see "6 days left" tomorrow.
      return <TrialBanner daysLeft={daysLeft} org={org} user={user}>{children}</TrialBanner>;
    }
  }

  // Trial expired or no trial + no active subscription → PAYWALL
  const isOwner = user.role === "owner" || user.role === "manager";

  const handleSubscribe = async () => {
    if (!isOwner) return;
    setLoading(true);
    try {
      // Save selected plan, then hand off to the Stripe Checkout endpoint
      // that uses STRIPE_PRICE_<PLAN> env vars + a 30-day trial.
      await db.patch("organizations", org.id, { plan: selectedPlan, subscription_plan: selectedPlan });

      const res = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: org.id,
          plan: selectedPlan,
          returnUrl: window.location.origin,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        useStore.getState().showToast("Error: " + (data.error || "Could not start checkout"), "error");
      }
    } catch {
      useStore.getState().showToast("Failed to start checkout", "error");
    }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0a0f, #0d1530)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{ width: "100%", maxWidth: 500, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⏱️</div>
        <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 26, color: "#2E75B6", textTransform: "uppercase", marginBottom: 8 }}>
          {org.subscription_status === "canceled" ? "Subscription Canceled" :
           org.subscription_status === "past_due" ? "Payment Past Due" :
           "Trial Expired"}
        </h1>
        <p style={{ color: "#888", fontSize: 16, marginBottom: 24, fontFamily: "Source Sans 3, sans-serif" }}>
          {org.subscription_status === "past_due"
            ? "Please update your payment method to continue using Creed App."
            : "Your 30-day free trial has ended. Subscribe to keep using Creed App."}
        </p>

        {isOwner ? (
          <>
            {/* Plan cards */}
            <div style={{ display: "flex", gap: 10, marginBottom: 20, justifyContent: "center" }}>
              {PLANS.map((p) => (
                <div
                  key={p.key}
                  onClick={() => setSelectedPlan(p.key)}
                  style={{
                    flex: 1, maxWidth: 150,
                    background: selectedPlan === p.key ? "#2E75B611" : "#12121a",
                    border: selectedPlan === p.key ? "2px solid #2E75B6" : "1px solid #1e1e2e",
                    borderRadius: 10, padding: "16px 12px", cursor: "pointer",
                    transition: "all .15s",
                  }}
                >
                  <div style={{ fontFamily: "Oswald, sans-serif", fontSize: 18, color: selectedPlan === p.key ? "#2E75B6" : "#e2e2e8" }}>
                    {p.name}
                  </div>
                  <div style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: "#2E75B6", margin: "6px 0" }}>
                    {p.price}
                  </div>
                  <div style={{ fontSize: 15, color: "#888" }}>/month</div>
                  <div style={{ fontSize: 14, color: "#666", marginTop: 4 }}>{p.desc}</div>
                </div>
              ))}
            </div>

            <button
              onClick={handleSubscribe}
              disabled={loading}
              style={{
                width: "100%", maxWidth: 400, padding: 14, fontSize: 18,
                fontFamily: "Oswald, sans-serif", textTransform: "uppercase",
                background: loading ? "#333" : "#2E75B6", color: "#fff",
                border: "none", borderRadius: 8, cursor: loading ? "wait" : "pointer",
              }}
            >
              {loading ? "Loading..." : "Subscribe Now"}
            </button>

            {org.stripe_customer_id && (
              <div style={{ marginTop: 12 }}>
                <span
                  onClick={async () => {
                    const res = await fetch("/api/stripe/portal", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        orgId: org.id,
                        returnUrl: window.location.origin,
                      }),
                    });
                    const data = await res.json();
                    if (data.url) window.location.href = data.url;
                  }}
                  style={{ color: "#888", fontSize: 14, cursor: "pointer", textDecoration: "underline" }}
                >
                  Manage existing billing
                </span>
              </div>
            )}

            {/* Promo code escape hatch — for owners who hit the paywall
                with a valid comp code in hand. Applies billing_enforced=
                false and reloads so the gate's pass-through fires. */}
            <PaywallPromoCode orgId={org.id} />
          </>
        ) : (
          <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 10, padding: 20 }}>
            <p style={{ color: "#888", fontSize: 15 }}>
              Ask your business owner to subscribe to continue using Creed App.
            </p>
          </div>
        )}

        <div style={{ marginTop: 20, fontSize: 14, color: "#555" }}>
          Powered by Creed App
        </div>
      </div>
    </div>
  );
}

// Paywall promo code entry. Hidden until the user clicks "Have a promo
// code?". Valid codes flip billing_enforced=false on the org; on success
// the page reloads so the gate's pre-paywall short-circuit fires.
function PaywallPromoCode({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <div style={{ marginTop: 8 }}>
        <span
          onClick={() => setOpen(true)}
          style={{ color: "#888", fontSize: 14, cursor: "pointer", textDecoration: "underline" }}
        >
          Have a promo code?
        </span>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12, display: "flex", gap: 6, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Promo code"
        style={{
          fontSize: 15, padding: "6px 10px", borderRadius: 6,
          border: "1px solid #2E75B6", background: "#0a0a0f", color: "#fff",
          textTransform: "uppercase", minWidth: 180,
        }}
        autoFocus
      />
      <button
        onClick={async () => {
          if (!code.trim() || busy) return;
          setBusy(true);
          const result = await applyPromoCode(orgId, code);
          if (result.ok) {
            useStore.getState().showToast("Promo code applied", "success");
            // Hard reload so the gate re-evaluates org.billing_enforced
            // from a fresh fetch and passes through to the app.
            window.location.reload();
          } else {
            useStore.getState().showToast(result.reason || "Invalid promo code", "error");
            setBusy(false);
          }
        }}
        disabled={busy || !code.trim()}
        style={{
          background: busy || !code.trim() ? "#333" : "#2E75B6", color: "#fff",
          border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 15,
          cursor: busy || !code.trim() ? "wait" : "pointer",
        }}
      >
        {busy ? "..." : "Apply"}
      </button>
      <button
        onClick={() => { setOpen(false); setCode(""); }}
        style={{
          background: "transparent", color: "#888", border: "none",
          fontSize: 14, padding: "6px 8px", cursor: "pointer",
        }}
      >
        Cancel
      </button>
    </div>
  );
}

// Sticky trial-ending banner with a per-day-count dismiss. Pulled out of
// BillingGate so it can hold its own dismissed-state without re-rendering
// the paywall on every state change.
function TrialBanner({
  daysLeft, org, user, children,
}: {
  daysLeft: number;
  org: { id: string; name: string; plan?: string };
  user: { email: string };
  children: React.ReactNode;
}) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return !!localStorage.getItem(trialDismissKey(daysLeft)); } catch { return false; }
  });
  const [loading, setLoading] = useState(false);
  const showBanner = daysLeft <= 7 && !dismissed;
  return (
    <>
      {showBanner && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000,
          background: daysLeft <= 3 ? "#C00000" : "#D4760A",
          color: "#fff", textAlign: "center", padding: "6px 32px 6px 12px",
          fontSize: 14, fontFamily: "Source Sans 3, sans-serif",
        }}>
          ⏳ Trial ends in {daysLeft} day{daysLeft !== 1 ? "s" : ""} —{" "}
          <span
            onClick={async () => {
              if (loading) return;
              setLoading(true);
              try {
                const res = await fetch("/api/stripe/create-checkout-session", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    orgId: org.id,
                    plan: org.plan || "crew",
                    returnUrl: window.location.origin,
                  }),
                });
                const data = await res.json();
                if (data.url) window.location.href = data.url;
              } catch { /* */ }
              setLoading(false);
            }}
            style={{ textDecoration: "underline", cursor: loading ? "wait" : "pointer", fontWeight: 600 }}
          >
            Subscribe now
          </span>
          <button
            onClick={() => {
              try { localStorage.setItem(trialDismissKey(daysLeft), "1"); } catch { /* */ }
              setDismissed(true);
            }}
            aria-label="Dismiss trial banner"
            title="Dismiss"
            style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              background: "transparent", border: "none", color: "#fff",
              fontSize: 16, lineHeight: 1, padding: "2px 6px", cursor: "pointer",
              opacity: 0.85,
            }}
          >
            ✕
          </button>
        </div>
      )}
      {children}
    </>
  );
}
