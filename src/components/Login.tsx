"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { Icon } from "@/components/Icon";

/**
 * Sign-in / Create-account form, re-skinned to the marketing split layout.
 * Visual only — the auth flow is unchanged: store login()/signup(), the
 * "CHECK_EMAIL" verify state, show/hide password, and reset-password all work
 * exactly as before. Rendered at /signin inside <MarketingShell> (which
 * supplies the `.mkt` scope, nav, and footer). Reads ?mode=signup to open on
 * the Create-account tab (the marketing CTAs link there).
 */
export default function Login() {
  const login = useStore((s) => s.login);
  const signup = useStore((s) => s.signup);
  const [mode, setMode] = useState<"login" | "signup">(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mode") === "signup") return "signup";
    return "login";
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleLogin = async () => {
    if (!email.trim()) { setErr("Enter your email"); return; }
    if (!password) { setErr("Enter your password"); return; }
    const e = await login(email.trim(), password);
    if (e) setErr(e);
  };

  const handleSignup = async () => {
    if (!name.trim()) { setErr("Enter your name"); return; }
    if (!email.trim()) { setErr("Enter your email"); return; }
    if (password.length < 6) { setErr("Password must be at least 6 characters"); return; }
    const e = await signup(email.trim(), password, name.trim());
    if (e === "CHECK_EMAIL") { setEmailSent(true); setErr(""); return; }
    if (e) setErr(e);
  };

  const submit = mode === "login" ? handleLogin : handleSignup;
  const switchMode = (m: "login" | "signup") => { setMode(m); setErr(""); setEmailSent(false); };

  const forgot = async () => {
    if (!email.trim()) { setErr("Enter your email first"); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) { setErr(error.message); return; }
    setErr("");
    setEmailSent(true);
  };

  return (
    <div className="signwrap">
      {/* Brand panel (hidden on mobile) */}
      <div className="signbrand">
        <span className="blogo">C</span>
        <h2>Welcome back to<br /><span className="g">Creed Handy Manager</span></h2>
        <p>The whole business — quotes, crew, and payments — waiting right where you left it.</p>
        <div className="sigfeat">
          <div><Icon name="sparkle" size={18} color="#3ee08f" /> Quote a job in minutes with AI</div>
          <div><Icon name="schedule" size={18} color="#3ee08f" /> Dispatch the crew &amp; track time</div>
          <div><Icon name="money" size={18} color="#3ee08f" /> Get paid through Stripe</div>
        </div>
      </div>

      {/* Form card */}
      <div className="signform">
        <div className="formcard">
          <div className="seg">
            <b className={mode === "login" ? "on" : ""} onClick={() => switchMode("login")}>Sign in</b>
            <b className={mode === "signup" ? "on" : ""} onClick={() => switchMode("signup")}>Create account</b>
          </div>
          <h3>{mode === "login" ? "Sign in" : "Create account"}</h3>
          <div className="fsub">{mode === "login" ? "Welcome back — let's get to work." : "Start your free month — no card needed."}</div>

          {mode === "signup" && (
            <div className="field">
              <label>Your name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Creed" autoComplete="name" />
            </div>
          )}
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" autoComplete="email" />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="••••••••"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
            <button type="button" className="eye" onClick={() => setShowPw(!showPw)} aria-label={showPw ? "Hide password" : "Show password"}>{showPw ? "🙈" : "👁"}</button>
          </div>
          <div className="frow-sm">
            <span>{mode === "signup" ? "Min 6 characters" : ""}</span>
            {mode === "login" && <a onClick={forgot}>Forgot password?</a>}
          </div>

          {err && <div className="signerr">{err}</div>}
          {emailSent && <div className="signok">✉ Check your email to verify your account, then come back here and sign in.</div>}

          <button className="btn btn-glow btn-full btn-lg" onClick={submit}>
            <Icon name={mode === "login" ? "check" : "rocket"} size={18} /> {mode === "login" ? "Sign in" : "Create account"}
          </button>

          <div className="altline">
            {mode === "login" ? "New to Creed? " : "Already have an account? "}
            <a onClick={() => switchMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "Create an account" : "Sign in"}</a>
          </div>
        </div>
      </div>
    </div>
  );
}
