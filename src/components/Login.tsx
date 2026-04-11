"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";

export default function Login() {
  const login = useStore((s) => s.login);
  const signup = useStore((s) => s.signup);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [showPw, setShowPw] = useState(false);

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
    if (e) setErr(e);
  };

  const submit = mode === "login" ? handleLogin : handleSignup;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0a0a0f, #0d1530)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ width: 340 }}>
        {/* Logo + Title */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <img
            src="/CREED_LOGO.png"
            alt=""
            style={{ height: 120, display: "block", margin: "0 auto 12px" }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
          <h1 style={{ color: "#2E75B6", fontSize: 24 }}>Creed Handyman</h1>
          <div
            style={{
              color: "#C00000",
              fontSize: 11,
              fontFamily: "Oswald",
              letterSpacing: ".15em",
            }}
          >
            LLC
          </div>
        </div>

        {/* Card */}
        <div
          className="cd"
          style={{
            padding: 24,
            background: "#12121a",
            border: "1px solid #1e1e2e",
          }}
        >
          <h3
            style={{
              textAlign: "center",
              marginBottom: 14,
              color: "#e2e2e8",
              fontSize: 16,
            }}
          >
            {mode === "login" ? "Sign In" : "Create Account"}
          </h3>

          {mode === "signup" && (
            <div style={{ marginBottom: 8 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                style={{ background: "#1a1a28", color: "#e2e2e8", border: "1px solid #1e1e2e" }}
              />
            </div>
          )}

          <div style={{ marginBottom: 8 }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              style={{ background: "#1a1a28", color: "#e2e2e8", border: "1px solid #1e1e2e" }}
            />
          </div>

          <div style={{ marginBottom: 12, position: "relative" }}>
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              onKeyDown={(e) => e.key === "Enter" && submit()}
              style={{ background: "#1a1a28", color: "#e2e2e8", border: "1px solid #1e1e2e", paddingRight: 40 }}
            />
            <span
              onClick={() => setShowPw(!showPw)}
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                cursor: "pointer",
                fontSize: 16,
                userSelect: "none",
              }}
            >
              {showPw ? "🙈" : "👁"}
            </span>
          </div>

          {err && (
            <div style={{ color: "#C00000", fontSize: 12, marginBottom: 8, textAlign: "center" }}>
              {err}
            </div>
          )}

          <button className="bb" onClick={submit} style={{ width: "100%", padding: 11, fontSize: 15 }}>
            {mode === "login" ? "Sign In" : "Sign Up"}
          </button>

          <div style={{ textAlign: "center", marginTop: 12, fontSize: 12, color: "#888" }}>
            {mode === "login" ? "No account? " : "Have account? "}
            <span
              onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(""); }}
              style={{ color: "#2E75B6", cursor: "pointer", textDecoration: "underline" }}
            >
              {mode === "login" ? "Sign Up" : "Sign In"}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: 14, color: "#888", fontSize: 10 }}>
          Lic #8145054 · Wichita, KS · (316) 252-6335
        </div>
      </div>
    </div>
  );
}
