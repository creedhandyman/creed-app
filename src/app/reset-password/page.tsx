"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Password-reset landing page. The reset email links here (see Login.tsx
 * `forgot()` → resetPasswordForEmail redirectTo). Supabase appends the recovery
 * token to the URL; supabase-js establishes a short-lived recovery session
 * (implicit/hash flow via detectSessionInUrl, or PKCE `?code=`), after which we
 * let the user set a new password with updateUser(). Without this page the link
 * had nowhere valid to land — it looked dead.
 *
 * Supabase dashboard requirements: Site URL = the production domain, and this
 * path must be in Authentication → URL Configuration → Redirect URLs.
 */
export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    const finishChecking = () => { if (active) setChecking(false); };

    // PKCE flow: a `?code=` is present — exchange it for the recovery session.
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
        if (active && data?.session && !error) setReady(true);
        finishChecking();
      });
      return () => { active = false; };
    }

    // Implicit/hash flow: supabase-js auto-detects the recovery token in the URL
    // and fires PASSWORD_RECOVERY (or yields a session). Either means it's valid.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || session) { setReady(true); setChecking(false); }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) { setReady(true); setChecking(false); }
      else setTimeout(finishChecking, 1500); // give hash detection a beat
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  const submit = async () => {
    setErr("");
    if (pw.length < 6) { setErr("Use at least 6 characters."); return; }
    if (pw !== pw2) { setErr("Passwords don't match."); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setDone(true);
    // Drop the recovery session and send them to sign in with the new password.
    await supabase.auth.signOut();
    setTimeout(() => { window.location.href = "/signin"; }, 1800);
  };

  const wrap: React.CSSProperties = {
    minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f, #0d1530)",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    fontFamily: "Source Sans 3, sans-serif",
  };
  const card: React.CSSProperties = {
    width: "100%", maxWidth: 400, background: "#12121a", border: "1px solid #1e1e2e",
    borderRadius: 14, padding: 26, textAlign: "center",
  };
  const input: React.CSSProperties = {
    width: "100%", padding: "11px 12px", borderRadius: 8, border: "1px solid #2a2a3a",
    background: "#0a0a0f", color: "#fff", fontSize: 16, marginBottom: 10,
  };

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: 30, color: "#2E75B6", marginBottom: 4 }}>C</div>
        <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, textTransform: "uppercase", color: "#e8e8ee", marginBottom: 14 }}>
          Reset password
        </h1>

        {checking ? (
          <p style={{ color: "#888", fontSize: 15 }}>Verifying your reset link…</p>
        ) : done ? (
          <p style={{ color: "#3ee08f", fontSize: 15 }}>Password updated — redirecting you to sign in…</p>
        ) : !ready ? (
          <>
            <p style={{ color: "#ff7a7a", fontSize: 15, marginBottom: 14 }}>
              This reset link is invalid or has expired.
            </p>
            <a href="/signin" style={{ color: "#2E75B6", fontSize: 15 }}>Request a new link</a>
          </>
        ) : (
          <>
            <p style={{ color: "#888", fontSize: 14, marginBottom: 16 }}>Choose a new password for your account.</p>
            <input
              type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)}
              placeholder="New password" autoComplete="new-password" style={input}
            />
            <input
              type={show ? "text" : "password"} value={pw2} onChange={(e) => setPw2(e.target.value)}
              placeholder="Confirm new password" autoComplete="new-password" style={input}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "#888", margin: "2px 0 14px", cursor: "pointer" }}>
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} style={{ width: "auto", margin: 0 }} />
              Show password
            </label>
            {err && <p style={{ color: "#ff7a7a", fontSize: 14, marginBottom: 10 }}>{err}</p>}
            <button
              onClick={submit} disabled={saving}
              style={{
                width: "100%", padding: 13, fontSize: 16, fontFamily: "Oswald, sans-serif",
                textTransform: "uppercase", background: saving ? "#333" : "#2E75B6", color: "#fff",
                border: "none", borderRadius: 8, cursor: saving ? "wait" : "pointer",
              }}
            >
              {saving ? "Saving…" : "Set new password"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
