"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * /pay?job=<id>&t=<token> — the payment link the owner shares from
 * Collect now (QR, Copy, Send).
 *
 * It used to share the raw Stripe Checkout URL, which dies after 24 hours and
 * keeps the amount from the moment it was made. This link never expires: each
 * time it's opened it asks /api/checkout for a FRESH session for whatever is
 * owed right now (the server clamps to the live balance and closes any other
 * open checkout for the job) and sends the customer straight to Stripe.
 *
 * Runs in the browser only, so link previews in Messages (which don't run
 * JavaScript) never start a checkout. If the job has nothing left to pay or
 * checkout can't start, the customer gets a plain message and a link to their
 * job page instead of a dead end.
 */
function PayContent() {
  const params = useSearchParams();
  const jobId = params.get("job") || "";
  const token = params.get("t") || "";
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const statusUrl = jobId
    ? `/status?job=${encodeURIComponent(jobId)}${token ? `&t=${encodeURIComponent(token)}` : ""}`
    : null;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!jobId) { setError("This payment link is incomplete. Please ask the business for a new one."); return; }
    (async () => {
      try {
        // No amount → the whole balance still owed (server-side).
        const res = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.url) { window.location.replace(data.url); return; }
        setError(data?.error || "Couldn't start the payment. Please try again in a minute.");
      } catch {
        setError("No connection. Check your signal and try again.");
      }
    })();
  }, [jobId]);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f, #0d1530)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: error ? "#ffb15e" : "#8cc0ff", textTransform: "uppercase", marginBottom: 8 }}>
          {error ? "Payment not started" : "Opening secure checkout…"}
        </h1>
        <p style={{ color: "#a8a8b4", fontSize: 16, fontFamily: "Source Sans 3, sans-serif", marginBottom: 24, lineHeight: 1.5 }}>
          {error || "One moment while we get your payment page ready."}
        </p>
        {error && statusUrl && (
          <a href={statusUrl} style={{ display: "inline-block", padding: "11px 24px", background: "#2E75B6", color: "#fff", borderRadius: 8, textDecoration: "none", fontFamily: "Oswald, sans-serif", textTransform: "uppercase", fontSize: 16 }}>
            View your job
          </a>
        )}
        <div style={{ marginTop: 20, color: "#555", fontSize: 12 }}>Secure payment by Stripe · Powered by Creed HM</div>
      </div>
    </div>
  );
}

export default function PayPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0a0f" }} />}>
      <PayContent />
    </Suspense>
  );
}
