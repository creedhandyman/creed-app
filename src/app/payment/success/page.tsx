"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { db } from "@/lib/supabase";
import { Suspense } from "react";

function SuccessContent() {
  const params = useSearchParams();
  const jobId = params.get("job_id");
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    if (jobId && !updated) {
      db.patch("jobs", jobId, { status: "paid" });
      setUpdated(true);
    }
  }, [jobId, updated]);

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
        <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
        <h1
          style={{
            fontFamily: "Oswald, sans-serif",
            fontSize: 24,
            color: "#00cc66",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Payment Received
        </h1>
        <p style={{ color: "#888", fontSize: 14, fontFamily: "Source Sans 3, sans-serif", marginBottom: 24 }}>
          Thank you for your payment. Your invoice has been marked as paid.
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
