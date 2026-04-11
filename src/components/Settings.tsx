"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { supabase, db } from "@/lib/supabase";

interface Props {
  onClose: () => void;
}

export default function Settings({ onClose }: Props) {
  const user = useStore((s) => s.user)!;
  const org = useStore((s) => s.org);
  const setUser = useStore((s) => s.setUser);
  const logout = useStore((s) => s.logout);
  const profiles = useStore((s) => s.profiles);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);
  const toggleDark = useStore((s) => s.toggleDark);
  const navLeft = useStore((s) => s.navLeft);
  const toggleNavSide = useStore((s) => s.toggleNavSide);

  const [tab, setTab] = useState("account");
  const [newPassword, setNewPassword] = useState("");

  const isOwner = user.role === "owner" || user.role === "manager";

  return (
    <div className="fi" style={{ maxWidth: 500, margin: "0 auto", padding: "16px 12px" }}>
      <div className="row mb">
        <button className="bo" onClick={onClose}>← Back</button>
        <h2 style={{ fontSize: 20, color: "var(--color-primary)" }}>⚙️ Settings</h2>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        {["account", "team", "operations", "payments", "general"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              fontSize: 11,
              background: tab === t ? "var(--color-primary)" : "transparent",
              color: tab === t ? "#fff" : "#888",
              fontFamily: "Oswald",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Account tab */}
      {tab === "account" && (
        <div>
          <div className="cd mb">
            {[
              ["Business", org?.name || "—"],
              ["Name", user.name],
              ["Email", user.email],
              ["Role", user.role],
              ["#", user.emp_num],
              ["Rate", "$" + (user.rate || 55) + "/hr"],
              ["Start", user.start_date],
            ].map(([label, value], i) => (
              <div key={i} className="sep" style={{ fontSize: 13 }}>
                <span className="dim">{label}:</span> {value || "—"}
              </div>
            ))}
          </div>

          <div className="cd mb">
            <h4 style={{ fontSize: 14, marginBottom: 8 }}>Change Password</h4>
            <div className="row">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 6)"
              />
              <button
                className="bb"
                onClick={async () => {
                  if (newPassword.length < 6) { alert("Min 6"); return; }
                  const { error } = await supabase.auth.updateUser({ password: newPassword });
                  if (error) { alert(error.message); return; }
                  setNewPassword("");
                  alert("Password updated");
                }}
              >
                Save
              </button>
            </div>
          </div>

          <div className="cd">
            <button
              className="br"
              onClick={() => { logout(); onClose(); }}
              style={{ width: "100%" }}
            >
              Sign Out
            </button>
          </div>
        </div>
      )}

      {/* Team tab */}
      {tab === "team" && (
        <div className="cd">
          {/* Invite code */}
          {isOwner && user.org_id && (
            <div style={{ marginBottom: 12, padding: 10, background: darkMode ? "#1a1a28" : "#f0f4f8", borderRadius: 8 }}>
              <div className="sl" style={{ marginBottom: 4 }}>Invite Code (share with team)</div>
              <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--color-primary)", wordBreak: "break-all" }}>
                {user.org_id}
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(user.org_id); alert("Copied!"); }}
                style={{ fontSize: 10, marginTop: 4, background: "none", color: "var(--color-primary)", padding: 0, textDecoration: "underline" }}
              >
                Copy to clipboard
              </button>
            </div>
          )}
          <h4 style={{ fontSize: 14, marginBottom: 8 }}>Team ({profiles.length})</h4>
          {profiles.map((u) => (
            <div key={u.id} className="sep" style={{ fontSize: 13 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <b>{u.name}</b>{" "}
                  <span className="dim">#{u.emp_num}</span>
                </div>
                {isOwner ? (
                  <div className="row">
                    <select
                      defaultValue={u.role}
                      style={{ width: "auto", fontSize: 10, padding: "2px 4px" }}
                      onChange={async (e) => {
                        await db.patch("profiles", u.id, { role: e.target.value });
                        loadAll();
                      }}
                    >
                      <option value="apprentice">Apprentice</option>
                      <option value="tech">Tech</option>
                      <option value="manager">Manager</option>
                      <option value="owner">Owner</option>
                    </select>
                    <span>$</span>
                    <input
                      type="number"
                      defaultValue={u.rate}
                      style={{ width: 55, padding: "2px 4px", fontSize: 12 }}
                      onBlur={async (e) => {
                        await db.patch("profiles", u.id, {
                          rate: parseFloat(e.target.value) || 0,
                        });
                        loadAll();
                      }}
                    />
                    <span style={{ fontSize: 11 }}>/hr</span>
                  </div>
                ) : (
                  <span>${u.id === user.id ? user.rate : "—"}/hr</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Operations tab */}
      {tab === "operations" && isOwner && (
        <div className="cd">
          <h4 style={{ fontSize: 14, marginBottom: 12 }}>📊 Quote Settings</h4>

          <div className="g2 mb">
            <div>
              <label className="sl">Markup %</label>
              <input
                type="number"
                defaultValue={org?.markup_pct || 0}
                min="0"
                step="1"
                placeholder="0"
                style={{ marginTop: 4 }}
                onBlur={async (e) => {
                  if (org) await db.patch("organizations", org.id, { markup_pct: parseFloat(e.target.value) || 0 });
                  loadAll();
                }}
              />
              <div className="dim" style={{ fontSize: 9, marginTop: 2 }}>Applied to material costs</div>
            </div>
            <div>
              <label className="sl">Tax %</label>
              <input
                type="number"
                defaultValue={org?.tax_pct || 0}
                min="0"
                step="0.1"
                placeholder="0"
                style={{ marginTop: 4 }}
                onBlur={async (e) => {
                  if (org) await db.patch("organizations", org.id, { tax_pct: parseFloat(e.target.value) || 0 });
                  loadAll();
                }}
              />
              <div className="dim" style={{ fontSize: 9, marginTop: 2 }}>Applied to quote total</div>
            </div>
          </div>

          <div style={{ marginBottom: 8, borderTop: `1px solid ${darkMode ? "#1e1e2e" : "#eee"}`, paddingTop: 12 }}>
            <label className="sl">Default Labor Rate</label>
            <div className="row" style={{ marginTop: 4 }}>
              <span>$</span>
              <input
                type="number"
                defaultValue={org?.default_rate || 55}
                min="0"
                step="1"
                style={{ width: 80 }}
                onBlur={async (e) => {
                  if (org) await db.patch("organizations", org.id, { default_rate: parseFloat(e.target.value) || 55 });
                  loadAll();
                }}
              />
              <span style={{ fontSize: 11 }}>/hr</span>
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${darkMode ? "#1e1e2e" : "#eee"}`, paddingTop: 12 }}>
            <label className="sl">Custom Rates by Trade</label>
            <div className="dim" style={{ fontSize: 10, marginBottom: 8 }}>Override the default rate for specific trades. Leave blank to use default.</div>
            {(() => {
              const trades = ["Plumbing", "Electrical", "Carpentry", "HVAC", "Painting", "Flooring", "General"];
              let tradeRates: Record<string, number> = {};
              try { tradeRates = org?.trade_rates ? JSON.parse(org.trade_rates) : {}; } catch { /* */ }

              return trades.map((trade) => (
                <div key={trade} className="row" style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 12, width: 80 }}>{trade}</span>
                  <span>$</span>
                  <input
                    type="number"
                    defaultValue={tradeRates[trade] || ""}
                    placeholder={String(org?.default_rate || 55)}
                    min="0"
                    step="1"
                    style={{ width: 70, fontSize: 12 }}
                    onBlur={async (e) => {
                      const val = parseFloat(e.target.value);
                      const updated = { ...tradeRates };
                      if (val && val > 0) updated[trade] = val;
                      else delete updated[trade];
                      if (org) await db.patch("organizations", org.id, { trade_rates: JSON.stringify(updated) });
                      loadAll();
                    }}
                  />
                  <span style={{ fontSize: 11 }}>/hr</span>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* Payments tab */}
      {tab === "payments" && (
        <div className="cd">
          <h4 style={{ fontSize: 14, marginBottom: 8 }}>💳 Payment Processing</h4>
          {org?.stripe_connected ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ color: "var(--color-success)", fontSize: 18 }}>✅</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Stripe Connected</div>
                  <div className="dim" style={{ fontSize: 11 }}>
                    Account: {org.stripe_account_id?.slice(0, 12)}...
                  </div>
                </div>
              </div>
              <p className="dim" style={{ fontSize: 11 }}>
                You can generate payment links from the Jobs screen. Clients pay online and the money goes directly to your Stripe account.
              </p>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 12, marginBottom: 12, color: darkMode ? "#ccc" : "#333" }}>
                Connect your Stripe account to accept online payments from clients.
                Money goes directly to your bank — we take a small 2% platform fee.
              </p>
              {isOwner ? (
                <button
                  className="bb"
                  onClick={async () => {
                    try {
                      const res = await fetch("/api/stripe/connect", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          orgId: user.org_id,
                          orgName: org?.name,
                          email: user.email,
                          returnUrl: window.location.origin,
                        }),
                      });
                      const data = await res.json();
                      if (data.url) {
                        // Save account ID to org before redirecting
                        await db.patch("organizations", user.org_id, {
                          stripe_account_id: data.accountId,
                        });
                        window.location.href = data.url;
                      } else {
                        alert("Error: " + (data.error || "Could not start Stripe setup"));
                      }
                    } catch {
                      alert("Failed to start Stripe setup");
                    }
                  }}
                  style={{ fontSize: 13, padding: "10px 20px" }}
                >
                  🔗 Connect Stripe Account
                </button>
              ) : (
                <p className="dim" style={{ fontSize: 11 }}>
                  Ask your business owner to connect Stripe in Settings.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* General tab */}
      {tab === "general" && (
        <div className="cd">
          <h4 style={{ fontSize: 14, marginBottom: 8 }}>Appearance</h4>
          <div className="sep row" style={{ justifyContent: "space-between" }}>
            <span>Dark Mode</span>
            <div
              onClick={toggleDark}
              style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                background: darkMode ? "var(--color-primary)" : "#ccc",
                position: "relative",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  background: "#fff",
                  position: "absolute",
                  top: 3,
                  left: darkMode ? 23 : 3,
                  transition: "0.3s",
                }}
              />
            </div>
          </div>
          <div className="sep row" style={{ justifyContent: "space-between" }}>
            <span>Nav Bar: {navLeft ? "Left" : "Right"}</span>
            <div
              onClick={toggleNavSide}
              style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                background: navLeft ? "var(--color-primary)" : "#ccc",
                position: "relative",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  background: "#fff",
                  position: "absolute",
                  top: 3,
                  left: navLeft ? 23 : 3,
                  transition: "0.3s",
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
