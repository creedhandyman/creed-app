"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { Icon } from "@/components/Icon";
import { JOIN_CODE_KEY } from "@/lib/signup-helpers";
import { TRIAL_DAYS } from "@/lib/trial";

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
  // Invite link from a boss: /signin?mode=signup&join=<code>. Stash the code
  // for onboarding (it renders at "/" after auth, so the query is gone by
  // then) and open on Create account.
  const [joinCode] = useState(() => {
    if (typeof window === "undefined") return "";
    const code = (new URLSearchParams(window.location.search).get("join") || "").trim();
    if (code) { try { localStorage.setItem(JOIN_CODE_KEY, code); } catch { /* */ } }
    return code;
  });
  const [mode, setMode] = useState<"login" | "signup">(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mode") === "signup") return "signup";
    return "login";
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"" | "verify" | "reset">("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [showPw, setShowPw] = useState(false);

  const handleLogin = async () => {
    if (!email.trim()) { setErr("Enter your email"); return; }
    if (!password) { setErr("Enter your password"); return; }
    setBusy(true);
    const e = await login(email.trim(), password);
    setBusy(false);
    if (e) setErr(e === "Invalid login credentials" ? "That email and password don't match — try again or tap Forgot password." : e);
  };

  const handleSignup = async () => {
    if (!name.trim()) { setErr("Enter your name"); return; }
    if (!email.trim()) { setErr("Enter your email"); return; }
    if (password.length < 6) { setErr("Password must be at least 6 characters"); return; }
    setBusy(true);
    const e = await signup(email.trim(), password, name.trim());
    setBusy(false);
    if (e === "CHECK_EMAIL") { setNotice("verify"); setErr(""); return; }
    // "ONBOARD" = signed up with an instant session; the shell redirects.
    if (e && e !== "ONBOARD") setErr(e === "Email already registered" ? "That email already has an account — sign in instead." : e);
  };

  const submit = () => { if (!busy) void (mode === "login" ? handleLogin() : handleSignup()); };
  const switchMode = (m: "login" | "signup") => { setMode(m); setErr(""); setNotice(""); };

  const forgot = async () => {
    if (!email.trim()) { setErr("Enter your email first"); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) { setErr(error.message); return; }
    setErr("");
    setNotice("reset");
  };

  return (
    <div className="signwrap">
      {/* Brand panel (hidden on mobile) */}
      <div className="signbrand">
        <span className="blogo">C</span>
        {mode === "login" ? (
          <>
            <h2>Welcome back to<br /><span className="g">Creed Handy Manager</span></h2>
            <p>The whole business — quotes, crew, and payments — waiting right where you left it.</p>
          </>
        ) : (
          <>
            <h2>Run the whole business from<br /><span className="g">Creed Handy Manager</span></h2>
            <p>{`Quotes, crew, and payments in one app. Free for ${TRIAL_DAYS} days — no card needed.`}</p>
          </>
        )}
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
          <div className="fsub">
            {mode === "login"
              ? "Welcome back — let's get to work."
              : joinCode
                ? "Create your account, then you'll join your team."
                : `Start your ${TRIAL_DAYS}-day free trial — no card needed.`}
          </div>

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
          {notice === "verify" && <div className="signok">✉ Almost there — open the email we just sent and tap the link to confirm. It brings you right back to finish setup.</div>}
          {notice === "reset" && <div className="signok">✉ Check your email for a link to reset your password.</div>}

          <button className="btn btn-glow btn-full btn-lg" onClick={submit} disabled={busy} style={busy ? { opacity: 0.7, cursor: "wait" } : undefined}>
            <Icon name={mode === "login" ? "check" : "rocket"} size={18} /> {busy ? (mode === "login" ? "Signing in…" : "Creating…") : mode === "login" ? "Sign in" : "Create account"}
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
