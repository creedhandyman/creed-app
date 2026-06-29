"use client";
/**
 * /membership/thanks — where Stripe's hosted membership Checkout returns the
 * customer (success or cancel). Public, no app session required.
 */
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function Inner() {
  const params = useSearchParams();
  const canceled = params.get("canceled") === "1";
  const plan = params.get("plan") || "";
  return (
    <div style={{ width: "100%", maxWidth: 420, textAlign: "center" }}>
      <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 28 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>{canceled ? "👋" : "🎉"}</div>
        <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: canceled ? "#ffb86b" : "#3ee08f", textTransform: "uppercase", marginBottom: 8 }}>
          {canceled ? "No worries" : "You're enrolled!"}
        </h1>
        <p style={{ color: "#aaa", fontSize: 16, lineHeight: 1.5 }}>
          {canceled
            ? "Your enrollment wasn't completed. You can sign up anytime — just ask your provider for the link again."
            : `Your${plan ? ` ${plan}` : ""} membership is active. Your provider will reach out about your first visit.`}
        </p>
      </div>
      <div style={{ color: "#555", fontSize: 12, marginTop: 16 }}>Powered by Creed App</div>
    </div>
  );
}

export default function MembershipThanksPage() {
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f, #0d1530)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
      <Suspense fallback={null}>
        <Inner />
      </Suspense>
    </div>
  );
}
