"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";

const PLANS = [
  { key: "solo", name: "Solo", price: "$49", desc: "1 user", amount: 4900 },
  { key: "team", name: "Team", price: "$99", desc: "Up to 5 users", amount: 9900 },
  { key: "business", name: "Business", price: "$149", desc: "Up to 10 users", amount: 14900 },
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

  // Check trial
  if (org.trial_start) {
    const trialStart = new Date(org.trial_start);
    const trialEnd = new Date(trialStart);
    trialEnd.setDate(trialEnd.getDate() + 30);
    const daysLeft = Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

    if (daysLeft > 0) {
      // Still in trial — show banner but allow access
      return (
        <>
          {daysLeft <= 7 && (
            <div style={{
              position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000,
              background: daysLeft <= 3 ? "#C00000" : "#D4760A",
              color: "#fff", textAlign: "center", padding: "6px 12px",
              fontSize: 12, fontFamily: "Source Sans 3, sans-serif",
            }}>
              ⏳ Trial ends in {daysLeft} day{daysLeft !== 1 ? "s" : ""} —{" "}
              <span
                onClick={async () => {
                  setLoading(true);
                  try {
                    const res = await fetch("/api/billing", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "create-checkout",
                        orgId: org.id,
                        orgName: org.name,
                        email: user.email,
                        plan: org.plan || "solo",
                        returnUrl: window.location.origin,
                      }),
                    });
                    const data = await res.json();
                    if (data.url) window.location.href = data.url;
                  } catch { /* */ }
                  setLoading(false);
                }}
                style={{ textDecoration: "underline", cursor: "pointer", fontWeight: 600 }}
              >
                Subscribe now
              </span>
            </div>
          )}
          {children}
        </>
      );
    }
  }

  // Trial expired or no trial + no active subscription → PAYWALL
  const isOwner = user.role === "owner" || user.role === "manager";

  const handleSubscribe = async () => {
    if (!isOwner) return;
    setLoading(true);
    try {
      // Save selected plan
      await db.patch("organizations", org.id, { plan: selectedPlan });

      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-checkout",
          orgId: org.id,
          orgName: org.name,
          email: user.email,
          plan: selectedPlan,
          returnUrl: window.location.origin,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert("Error: " + (data.error || "Could not start checkout"));
      }
    } catch (e) {
      alert("Failed to start checkout: " + (e instanceof Error ? e.message : ""));
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
        <p style={{ color: "#888", fontSize: 14, marginBottom: 24, fontFamily: "Source Sans 3, sans-serif" }}>
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
                  <div style={{ fontFamily: "Oswald, sans-serif", fontSize: 16, color: selectedPlan === p.key ? "#2E75B6" : "#e2e2e8" }}>
                    {p.name}
                  </div>
                  <div style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: "#2E75B6", margin: "6px 0" }}>
                    {p.price}
                  </div>
                  <div style={{ fontSize: 13, color: "#888" }}>/month</div>
                  <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{p.desc}</div>
                </div>
              ))}
            </div>

            <button
              onClick={handleSubscribe}
              disabled={loading}
              style={{
                width: "100%", maxWidth: 400, padding: 14, fontSize: 16,
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
                    const res = await fetch("/api/billing", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "create-portal",
                        orgId: org.id,
                        returnUrl: window.location.origin,
                      }),
                    });
                    const data = await res.json();
                    if (data.url) window.location.href = data.url;
                  }}
                  style={{ color: "#888", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
                >
                  Manage existing billing
                </span>
              </div>
            )}
          </>
        ) : (
          <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 10, padding: 20 }}>
            <p style={{ color: "#888", fontSize: 13 }}>
              Ask your business owner to subscribe to continue using Creed App.
            </p>
          </div>
        )}

        <div style={{ marginTop: 20, fontSize: 12, color: "#555" }}>
          Powered by Creed App
        </div>
      </div>
    </div>
  );
}
