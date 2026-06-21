"use client";
/**
 * /onboarding/done — Stripe's success_url. Lands the new owner here
 * right after the Checkout completes.
 *
 * We fire a webhook-INDEPENDENT subscription sync here
 * (/api/stripe/verify-subscription) using the session_id from the URL.
 * The Stripe webhook normally writes org.subscription_status, but if
 * webhook delivery fails (wrong-domain endpoint, transient outage) the
 * subscription would never activate. This server-side verify guarantees
 * the org is synced the moment the owner lands here. It's idempotent —
 * if the webhook also lands, whichever writes first wins and the other
 * is a harmless no-op.
 *
 * We don't BLOCK the redirect on it: the 30-day trial means BillingGate
 * lets the owner in regardless, and the sync completes in the
 * background. We pause for a beat so the success copy reads as a real
 * moment, then bounce to "/".
 */
import { useEffect } from "react";

const PRIMARY = "#2E75B6";
const ACCENT = "#00cc66";
const BG = "linear-gradient(135deg, #0a0a0f, #0d1530)";

export default function OnboardingDonePage() {
  useEffect(() => {
    // Fire-and-forget subscription sync from the session_id Stripe
    // appended to success_url. Doesn't block the redirect.
    try {
      const sessionId = new URLSearchParams(window.location.search).get("session_id");
      if (sessionId) {
        fetch("/api/stripe/verify-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        }).catch(() => { /* trial covers us; webhook is the backup */ });
      }
    } catch { /* no-op */ }

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
        <p style={{ color: "#aaa", fontSize: 16, lineHeight: 1.55, margin: "0 0 20px" }}>
          Your 30-day trial just started — no charges until it ends.
          Setting up your dashboard now…
        </p>
        <div style={{ display: "inline-block", width: 28, height: 28, border: "3px solid #1e1e2e", borderTopColor: PRIMARY, borderRadius: "50%", animation: "spin 800ms linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ marginTop: 22 }}>
          <a href="/" style={{ color: "#666", fontSize: 14, textDecoration: "none" }}>
            Skip the wait →
          </a>
        </div>
      </div>
    </div>
  );
}
