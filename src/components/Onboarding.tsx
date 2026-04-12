"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import type { Organization, Profile } from "@/lib/types";

export default function Onboarding() {
  const user = useStore((s) => s.user)!;
  const setUser = useStore((s) => s.setUser);
  const setOrg = useStore((s) => s.setOrg);

  const [step, setStep] = useState<"create" | "join">("create");
  const [bizName, setBizName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(user.email || "");
  const [license, setLicense] = useState("");
  const [address, setAddress] = useState("");
  const [rate, setRate] = useState("55");
  const [inviteCode, setInviteCode] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const createBusiness = async () => {
    if (!bizName.trim()) { setErr("Enter your business name"); return; }
    setSaving(true);
    setErr("");

    try {
      // Create org
      const orgResult = await db.post<Organization>("organizations", {
        name: bizName.trim(),
        phone,
        email,
        license_num: license,
        address,
        default_rate: parseFloat(rate) || 55,
        trial_start: new Date().toISOString(),
        subscription_status: "trial",
      });

      if (!orgResult?.length) { setErr("Failed to create business"); setSaving(false); return; }
      const org = orgResult[0];

      // Create profile linked to org
      const profileResult = await db.post<Profile>("profiles", {
        id: user.id,
        email: user.email,
        name: user.name,
        role: "owner",
        rate: parseFloat(rate) || 55,
        start_date: new Date().toISOString().split("T")[0],
        emp_num: "001",
        org_id: org.id,
      });

      if (!profileResult?.length) { setErr("Failed to create profile"); setSaving(false); return; }

      setOrg(org);
      setUser(profileResult[0]);
    } catch (e) {
      setErr("Something went wrong");
      console.error(e);
    }
    setSaving(false);
  };

  const joinBusiness = async () => {
    if (!inviteCode.trim()) { setErr("Enter an invite code"); return; }
    setSaving(true);
    setErr("");

    try {
      // Look up org by ID (invite code = org ID for now)
      const orgs = await db.get<Organization>("organizations", { id: inviteCode.trim() });
      if (!orgs.length) { setErr("Business not found — check the invite code"); setSaving(false); return; }
      const org = orgs[0];

      // Create profile linked to org
      const profileResult = await db.post<Profile>("profiles", {
        id: user.id,
        email: user.email,
        name: user.name,
        role: "tech",
        rate: org.default_rate || 35,
        start_date: new Date().toISOString().split("T")[0],
        emp_num: String(Math.floor(Math.random() * 900) + 100),
        org_id: org.id,
      });

      if (!profileResult?.length) { setErr("Failed to join — you may already be a member"); setSaving(false); return; }

      setOrg(org);
      setUser(profileResult[0]);
    } catch (e) {
      setErr("Something went wrong");
      console.error(e);
    }
    setSaving(false);
  };

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
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <img
            src="/CREED_LOGO.png"
            alt=""
            style={{ height: 80, display: "block", margin: "0 auto 12px" }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
          <h1 style={{ fontFamily: "Oswald", fontSize: 22, color: "#2E75B6", textTransform: "uppercase" }}>
            Set Up Your Business
          </h1>
          <p style={{ color: "#888", fontSize: 13, fontFamily: "Source Sans 3", marginTop: 4 }}>
            Welcome, {user.name}! Let&apos;s get you started.
          </p>
        </div>

        {/* Toggle */}
        <div style={{ display: "flex", marginBottom: 16, borderRadius: 8, overflow: "hidden" }}>
          <button
            onClick={() => { setStep("create"); setErr(""); }}
            style={{
              flex: 1, padding: "10px", fontSize: 13, fontFamily: "Oswald", textTransform: "uppercase",
              background: step === "create" ? "#2E75B6" : "#12121a",
              color: step === "create" ? "#fff" : "#888",
              border: "1px solid #1e1e2e", borderRadius: "8px 0 0 8px",
            }}
          >
            Create Business
          </button>
          <button
            onClick={() => { setStep("join"); setErr(""); }}
            style={{
              flex: 1, padding: "10px", fontSize: 13, fontFamily: "Oswald", textTransform: "uppercase",
              background: step === "join" ? "#2E75B6" : "#12121a",
              color: step === "join" ? "#fff" : "#888",
              border: "1px solid #1e1e2e", borderRadius: "0 8px 8px 0",
            }}
          >
            Join a Team
          </button>
        </div>

        <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 24 }}>
          {step === "create" ? (
            <>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 10, color: "#888", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em" }}>Business Name *</label>
                <input value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="e.g. Acme Services LLC" style={{ background: "#1a1a28", border: "1px solid #1e1e2e", color: "#e2e2e8" }} />
              </div>
              <div className="g2" style={{ marginBottom: 10 }}>
                <div>
                  <label style={{ fontSize: 10, color: "#888", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em" }}>Phone</label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" style={{ background: "#1a1a28", border: "1px solid #1e1e2e", color: "#e2e2e8" }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: "#888", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em" }}>License #</label>
                  <input value={license} onChange={(e) => setLicense(e.target.value)} placeholder="Optional" style={{ background: "#1a1a28", border: "1px solid #1e1e2e", color: "#e2e2e8" }} />
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 10, color: "#888", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em" }}>Business Email</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ background: "#1a1a28", border: "1px solid #1e1e2e", color: "#e2e2e8" }} />
              </div>
              <div className="g2" style={{ marginBottom: 10 }}>
                <div>
                  <label style={{ fontSize: 10, color: "#888", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em" }}>City / Address</label>
                  <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Wichita, KS" style={{ background: "#1a1a28", border: "1px solid #1e1e2e", color: "#e2e2e8" }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: "#888", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em" }}>Default Rate ($/hr)</label>
                  <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} style={{ background: "#1a1a28", border: "1px solid #1e1e2e", color: "#e2e2e8" }} />
                </div>
              </div>
              {err && <div style={{ color: "#C00000", fontSize: 12, marginBottom: 8, textAlign: "center" }}>{err}</div>}
              <button onClick={createBusiness} disabled={saving} style={{ width: "100%", padding: 12, fontSize: 15, fontFamily: "Oswald", textTransform: "uppercase", background: saving ? "#333" : "#2E75B6", color: "#fff", border: "none", borderRadius: 8, cursor: saving ? "not-allowed" : "pointer" }}>
                {saving ? "Creating..." : "Create Business"}
              </button>
            </>
          ) : (
            <>
              <p style={{ color: "#888", fontSize: 12, marginBottom: 12 }}>
                Ask your business owner for the invite code. It&apos;s in their Settings → Team tab.
              </p>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 10, color: "#888", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em" }}>Invite Code</label>
                <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="Paste invite code here" style={{ background: "#1a1a28", border: "1px solid #1e1e2e", color: "#e2e2e8" }} />
              </div>
              {err && <div style={{ color: "#C00000", fontSize: 12, marginBottom: 8, textAlign: "center" }}>{err}</div>}
              <button onClick={joinBusiness} disabled={saving} style={{ width: "100%", padding: 12, fontSize: 15, fontFamily: "Oswald", textTransform: "uppercase", background: saving ? "#333" : "#00cc66", color: "#fff", border: "none", borderRadius: 8, cursor: saving ? "not-allowed" : "pointer" }}>
                {saving ? "Joining..." : "Join Team"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
