"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { paymentSuccessCopy } from "@/lib/payment-success-copy";

interface VerifyResult {
  paidNow?: number;
  balance?: number;
  fullyPaid?: boolean;
  workDone?: boolean;
  business?: { name?: string; logo_url?: string | null; brand_color?: string | null } | null;
  statusUrl?: string | null;
}

/**
 * Where Stripe sends the customer after paying. Verifies the session
 * server-side (/api/verify-payment records it), then says what actually
 * happened — a deposit is NOT "paid in full" — under the business's own
 * name/logo, with a link back to their job page (not the contractor login).
 */
function SuccessContent() {
  const params = useSearchParams();
  const jobId = params.get("job_id");
  const sessionId = params.get("session_id");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [notPaid, setNotPaid] = useState(false);

  useEffect(() => {
    if (!jobId || !sessionId) { setVerifyError("missing"); return; }
    (async () => {
      try {
        const res = await fetch("/api/verify-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, jobId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // 402 = Stripe says this checkout isn't paid (see /api/verify-payment).
          setNotPaid(res.status === 402);
          setVerifyError(data?.error || "Could not verify payment");
          return;
        }
        setResult(data as VerifyResult);
      } catch (err) {
        setVerifyError(err instanceof Error ? err.message : "Verification failed");
      }
    })();
  }, [jobId, sessionId]);

  const business = result?.business;
  const accent = business?.brand_color || "#2E75B6";
  const { title, body, tone, icon } = paymentSuccessCopy({
    error: verifyError ? { notPaid } : null,
    result,
  });

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f, #0d1530)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        {business?.logo_url ? (
          <img src={business.logo_url} alt="" style={{ maxHeight: 72, maxWidth: 220, display: "block", margin: "0 auto 14px", objectFit: "contain" }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
        ) : business?.name ? (
          <div style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: "#e8e8ee", marginBottom: 14 }}>{business.name}</div>
        ) : null}
        <div style={{ width: 64, height: 64, borderRadius: "50%", margin: "0 auto 14px", display: "flex", alignItems: "center", justifyContent: "center", border: `3px solid ${tone}`, color: tone, fontSize: 30 }}>
          {icon}
        </div>
        <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: tone, textTransform: "uppercase", marginBottom: 8 }}>{title}</h1>
        <p style={{ color: "#a8a8b4", fontSize: 16, fontFamily: "Source Sans 3, sans-serif", marginBottom: 24, lineHeight: 1.5 }}>{body}</p>
        {result?.statusUrl && (
          <a href={result.statusUrl} style={{ display: "inline-block", padding: "11px 24px", background: accent, color: "#fff", borderRadius: 8, textDecoration: "none", fontFamily: "Oswald, sans-serif", textTransform: "uppercase", fontSize: 16 }}>
            View your job
          </a>
        )}
        <div style={{ marginTop: 20, color: "#555", fontSize: 12 }}>Secure payment by Stripe · Powered by Creed HM</div>
      </div>
    </div>
  );
}

export default function PaymentSuccess() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0a0f" }} />}>
      <SuccessContent />
    </Suspense>
  );
}
