"use client";
/**
 * /onboarding/done — Stripe's success_url. Lands the new owner here
 * right after the Checkout completes. The Stripe webhook is racing us
 * to update org.subscription_status; we don't need to wait for it
 * because the trial is already 30 days and BillingGate will let the
 * owner in regardless of whether the webhook has landed yet.
 *
 * We pause for a beat so the success copy reads as a real moment
 * (rather than a flash), then bounce to "/" — the AppShell takes over
 * from there.
 */
import { useEffect } from "react";

const PRIMARY = "#2E75B6";
const ACCENT = "#00cc66";
const BG = "linear-gradient(135deg, #0a0a0f, #0d1530)";

export default function OnboardingDonePage() {
  useEffect(() => {
    const t = setTimeout(() => { window.location.href = "/"; }, 2400);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: BG, color: "#e2e2e8", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontSize: 56, marginBottom: 10, color: ACCENT, lineHeight: 1 }}>✓</div>
        <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 26, color: PRIMARY, textTransform: "uppercase", letterSpacing: ".05em", margin: "0 0 10px" }}>
          You&apos;re in
        </h1>
        <p style={{ color: "#aaa", fontSize: 14, lineHeight: 1.55, margin: "0 0 20px" }}>
          Your 30-day trial just started — no charges until it ends.
          Setting up your dashboard now…
        </p>
        <div style={{ display: "inline-block", width: 28, height: 28, border: "3px solid #1e1e2e", borderTopColor: PRIMARY, borderRadius: "50%", animation: "spin 800ms linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ marginTop: 22 }}>
          <a href="/" style={{ color: "#666", fontSize: 12, textDecoration: "none" }}>
            Skip the wait →
          </a>
        </div>
      </div>
    </div>
  );
}
