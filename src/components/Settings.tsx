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
  const logout = useStore((s) => s.logout);
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
        {["account", "general"].map((tb) => (
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
          {/* Logo + business info moved to Operations → Settings (admin tasks).
              Admins can also reach those via the gear icon in Ops. */}

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

      {/* Team / Operations / Branding / Billing tabs all moved to the
          Ops tab. Settings is now Account + General only. */}

      {/* Appearance — renders first in General tab */}
      {tab === "general" && (
        <div className="cd mb">
          <h4 style={{ fontSize: 14, marginBottom: 8 }}>{t("settings.appearance")}</h4>
          <div className="sep row" style={{ justifyContent: "space-between" }}>
            <span>{t("settings.darkMode")}</span>
            <div onClick={toggleDark} style={{ width: 44, height: 24, borderRadius: 12, background: darkMode ? "var(--color-primary)" : "#ccc", position: "relative", cursor: "pointer" }}>
              <div style={{ width: 18, height: 18, borderRadius: 9, background: "#fff", position: "absolute", top: 3, left: darkMode ? 23 : 3, transition: "0.3s" }} />
            </div>
          </div>
          <div className="sep row" style={{ justifyContent: "space-between" }}>
            <span>{t("settings.navigation")}</span>
            <div style={{ display: "flex", borderRadius: 6, overflow: "hidden" }}>
              {[{ key: "right", label: "Right" }, { key: "left", label: "Left" }, { key: "bottom", label: "Bottom" }].map((opt) => {
                const isActive = opt.key === "bottom" ? navBottom : opt.key === "left" ? navLeft && !navBottom : !navLeft && !navBottom;
                return (<button key={opt.key} onClick={() => { if (opt.key === "bottom") toggleNavBottom(); else if (opt.key === "left") { if (navBottom) toggleNavBottom(); toggleNavSide(); } else { if (navBottom) toggleNavBottom(); if (navLeft) toggleNavSide(); } }} style={{ padding: "4px 10px", fontSize: 12, background: isActive ? "var(--color-primary)" : darkMode ? "#12121a" : "#fff", color: isActive ? "#fff" : "#888", border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`, fontFamily: "Oswald" }}>{opt.label}</button>);
              })}
            </div>
          </div>
          <div className="sep row" style={{ justifyContent: "space-between" }}>
            <span>{t("settings.language")} / Idioma</span>
            <div style={{ display: "flex", borderRadius: 6, overflow: "hidden" }}>
              {[{ key: "en", label: "English" }, { key: "es", label: "Español" }].map((opt) => {
                const isActive = (typeof window !== "undefined" ? localStorage.getItem("c_lang") : "en") === opt.key || (!localStorage.getItem("c_lang") && opt.key === "en");
                return (<button key={opt.key} onClick={() => { localStorage.setItem("c_lang", opt.key); window.location.reload(); }} style={{ padding: "4px 12px", fontSize: 12, background: isActive ? "var(--color-primary)" : darkMode ? "#12121a" : "#fff", color: isActive ? "#fff" : "#888", border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`, fontFamily: "Oswald" }}>{opt.label}</button>);
              })}
            </div>
          </div>
        </div>
      )}

      {/* Quest Config — after appearance */}
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

    </div>
  );
}
