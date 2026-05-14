"use client";
/**
 * Public /signup — the front door for new customers.
 *
 * Flow:
 *   1. Capture name + email + password.
 *   2. supabase.auth.signUp (with emailRedirectTo: /onboarding).
 *   3. If a session is returned (email confirmation off in Supabase), we
 *      immediately insert a starter organizations row + the owner's
 *      profiles row, then redirect to /onboarding to finish setup.
 *   4. If no session (email confirmation required), show a "check your
 *      inbox" panel. The click-to-verify email link lands on /onboarding,
 *      which detects the session-without-profile case and runs the same
 *      org/profile creation there.
 *
 * Styling mirrors /pricing and /lead — dark gradient, brand-blue accent,
 * Oswald headings — so we have a consistent public surface.
 */
import { useEffect, useState } from "react";
import { supabase, db } from "@/lib/supabase";
import { useStore } from "@/lib/store";
import { bootstrapOrgAndProfile } from "@/lib/signup-helpers";
import type { Profile } from "@/lib/types";

const PRIMARY = "#2E75B6";
const ACCENT = "#00cc66";
const BG = "linear-gradient(135deg, #0a0a0f, #0d1530)";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // If the visitor already has a Supabase session, bounce them — either
  // to /onboarding (no org yet) or / (everything wired up). Avoids a
  // confusing "sign up again" state for someone who just refreshed.
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const profiles = await db.get<Profile>("profiles", { id: session.user.id });
      if (profiles.length && profiles[0].org_id) {
        window.location.href = "/";
      } else {
        window.location.href = "/onboarding";
      }
    })();
  }, []);

  const submit = async () => {
    setErr("");
    if (!name.trim()) return setErr("Enter your name");
    if (!email.trim()) return setErr("Enter your email");
    if (password.length < 6) return setErr("Password must be at least 6 characters");

    setBusy(true);
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const { data: auth, error: authErr } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { name: name.trim() },
          emailRedirectTo: origin ? `${origin}/onboarding` : undefined,
        },
      });
      if (authErr) { setErr(authErr.message); setBusy(false); return; }
      if (!auth.user) { setErr("Signup failed"); setBusy(false); return; }
      if (auth.user.identities?.length === 0) {
        setErr("That email is already registered — sign in instead.");
        setBusy(false);
        return;
      }

      // Email-confirmation flow: Supabase returns user but no session. The
      // org/profile creation has to wait until the user verifies and lands
      // on /onboarding — at which point that route owns the bootstrap.
      if (!auth.session) {
        setEmailSent(true);
        setBusy(false);
        return;
      }

      // Auto-confirm flow: we already have a session, so create the org
      // and profile right here and route into the wizard.
      const created = await bootstrapOrgAndProfile(auth.user.id, email.trim(), name.trim());
      if (!created) {
        setErr("Couldn't create your business — please try again.");
        setBusy(false);
        return;
      }

      useStore.getState().setUser(created.profile);
      useStore.getState().setOrg(created.org);
      // Forward the pricing-page plan hint (?plan=crew) so the wizard's
      // plan step lands on the visitor's chosen tier.
      const planHint = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("plan")
        : null;
      window.location.href = planHint ? `/onboarding?plan=${planHint}` : "/onboarding";
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: BG, color: "#e2e2e8", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <a href="/pricing" style={{ textDecoration: "none" }}>
            <img
              src="/CREED_LOGO.png"
              alt="Creed"
              style={{ height: 90, display: "block", margin: "0 auto 10px" }}
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          </a>
          <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 26, color: PRIMARY, textTransform: "uppercase", letterSpacing: ".05em", margin: "0 0 6px" }}>
            Start your free trial
          </h1>
          <p style={{ fontSize: 13, color: "#999", margin: 0, lineHeight: 1.5 }}>
            30 days free · No charge until your trial ends · Cancel anytime
          </p>
        </div>

        <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 22 }}>
          {emailSent ? (
            <div style={{ textAlign: "center", padding: "6px 0" }}>
              <div style={{ fontSize: 42, marginBottom: 10 }}>✉</div>
              <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 18, color: ACCENT, textTransform: "uppercase", margin: "0 0 10px" }}>
                Check your inbox
              </h2>
              <p style={{ color: "#aaa", fontSize: 13, lineHeight: 1.5 }}>
                We sent a verification link to <strong style={{ color: "#ddd" }}>{email}</strong>.
                Click it and we&apos;ll bring you straight to setup.
              </p>
              <p style={{ color: "#666", fontSize: 11, marginTop: 14 }}>
                Already verified? <a href="/" style={{ color: PRIMARY }}>Sign in</a>
              </p>
            </div>
          ) : (
            <>
              <label style={lbl}>Your name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Bernard Smith"
                autoComplete="name"
                style={{ ...inp, marginBottom: 10 }}
              />

              <label style={lbl}>Work email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourbusiness.com"
                autoComplete="email"
                inputMode="email"
                style={{ ...inp, marginBottom: 10 }}
              />

              <label style={lbl}>Password</label>
              <div style={{ position: "relative", marginBottom: 12 }}>
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  style={{ ...inp, paddingRight: 40 }}
                />
                <span
                  onClick={() => setShowPw(!showPw)}
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", cursor: "pointer", fontSize: 16, userSelect: "none" }}
                >
                  {showPw ? "🙈" : "👁"}
                </span>
              </div>

              {err && (
                <div style={{ background: "#3a0d0d", border: "1px solid #C00000", borderRadius: 6, padding: "8px 10px", marginBottom: 12, fontSize: 12, color: "#ff8888" }}>
                  {err}
                </div>
              )}

              <button
                onClick={submit}
                disabled={busy}
                style={{
                  width: "100%", padding: 12, borderRadius: 8,
                  fontFamily: "Oswald, sans-serif", fontSize: 14,
                  textTransform: "uppercase", letterSpacing: ".05em",
                  background: busy ? "#333" : PRIMARY, color: "#fff",
                  border: "none", cursor: busy ? "wait" : "pointer",
                  opacity: busy ? 0.7 : 1,
                }}
              >
                {busy ? "Creating account…" : "Create my account"}
              </button>

              <p style={{ textAlign: "center", color: "#666", fontSize: 11, marginTop: 14 }}>
                Already have an account? <a href="/" style={{ color: PRIMARY, textDecoration: "none" }}>Sign in</a>
              </p>
            </>
          )}
        </div>

        <div style={{ textAlign: "center", marginTop: 14, color: "#555", fontSize: 11 }}>
          <a href="/pricing" style={{ color: "#888", textDecoration: "none" }}>← Back to pricing</a>
        </div>
      </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  width: "100%",
  padding: "11px 13px",
  borderRadius: 8,
  border: "1px solid #1e1e2e",
  background: "#0d0d15",
  color: "#e2e2e8",
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const lbl: React.CSSProperties = {
  fontSize: 11,
  color: "#888",
  fontFamily: "Oswald, sans-serif",
  textTransform: "uppercase",
  letterSpacing: ".06em",
  marginBottom: 4,
  display: "block",
};
