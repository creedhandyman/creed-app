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
        {["account", "team", "general"].map((t) => (
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
        </div>
      )}
    </div>
  );
}
