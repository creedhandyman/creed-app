"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function SuccessContent() {
  const params = useSearchParams();
  const jobId = params.get("job_id");
  const sessionId = params.get("session_id");
  const [updated, setUpdated] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId || !sessionId || updated) return;
    // Verify the payment server-side before the job is marked paid.
    // The server checks the Stripe session's payment_status and confirms
    // the job_id matches the session metadata.
    (async () => {
      try {
        const res = await fetch("/api/verify-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, jobId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setVerifyError(data?.error || "Could not verify payment");
          return;
        }
        setUpdated(true);
      } catch (err) {
        setVerifyError(err instanceof Error ? err.message : "Verification failed");
      }
    })();
  }, [jobId, sessionId, updated]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0a0a0f, #0d1530)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <img
          src="/CREED_LOGO.png"
          alt=""
          style={{ height: 80, display: "block", margin: "0 auto 16px" }}
          onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
        />
        <div style={{ fontSize: 64, marginBottom: 16 }}>{verifyError ? "⚠️" : "✅"}</div>
        <h1
          style={{
            fontFamily: "Oswald, sans-serif",
            fontSize: 24,
            color: verifyError ? "#ff8800" : "#00cc66",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          {verifyError ? "Payment Pending" : "Payment Received"}
        </h1>
        <p style={{ color: "#888", fontSize: 14, fontFamily: "Source Sans 3, sans-serif", marginBottom: 24 }}>
          {verifyError
            ? "We received your payment but couldn't confirm it on our end yet. Your invoice will update once confirmed. Contact us if this persists."
            : "Thank you for your payment. Your invoice has been marked as paid."}
        </p>
        <a
          href="/"
          style={{
            display: "inline-block",
            padding: "10px 24px",
            background: "#2E75B6",
            color: "#fff",
            borderRadius: 8,
            textDecoration: "none",
            fontFamily: "Oswald, sans-serif",
            textTransform: "uppercase",
            fontSize: 14,
          }}
        >
          Back to App
        </a>
        <div style={{ marginTop: 20, color: "#555", fontSize: 10 }}>
          Powered by Creed App
        </div>
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
