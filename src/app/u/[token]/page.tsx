"use client";
/**
 * /u/[token] — the "Unsubscribe" link at the bottom of every campaign email.
 * Asks for one tap before unsubscribing, so a mail scanner that opens links
 * can't unsubscribe anyone by itself. The token is signed per customer
 * (lib/unsubscribe-token.ts); /api/unsubscribe checks it.
 */
import { useState } from "react";
import { useParams } from "next/navigation";

const PRIMARY = "#2E75B6";

export default function UnsubscribePage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<"ask" | "working" | "done" | "error">("ask");
  const [error, setError] = useState("");
  const isTest = token === "test";

  const go = async () => {
    if (isTest) { setState("done"); return; }
    setState("working");
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: decodeURIComponent(token) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || "Something went wrong."); setState("error"); return; }
      setState("done");
    } catch {
      setError("Couldn't reach the server. Try again in a minute.");
      setState("error");
    }
  };

  return (
    <main style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e2e2e8", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "Source Sans 3, sans-serif" }}>
      <div style={{ maxWidth: 420, width: "100%", background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 24, textAlign: "center" }}>
        {state === "done" ? (
          <>
            <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, margin: "0 0 10px" }}>You're unsubscribed</h1>
            <p style={{ color: "#aaa", margin: 0, lineHeight: 1.5 }}>
              {isTest ? "This was a test email, so nothing changed." : "You won't get marketing emails from this business again. You'll still get messages about work you've booked, like quotes and invoices."}
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, margin: "0 0 10px" }}>Stop these emails?</h1>
            <p style={{ color: "#aaa", margin: "0 0 18px", lineHeight: 1.5 }}>
              You'll stop getting marketing emails from this business. Messages about work you've booked still come through.
            </p>
            {state === "error" && <p style={{ color: "#e57373", margin: "0 0 12px" }}>{error}</p>}
            <button
              onClick={go}
              disabled={state === "working"}
              style={{ background: PRIMARY, color: "#fff", border: "none", borderRadius: 8, padding: "12px 22px", fontSize: 16, fontWeight: 600, cursor: "pointer", opacity: state === "working" ? 0.6 : 1 }}
            >
              {state === "working" ? "Unsubscribing…" : "Unsubscribe"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
