"use client";
/**
 * /portal/login — shown when the customer's portal cookie is missing,
 * expired, or their magic-link token was already used. They enter the
 * phone number their contractor has on file and we (silently) text
 * a fresh magic link if a match exists.
 *
 * We never confirm whether the phone matches a record — the success
 * message is shown for any well-formed input. This avoids exposing
 * which phones belong to a contractor's customer list.
 */
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

const PRIMARY = "#2E75B6";

const REASON_COPY: Record<string, string> = {
  invalid: "That link wasn't valid. Enter your phone and we'll text a fresh one.",
  used: "That link was already used. Tap the most recent text we sent — or request another below.",
  expired: "That link expired. Enter your phone and we'll send a new one.",
  error: "Something went wrong opening that link. Try again below.",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 8,
  border: "1px solid #1e1e2e",
  background: "#12121a",
  color: "#e2e2e8",
  fontSize: 15,
  fontFamily: "Source Sans 3, sans-serif",
};

function LoginInner() {
  const params = useSearchParams();
  const reason = params.get("reason") || "";
  const banner = REASON_COPY[reason] || "";

  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (phone.replace(/\D/g, "").length < 7) {
      setError("Enter the phone number your contractor has on file.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/portal/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      // We always show the success state — the API never reveals match/no-match.
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.error) {
          setError(data.error);
          setSubmitting(false);
          return;
        }
      }
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error — try again.");
    }
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <div style={{ width: "100%", maxWidth: 420, textAlign: "center" }}>
        <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 28 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📱</div>
          <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: "#00cc66", textTransform: "uppercase", marginBottom: 8 }}>
            Check your phone
          </h2>
          <p style={{ color: "#aaa", fontSize: 14, lineHeight: 1.5 }}>
            If your contractor has your number on file, we just texted a portal link. It expires in 14 days.
          </p>
          <p style={{ color: "#666", fontSize: 12, marginTop: 12 }}>
            Didn&apos;t get it? Ask your contractor to send a fresh link from their app.
          </p>
        </div>
        <div style={{ color: "#555", fontSize: 10, marginTop: 16 }}>Powered by Creed App</div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", maxWidth: 420 }}>
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: PRIMARY, textTransform: "uppercase", letterSpacing: ".05em", margin: 0 }}>
          Customer Portal
        </h1>
      </div>

      <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 22 }}>
        {banner && (
          <div
            style={{
              background: "#3a2a0d", border: "1px solid #ff8800",
              borderRadius: 6, padding: "8px 10px",
              marginBottom: 14, fontSize: 12, color: "#ffcc88",
            }}
          >
            {banner}
          </div>
        )}

        <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 18, color: "#e2e2e8", textTransform: "uppercase", textAlign: "center", margin: "0 0 4px" }}>
          Get a portal link
        </h2>
        <p style={{ color: "#888", fontSize: 12, textAlign: "center", margin: "0 0 14px" }}>
          Enter the phone number your contractor has on file. We&apos;ll text you a single-use link.
        </p>

        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="555-555-5555"
          inputMode="tel"
          autoComplete="tel"
          style={{ ...inputStyle, marginBottom: 12 }}
        />

        {error && (
          <div style={{ background: "#3a0d0d", border: "1px solid #C00000", borderRadius: 6, padding: "8px 10px", marginBottom: 12, fontSize: 12, color: "#ff8888" }}>
            {error}
          </div>
        )}

        <button
          onClick={submit}
          disabled={submitting}
          style={{
            width: "100%", padding: 13, borderRadius: 8, fontSize: 15,
            fontFamily: "Oswald, sans-serif", textTransform: "uppercase",
            letterSpacing: ".05em", background: PRIMARY, color: "#fff",
            border: "none", cursor: submitting ? "wait" : "pointer",
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? "Sending…" : "📱 Text me a link"}
        </button>
      </div>

      <div style={{ textAlign: "center", color: "#555", fontSize: 10, marginTop: 16 }}>Powered by Creed App</div>
    </div>
  );
}

export default function PortalLoginPage() {
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f, #0d1530)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
      <Suspense fallback={<div style={{ color: PRIMARY, fontFamily: "Oswald, sans-serif" }}>Loading…</div>}>
        <LoginInner />
      </Suspense>
    </div>
  );
}
