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
  invalid: "That link wasn't valid. Request a fresh one below.",
  used: "That link was already used. Tap the most recent one we sent — or request another below.",
  expired: "That link expired. Request a new one below.",
  error: "Something went wrong opening that link. Try again below.",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 8,
  border: "1px solid #1e1e2e",
  background: "#12121a",
  color: "#e2e2e8",
  fontSize: 17,
  fontFamily: "Source Sans 3, sans-serif",
};

function LoginInner() {
  const params = useSearchParams();
  const reason = params.get("reason") || "";
  const banner = REASON_COPY[reason] || "";

  const [channel, setChannel] = useState<"phone" | "email">("phone");
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const isPhone = channel === "phone";

  const submit = async () => {
    setError("");
    const v = value.trim();
    if (isPhone && v.replace(/\D/g, "").length < 7) {
      setError("Enter the phone number your contractor has on file.");
      return;
    }
    if (!isPhone && !EMAIL_RE.test(v)) {
      setError("Enter the email address your contractor has on file.");
      return;
    }
    setSubmitting(true);
    try {
      const endpoint = isPhone ? "/api/portal/request-link" : "/api/portal/request-link-email";
      const payload = isPhone ? { phone: v } : { email: v };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
          <div style={{ fontSize: 48, marginBottom: 12 }}>{isPhone ? "📱" : "✉️"}</div>
          <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: "#00cc66", textTransform: "uppercase", marginBottom: 8 }}>
            {isPhone ? "Check your phone" : "Check your email"}
          </h2>
          <p style={{ color: "#aaa", fontSize: 16, lineHeight: 1.5 }}>
            If your contractor has your {isPhone ? "number" : "email"} on file, we just sent a portal link. It expires in 14 days.
          </p>
          <p style={{ color: "#666", fontSize: 14, marginTop: 12 }}>
            Didn&apos;t get it? Ask your contractor to send a fresh link from their app.
          </p>
        </div>
        <div style={{ color: "#555", fontSize: 12, marginTop: 16 }}>Powered by Creed App</div>
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
              marginBottom: 14, fontSize: 14, color: "#ffcc88",
            }}
          >
            {banner}
          </div>
        )}

        <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 20, color: "#e2e2e8", textTransform: "uppercase", textAlign: "center", margin: "0 0 4px" }}>
          Get a portal link
        </h2>
        <p style={{ color: "#888", fontSize: 14, textAlign: "center", margin: "0 0 14px" }}>
          {isPhone
            ? "Enter the phone number your contractor has on file. We'll text you a single-use link."
            : "Enter the email address your contractor has on file. We'll email you a single-use link."}
        </p>

        {/* Channel toggle — text or email a fresh link */}
        <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid #1e1e2e", marginBottom: 12 }}>
          {(["phone", "email"] as const).map((ch) => (
            <button
              key={ch}
              onClick={() => { setChannel(ch); setValue(""); setError(""); }}
              style={{
                flex: 1, padding: 9, fontFamily: "Oswald, sans-serif", fontSize: 14,
                textTransform: "uppercase", letterSpacing: ".04em", border: "none",
                cursor: "pointer", background: channel === ch ? PRIMARY : "#0d0d15",
                color: channel === ch ? "#fff" : "#888",
              }}
            >
              {ch === "phone" ? "Phone" : "Email"}
            </button>
          ))}
        </div>

        {isPhone ? (
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="555-555-5555"
            inputMode="tel"
            autoComplete="tel"
            style={{ ...inputStyle, marginBottom: 12 }}
          />
        ) : (
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="you@email.com"
            inputMode="email"
            autoComplete="email"
            type="email"
            style={{ ...inputStyle, marginBottom: 12 }}
          />
        )}

        {error && (
          <div style={{ background: "#3a0d0d", border: "1px solid #C00000", borderRadius: 6, padding: "8px 10px", marginBottom: 12, fontSize: 14, color: "#ff8888" }}>
            {error}
          </div>
        )}

        <button
          onClick={submit}
          disabled={submitting}
          style={{
            width: "100%", padding: 13, borderRadius: 8, fontSize: 17,
            fontFamily: "Oswald, sans-serif", textTransform: "uppercase",
            letterSpacing: ".05em", background: PRIMARY, color: "#fff",
            border: "none", cursor: submitting ? "wait" : "pointer",
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? "Sending…" : isPhone ? "📱 Text me a link" : "✉️ Email me a link"}
        </button>
      </div>

      <div style={{ textAlign: "center", color: "#555", fontSize: 12, marginTop: 16 }}>Powered by Creed App</div>
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
