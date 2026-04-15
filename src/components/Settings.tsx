"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { supabase, db } from "@/lib/supabase";
import { t } from "@/lib/i18n";

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
  const navBottom = useStore((s) => s.navBottom);
  const toggleNavSide = useStore((s) => s.toggleNavSide);
  const toggleNavBottom = useStore((s) => s.toggleNavBottom);

  const [tab, setTab] = useState("account");
  const [newPassword, setNewPassword] = useState("");

  const isOwner = user.role === "owner" || user.role === "manager";

  return (
    <div className="fi" style={{ maxWidth: 500, margin: "0 auto", padding: "16px 12px" }}>
      <div className="row mb">
        <button className="bo" onClick={onClose}>← Back</button>
        <h2 style={{ fontSize: 20, color: "var(--color-primary)" }}>⚙️ {t("settings.title")}</h2>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        {["account", "team", "operations", "payments", "general"].map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              fontSize: 13,
              background: tab === tb ? "var(--color-primary)" : "transparent",
              color: tab === tb ? "#fff" : "#888",
              fontFamily: "Oswald",
            }}
          >
            {t(`settings.${tb}`)}
          </button>
        ))}
      </div>

      {/* Account tab */}
      {tab === "account" && (
        <div>
          {/* Logo upload */}
          {isOwner && (
            <div className="cd mb" style={{ textAlign: "center", padding: 16 }}>
              <img
                src={org?.logo_url || "/CREED_LOGO.png"}
                alt="Logo"
                style={{ height: 60, display: "block", margin: "0 auto 8px", borderRadius: 8 }}
                onError={(e) => ((e.target as HTMLImageElement).src = "/CREED_LOGO.png")}
              />
              <input
                type="file"
                accept="image/*"
                id="logo-upload"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !org) return;
                  const ext = file.name.split(".").pop() || "png";
                  const path = `logos/${org.id}.${ext}`;
                  const { error } = await supabase.storage.from("receipts").upload(path, file, { upsert: true });
                  if (error) { useStore.getState().showToast("Upload failed: " + error.message, "error"); return; }
                  const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(path);
                  await db.patch("organizations", org.id, { logo_url: urlData.publicUrl });
                  loadAll();
                  // Refresh org in store
                  const orgs = await db.get("organizations", { id: org.id });
                  if (orgs.length) { useStore.getState().setOrg(orgs[0] as any); }
                }}
              />
              <button
                className="bo"
                onClick={() => document.getElementById("logo-upload")?.click()}
                style={{ fontSize: 12, padding: "4px 12px" }}
              >
                📷 Change Logo
              </button>
            </div>
          )}
          {/* Editable business info */}
          {isOwner && org && (
            <div className="cd mb">
              <h4 style={{ fontSize: 14, marginBottom: 8 }}>{t("settings.businessInfo")}</h4>
              {[
                { label: "Business Name", field: "name", value: org.name, table: "organizations" },
                { label: "Phone", field: "phone", value: org.phone, table: "organizations" },
                { label: "Email", field: "email", value: org.email, table: "organizations" },
                { label: "Address", field: "address", value: org.address, table: "organizations" },
                { label: "License #", field: "license_num", value: org.license_num, table: "organizations" },
              ].map((f) => (
                <div key={f.field} style={{ marginBottom: 6 }}>
                  <label className="sl" style={{ fontSize: 12 }}>{f.label}</label>
                  <input
                    key={`${f.field}-${f.value}`}
                    defaultValue={f.value || ""}
                    onBlur={async (e) => {
                      const val = e.target.value.trim();
                      if (val !== (f.value || "")) {
                        await db.patch("organizations", org.id, { [f.field]: val });
                        const orgs = await db.get("organizations", { id: org.id });
                        if (orgs.length) useStore.getState().setOrg(orgs[0] as any);
                        useStore.getState().showToast(`${f.label} updated`, "success");
                      }
                    }}
                    style={{ fontSize: 13 }}
                  />
                </div>
              ))}
            </div>
          )}

          {/* User info */}
          <div className="cd mb">
            <h4 style={{ fontSize: 14, marginBottom: 8 }}>{t("settings.yourProfile")}</h4>
            {[
              { label: "Name", value: user.name, field: "name" },
              { label: "Email", value: user.email, field: "" },
              { label: "Role", value: user.role, field: "" },
              { label: "Employee #", value: user.emp_num, field: "" },
              { label: "Rate", value: "$" + (user.rate || 55) + "/hr", field: "" },
              { label: "Start Date", value: user.start_date, field: "" },
            ].map((f, i) => (
              <div key={i} className="sep" style={{ fontSize: 13 }}>
                <span className="dim">{f.label}:</span> {f.value || "—"}
              </div>
            ))}
          </div>

          <div className="cd mb">
            <h4 style={{ fontSize: 14, marginBottom: 8 }}>{t("settings.changePassword")}</h4>
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
                  if (newPassword.length < 6) { useStore.getState().showToast("Min 6 characters", "warning"); return; }
                  const { error } = await supabase.auth.updateUser({ password: newPassword });
                  if (error) { useStore.getState().showToast(error.message, "error"); return; }
                  setNewPassword("");
                  useStore.getState().showToast("Password updated", "success");
                }}
              >
                {t("settings.save")}
              </button>
            </div>
          </div>

          <div className="cd mb">
            <button
              className="br"
              onClick={() => { logout(); onClose(); }}
              style={{ width: "100%" }}
            >
              {t("settings.logout")}
            </button>
          </div>
          <div className="cd">
            <button
              className="bo"
              onClick={async () => {
                if (!await useStore.getState().showConfirm("Delete Account", "Delete your account? This cannot be undone.")) return;
                if (!await useStore.getState().showConfirm("Are You Sure?", "All your data will be lost.")) return;
                await db.del("profiles", user.id);
                logout();
                onClose();
              }}
              style={{ width: "100%", fontSize: 12, color: "var(--color-accent-red)" }}
            >
              {t("settings.deleteAccount")}
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
              <div style={{ fontFamily: "monospace", fontSize: 13, color: "var(--color-primary)", wordBreak: "break-all" }}>
                {user.org_id}
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(user.org_id); useStore.getState().showToast("Copied!", "success"); }}
                style={{ fontSize: 12, marginTop: 4, background: "none", color: "var(--color-primary)", padding: 0, textDecoration: "underline" }}
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
                      style={{ width: "auto", fontSize: 12, padding: "2px 4px" }}
                      onChange={async (e) => {
                        if (u.id === user.id && (e.target.value === "tech" || e.target.value === "apprentice")) {
                          if (!await useStore.getState().showConfirm("Warning", "Demoting yourself will lock you out of admin settings. Are you sure?")) {
                            e.target.value = u.role;
                            return;
                          }
                        }
                        await db.patch("profiles", u.id, { role: e.target.value });
                        if (u.id === user.id) setUser({ ...user, role: e.target.value as any });
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
                        const newRate = parseFloat(e.target.value) || 0;
                        await db.patch("profiles", u.id, { rate: newRate });
                        await loadAll();
                        // If updating own rate, refresh user in store
                        if (u.id === user.id) {
                          setUser({ ...user, rate: newRate });
                        }
                      }}
                    />
                    <span style={{ fontSize: 11 }}>/hr</span>
                    {u.id !== user.id && (
                      <button
                        onClick={async () => {
                          if (!await useStore.getState().showConfirm("Remove Team Member", `Remove ${u.name} from the team?`)) return;
                          await db.del("profiles", u.id);
                          loadAll();
                        }}
                        style={{ background: "none", color: "var(--color-accent-red)", fontSize: 12, padding: "0 4px" }}
                      >
                        ✕
                      </button>
                    )}
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
          {/* Licensed Trades */}
          <h4 style={{ fontSize: 14, marginBottom: 8 }}>🔑 Licensed Trades</h4>
          <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>Select trades your business is licensed for. AI will fully quote these instead of flagging for subcontractors.</div>
          {(() => {
            const allTrades = ["Electrical", "Plumbing", "HVAC", "Roofing", "Gas Fitting", "Fire Protection", "Structural", "Asbestos/Mold"];
            let licensed: string[] = [];
            try { licensed = org?.licensed_trades ? JSON.parse(org.licensed_trades) : []; } catch { /* */ }

            return (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 16 }}>
                {allTrades.map((trade) => {
                  const isLicensed = licensed.includes(trade);
                  return (
                    <label
                      key={trade}
                      onClick={async () => {
                        const updated = isLicensed ? licensed.filter((t) => t !== trade) : [...licensed, trade];
                        if (org) {
                          await db.patch("organizations", org.id, { licensed_trades: JSON.stringify(updated) });
                          const orgs = await db.get("organizations", { id: org.id });
                          if (orgs.length) useStore.getState().setOrg(orgs[0] as any);
                        }
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 6, padding: "5px 8px",
                        borderRadius: 6, cursor: "pointer", fontSize: 12,
                        background: isLicensed ? "var(--color-success)" + "15" : "transparent",
                        border: `1px solid ${isLicensed ? "var(--color-success)" : darkMode ? "#1e1e2e" : "#ddd"}`,
                      }}
                    >
                      <span style={{ fontSize: 14, color: isLicensed ? "var(--color-success)" : "#555" }}>
                        {isLicensed ? "☑" : "☐"}
                      </span>
                      {trade}
                    </label>
                  );
                })}
              </div>
            );
          })()}

          <h4 style={{ fontSize: 14, marginBottom: 12 }}>📊 Quote Settings</h4>

          {(() => {
            const refreshOrg = async () => {
              if (!org) return;
              await loadAll();
              const orgs = await db.get("organizations", { id: org.id });
              if (orgs.length) useStore.getState().setOrg(orgs[0] as any);
            };

            const tradeRates: Record<string, number> = (() => {
              try { return org?.trade_rates ? JSON.parse(org.trade_rates) : {}; } catch { return {}; }
            })();

            return (
              <>
                <div className="g2 mb">
                  <div>
                    <label className="sl">Markup %</label>
                    <input
                      type="number"
                      key={`markup-${org?.markup_pct}`}
                      defaultValue={org?.markup_pct || 0}
                      min="0"
                      step="1"
                      placeholder="0"
                      style={{ marginTop: 4 }}
                      onBlur={async (e) => {
                        if (org) { await db.patch("organizations", org.id, { markup_pct: parseFloat(e.target.value) || 0 }); await refreshOrg(); }
                      }}
                    />
                    <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>Applied to material costs</div>
                  </div>
                  <div>
                    <label className="sl">Tax %</label>
                    <input
                      type="number"
                      key={`tax-${org?.tax_pct}`}
                      defaultValue={org?.tax_pct || 0}
                      min="0"
                      step="0.1"
                      placeholder="0"
                      style={{ marginTop: 4 }}
                      onBlur={async (e) => {
                        if (org) { await db.patch("organizations", org.id, { tax_pct: parseFloat(e.target.value) || 0 }); await refreshOrg(); }
                      }}
                    />
                    <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>Applied to quote total</div>
                  </div>
                </div>

                <div className="g2" style={{ marginTop: 8 }}>
                  <div>
                    <label className="sl">Trip Fee ($)</label>
                    <input
                      type="number"
                      key={`trip-${org?.trip_fee}`}
                      defaultValue={org?.trip_fee || 0}
                      min="0"
                      step="5"
                      placeholder="0"
                      style={{ marginTop: 4 }}
                      onBlur={async (e) => {
                        if (org) { await db.patch("organizations", org.id, { trip_fee: parseFloat(e.target.value) || 0 }); await refreshOrg(); }
                      }}
                    />
                    <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>Charged once per day on-site</div>
                  </div>
                </div>

                <div style={{ borderTop: `1px solid ${darkMode ? "#1e1e2e" : "#eee"}`, paddingTop: 12, marginTop: 12 }}>
                  <label className="sl">Custom Rates by Trade</label>
                  <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>Set hourly rates per trade. These are used in quotes.</div>
                  {["Plumbing", "Electrical", "Carpentry", "HVAC", "Painting", "Flooring", "General"].map((trade) => (
                    <div key={trade} className="row" style={{ marginBottom: 4 }}>
                      <span style={{ fontSize: 12, width: 80 }}>{trade}</span>
                      <span>$</span>
                      <input
                        type="number"
                        key={`${trade}-${tradeRates[trade] || ""}`}
                        defaultValue={tradeRates[trade] || ""}
                        placeholder={String(user.rate || 55)}
                        min="0"
                        step="1"
                        style={{ width: 70, fontSize: 12 }}
                        onBlur={async (e) => {
                          const val = parseFloat(e.target.value);
                          const updated = { ...tradeRates };
                          if (val && val > 0) updated[trade] = val;
                          else delete updated[trade];
                          if (org) { await db.patch("organizations", org.id, { trade_rates: JSON.stringify(updated) }); await refreshOrg(); }
                        }}
                      />
                      <span style={{ fontSize: 11 }}>/hr</span>
                      {tradeRates[trade] && (
                        <span style={{ fontSize: 13, color: "var(--color-success)" }}>✓ saved</span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
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
                    const btn = document.activeElement as HTMLButtonElement;
                    if (btn) btn.textContent = "Connecting...";
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
                      if (!res.ok) {
                        const text = await res.text();
                        useStore.getState().showToast("Stripe error (" + res.status + "): " + text, "error");
                        if (btn) btn.textContent = "🔗 Connect Stripe Account";
                        return;
                      }
                      const data = await res.json();
                      if (data.url) {
                        await db.patch("organizations", user.org_id, {
                          stripe_account_id: data.accountId,
                        });
                        window.location.href = data.url;
                      } else {
                        useStore.getState().showToast("Error: " + (data.error || "Could not start Stripe setup"), "error");
                        if (btn) btn.textContent = "🔗 Connect Stripe Account";
                      }
                    } catch (e) {
                      useStore.getState().showToast("Failed to start Stripe setup: " + (e instanceof Error ? e.message : "Network error"), "error");
                      if (btn) btn.textContent = "🔗 Connect Stripe Account";
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

      {/* Subscription / Billing */}
      {tab === "payments" && isOwner && (
        <div className="cd" style={{ marginTop: 14 }}>
          <h4 style={{ fontSize: 14, marginBottom: 10 }}>📊 Subscription</h4>
          {(() => {
            const status = org?.subscription_status || "trial";
            const trialStart = org?.trial_start ? new Date(org.trial_start) : new Date();
            const trialEnd = new Date(trialStart);
            trialEnd.setDate(trialEnd.getDate() + 30);
            const daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
            const plan = org?.plan || "solo";

            return (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <span style={{
                      fontSize: 13, padding: "2px 8px", borderRadius: 10, fontFamily: "Oswald",
                      background: status === "active" ? "var(--color-success)" + "22" : status === "trial" ? "var(--color-warning)" + "22" : "var(--color-accent-red)" + "22",
                      color: status === "active" ? "var(--color-success)" : status === "trial" ? "var(--color-warning)" : "var(--color-accent-red)",
                    }}>
                      {status === "active" ? "Active" : status === "trial" ? `Trial — ${daysLeft} days left` : status}
                    </span>
                  </div>
                  <span className="dim" style={{ fontSize: 10 }}>
                    {plan === "business" ? "Business $149/mo" : plan === "team" ? "Team $99/mo" : "Solo $49/mo"}
                  </span>
                </div>

                {status === "trial" && (
                  <div className="dim" style={{ fontSize: 13, marginBottom: 8 }}>
                    Your free trial {daysLeft > 0 ? `ends ${trialEnd.toLocaleDateString()}` : "has ended"}. Subscribe to keep all features.
                  </div>
                )}

                <div className="row">
                  {status !== "active" && (
                    <button
                      className="bb"
                      onClick={async () => {
                        const res = await fetch("/api/billing", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            action: "create-checkout",
                            orgId: org?.id,
                            orgName: org?.name,
                            email: user.email,
                            plan,
                            returnUrl: window.location.origin,
                          }),
                        });
                        const data = await res.json();
                        if (data.url) window.location.href = data.url;
                        else useStore.getState().showToast(data.error || "Failed to start checkout", "error");
                      }}
                      style={{ fontSize: 13, padding: "6px 14px" }}
                    >
                      💳 Subscribe Now
                    </button>
                  )}
                  {org?.stripe_customer_id && (
                    <button
                      className="bo"
                      onClick={async () => {
                        const res = await fetch("/api/billing", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            action: "create-portal",
                            orgId: org?.id,
                            returnUrl: window.location.origin,
                          }),
                        });
                        const data = await res.json();
                        if (data.url) window.location.href = data.url;
                        else useStore.getState().showToast(data.error || "Failed to open billing portal", "error");
                      }}
                      style={{ fontSize: 13, padding: "6px 14px" }}
                    >
                      Manage Billing
                    </button>
                  )}
                  {status === "trial" && (
                    <select
                      value={plan}
                      onChange={async (e) => {
                        if (org) await db.patch("organizations", org.id, { plan: e.target.value });
                        const orgs = await db.get("organizations", { id: org!.id });
                        if (orgs.length) useStore.getState().setOrg(orgs[0] as any);
                      }}
                      style={{ width: "auto", fontSize: 12, padding: "3px 6px" }}
                    >
                      <option value="solo">Solo — $49/mo (1 user)</option>
                      <option value="team">Team — $99/mo (up to 5)</option>
                      <option value="business">Business — $149/mo (up to 10)</option>
                    </select>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Quest Config — moved to General tab */}
      {tab === "general" && isOwner && (
        <div className="cd" style={{ marginTop: 14 }}>
          <h4 style={{ fontSize: 14, marginBottom: 10 }}>🎯 Quest Bonuses</h4>
          <div className="dim" style={{ fontSize: 12, marginBottom: 10 }}>Toggle quests on/off and set custom bonus amounts for your team.</div>
          {(() => {
            const defaultQuests = [
              { key: "review_favor", name: "Review Favor", desc: "15 positive reviews", defaultBonus: 75 },
              { key: "five_star", name: "Five Star Tech", desc: "10 five-star reviews", defaultBonus: 100 },
              { key: "super_handy", name: "Super Handy", desc: "10 work orders", defaultBonus: 50 },
              { key: "network_scout", name: "Network Scout", desc: "Secure new job", defaultBonus: 50 },
              { key: "critical_referral", name: "Critical Referral", desc: "1 client → 5 jobs", defaultBonus: 150 },
              { key: "deal_closer", name: "Deal Closer", desc: "Upsell on-site", defaultBonus: 25 },
              { key: "repeat_machine", name: "Repeat Machine", desc: "3 clients request by name", defaultBonus: 100 },
              { key: "skill_mastery", name: "Skill Mastery", desc: "10 jobs in 1 trade", defaultBonus: 100 },
              { key: "make_ready", name: "Make Ready Pro", desc: "7 unit turns (24+ hrs)", defaultBonus: 350 },
              { key: "zero_callback", name: "Zero Callback", desc: "20 jobs, no callbacks", defaultBonus: 150 },
              { key: "mr_speed", name: "Mr.Speed", desc: "5 jobs in one day", defaultBonus: 25 },
              { key: "handy_king", name: "HandyKing", desc: "Complete all + 2 trades", defaultBonus: 750 },
            ];
            let config: Record<string, { enabled: boolean; bonus: number }> = {};
            try { config = org?.quest_config ? JSON.parse(org.quest_config) : {}; } catch { /* */ }

            const saveConfig = async (updated: typeof config) => {
              if (org) await db.patch("organizations", org.id, { quest_config: JSON.stringify(updated) });
              loadAll();
              const orgs = await db.get("organizations", { id: org!.id });
              if (orgs.length) useStore.getState().setOrg(orgs[0] as any);
            };

            return defaultQuests.map((q) => {
              const c = config[q.key] || { enabled: true, bonus: q.defaultBonus };
              return (
                <div key={q.key} className="sep" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={c.enabled !== false}
                      onChange={async () => {
                        const updated = { ...config, [q.key]: { ...c, enabled: !c.enabled } };
                        await saveConfig(updated);
                      }}
                      style={{ width: "auto", accentColor: "var(--color-primary)" }}
                    />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, opacity: c.enabled === false ? 0.4 : 1 }}>{q.name}</div>
                      <div className="dim" style={{ fontSize: 9 }}>{q.desc}</div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 2 }}>
                    <span style={{ fontSize: 11 }}>$</span>
                    <input
                      type="number"
                      defaultValue={c.bonus}
                      min="0"
                      style={{ width: 55, fontSize: 13, padding: "2px 4px", textAlign: "center" }}
                      onBlur={async (e) => {
                        const val = parseFloat(e.target.value) || 0;
                        if (val !== c.bonus) {
                          const updated = { ...config, [q.key]: { ...c, bonus: val } };
                          await saveConfig(updated);
                        }
                      }}
                    />
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* General tab */}
      {tab === "general" && (
        <div className="cd">
          <h4 style={{ fontSize: 14, marginBottom: 8 }}>{t("settings.appearance")}</h4>
          <div className="sep row" style={{ justifyContent: "space-between" }}>
            <span>{t("settings.darkMode")}</span>
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
            <span>{t("settings.navigation")}</span>
            <div style={{ display: "flex", borderRadius: 6, overflow: "hidden" }}>
              {[
                { key: "right", label: "Right" },
                { key: "left", label: "Left" },
                { key: "bottom", label: "Bottom" },
              ].map((opt) => {
                const isActive = opt.key === "bottom" ? navBottom : opt.key === "left" ? navLeft && !navBottom : !navLeft && !navBottom;
                return (
                  <button
                    key={opt.key}
                    onClick={() => {
                      if (opt.key === "bottom") toggleNavBottom();
                      else if (opt.key === "left") { if (navBottom) toggleNavBottom(); toggleNavSide(); }
                      else { if (navBottom) toggleNavBottom(); if (navLeft) toggleNavSide(); }
                    }}
                    style={{
                      padding: "4px 10px", fontSize: 12,
                      background: isActive ? "var(--color-primary)" : darkMode ? "#12121a" : "#fff",
                      color: isActive ? "#fff" : "#888",
                      border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`,
                      fontFamily: "Oswald",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="sep row" style={{ justifyContent: "space-between" }}>
            <span>{t("settings.language")} / Idioma</span>
            <div style={{ display: "flex", borderRadius: 6, overflow: "hidden" }}>
              {[
                { key: "en", label: "English" },
                { key: "es", label: "Espa\u00f1ol" },
              ].map((opt) => {
                const isActive = (typeof window !== "undefined" ? localStorage.getItem("c_lang") : "en") === opt.key || (!localStorage.getItem("c_lang") && opt.key === "en");
                return (
                  <button
                    key={opt.key}
                    onClick={() => {
                      localStorage.setItem("c_lang", opt.key);
                      window.location.reload();
                    }}
                    style={{
                      padding: "4px 12px", fontSize: 12,
                      background: isActive ? "var(--color-primary)" : darkMode ? "#12121a" : "#fff",
                      color: isActive ? "#fff" : "#888",
                      border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`,
                      fontFamily: "Oswald",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
