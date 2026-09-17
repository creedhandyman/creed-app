"use client";
/**
 * Personal Settings — restyled to `Creed_Settings_Full` screen 1 (the
 * business/Ops screen 2 already shipped in the Operations remodel).
 * ONE scrolling screen, no tabs: profile head (avatar w/ photo upload) →
 * Profile → Notifications → Appearance → Security → Sign out + version.
 * All pre-existing logic preserved verbatim: notification prefs +
 * per-device web push, password change, nav/language/dark-mode/Grizz
 * toggles, owner-only Quest Bonuses config, delete account.
 */
import { useState, useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { supabase, db } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import type { Profile } from "@/lib/types";
import { Icon } from "./Icon";
import { tipsEnabled, setTipsEnabled } from "@/lib/grizz";
import { isPushSupported, isSubscribed, enablePush, disablePush } from "@/lib/push";

interface Props {
  onClose: () => void;
}

/** The app's standard 44px pill toggle. */
function Sw({ on, onTap }: { on: boolean; onTap: () => void }) {
  return (
    <div onClick={onTap} style={{ width: 44, height: 24, borderRadius: 12, background: on ? "var(--color-primary)" : "#ccc", position: "relative", cursor: "pointer", flexShrink: 0 }}>
      <div style={{ width: 18, height: 18, borderRadius: 9, background: "#fff", position: "absolute", top: 3, left: on ? 23 : 3, transition: "0.3s" }} />
    </div>
  );
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

  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState(user.phone || "");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(user.name || "");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarRef = useRef<HTMLInputElement>(null);
  const [grizzTips, setGrizzTips] = useState(true);
  useEffect(() => { setGrizzTips(tipsEnabled(user.id)); }, [user.id]);

  // Web push (per-device). pushOn reflects THIS browser's subscription state.
  const pushSupported = isPushSupported();
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => { if (pushSupported) isSubscribed().then(setPushOn); }, [pushSupported]);
  const togglePush = async () => {
    setPushBusy(true);
    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
        useStore.getState().showToast("Push turned off on this device", "success");
      } else {
        const r = await enablePush();
        if (r.ok) { setPushOn(true); useStore.getState().showToast("Push notifications on", "success"); }
        else useStore.getState().showToast(r.error || "Couldn't enable push", "error");
      }
    } finally { setPushBusy(false); }
  };

  const isOwner = user.role === "owner" || user.role === "manager";

  // Persist a notification-pref change to the profile + keep the in-memory
  // user (and its localStorage cache) in sync so the toggles reflect at once.
  const saveNotif = async (updates: Partial<Profile>) => {
    await db.patch("profiles", user.id, updates);
    useStore.getState().setUser({ ...user, ...updates });
  };

  const saveName = async () => {
    const nn = nameDraft.trim();
    setEditingName(false);
    if (!nn || nn === user.name) return;
    await saveNotif({ name: nn });
    useStore.getState().showToast(t("settings.saved"), "success");
  };

  // Avatar → public receipts bucket (avatars/ path — same public posture as
  // logos/renders; NOT the private receipts path) → profiles.photo_url.
  const uploadAvatar = async (file: File) => {
    setAvatarBusy(true);
    try {
      const path = `avatars/${user.id}_${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("receipts").upload(path, file, { upsert: true });
      if (error) { useStore.getState().showToast("Photo upload failed", "error"); return; }
      const { data } = supabase.storage.from("receipts").getPublicUrl(path);
      await saveNotif({ photo_url: data.publicUrl });
      useStore.getState().showToast(t("settings.saved"), "success");
    } finally {
      setAvatarBusy(false);
      if (avatarRef.current) avatarRef.current.value = "";
    }
  };

  const initials =
    (user.name || "?").split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const roleLabel = user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "";
  const startYear = user.start_date ? String(user.start_date).slice(0, 7) : "";

  return (
    <div className="fi" style={{ maxWidth: 500, margin: "0 auto", padding: "16px 12px" }}>
      <input ref={avatarRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); }} />

      {/* Topbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <button
          onClick={onClose}
          aria-label="Back"
          style={{ width: 30, height: 30, borderRadius: 9, background: darkMode ? "var(--color-card-dark-3)" : "var(--color-card-light)", border: `1px solid ${darkMode ? "var(--color-border-dark-2)" : "var(--color-border-light)"}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "inherit", flexShrink: 0 }}
        >
          <Icon name="back" size={17} />
        </button>
        <span style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 21, letterSpacing: ".5px", textTransform: "uppercase" }}>{t("settings.title")}</span>
      </div>

      {/* Profile head — avatar (tap camera to change) + name + role · org */}
      <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 16 }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div style={{ width: 62, height: 62, borderRadius: "50%", overflow: "hidden", background: "var(--color-card-dark-3)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Oswald", fontWeight: 700, fontSize: 21, color: darkMode ? "#cdd6e6" : "#5a6175" }}>
            {user.photo_url
              ? <img src={user.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
              : initials}
          </div>
          <button
            onClick={() => avatarRef.current?.click()}
            disabled={avatarBusy}
            aria-label="Change photo"
            style={{ position: "absolute", right: -3, bottom: -3, width: 24, height: 24, borderRadius: "50%", background: "var(--color-primary)", border: "2px solid var(--color-dark-bg, #0a0a0f)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", opacity: avatarBusy ? 0.5 : 1 }}
          >
            <Icon name="camera" size={12} color="#fff" />
          </button>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 19 }}>{user.name}</div>
          <div style={{ fontSize: 13, color: "var(--color-success)" }}>{roleLabel}{org?.name ? ` · ${org.name}` : ""}</div>
        </div>
      </div>

      {/* Profile */}
      <div className="section">
        <div className="seclabel"><Icon name="worker" size={13} /> {t("settings.yourProfile")}</div>
        <div className="drow">
          <span className="l">Name</span>
          {editingName ? (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                style={{ fontSize: 14, width: 150, padding: "3px 8px" }} />
              <button className="bb" onClick={saveName} style={{ fontSize: 13, padding: "3px 10px" }}>{t("settings.save")}</button>
            </span>
          ) : (
            <span className="v" onClick={() => { setNameDraft(user.name || ""); setEditingName(true); }} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              {user.name || "—"} <Icon name="edit" size={12} color="var(--color-dim)" />
            </span>
          )}
        </div>
        <div className="drow"><span className="l">Email</span><span className="v" style={{ fontSize: 12.5 }}>{user.email || "—"}</span></div>
        <div className="drow"><span className="l">Role · Emp #</span><span className="v">{roleLabel || "—"}{user.emp_num ? ` · ${user.emp_num}` : ""}</span></div>
        <div className="drow"><span className="l">Rate · started</span><span className="v">${user.rate || 55}/hr{startYear ? ` · ${startYear}` : ""}</span></div>
      </div>

      {/* Notifications */}
      <div className="section">
        <div className="seclabel"><Icon name="bell" size={13} /> {t("settings.notifications")}</div>
        <div className="dim" style={{ fontSize: 13, margin: "2px 0 8px" }}>{t("settings.notifDesc")}</div>
        <div className="row" style={{ marginBottom: 4 }}>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("settings.phoneNumber")} />
          <button
            className="bb"
            onClick={async () => {
              await saveNotif({ phone: phone.trim() });
              useStore.getState().showToast(t("settings.saved"), "success");
            }}
          >
            {t("settings.save")}
          </button>
        </div>
        {([
          { key: "notify_assigned", label: t("settings.notifyAssigned") },
          { key: "notify_leads", label: t("settings.notifyLeads") },
          { key: "notify_sms", label: t("settings.notifySms") },
        ] as { key: "notify_assigned" | "notify_leads" | "notify_sms"; label: string }[]).map((row) => {
          const on = user[row.key] !== false; // undefined = opted in (default)
          return (
            <div key={row.key} className="drow">
              <span className="l">{row.label}</span>
              <Sw on={on} onTap={() => saveNotif({ [row.key]: !on } as Partial<Profile>)} />
            </div>
          );
        })}
        {/* Web push — per-device subscription (not a stored pref) */}
        {pushSupported ? (
          <div className="drow">
            <span className="l">
              Push notifications
              <span className="dim" style={{ display: "block", fontSize: 11.5 }}>Alerts on this device, even when the app is closed</span>
            </span>
            <button className={pushOn ? "bo" : "bb"} disabled={pushBusy} onClick={togglePush} style={{ flexShrink: 0, fontSize: 13, padding: "4px 12px" }}>
              {pushBusy ? "…" : pushOn ? "On" : "Enable"}
            </button>
          </div>
        ) : (
          <div className="dim" style={{ fontSize: 12.5, padding: "8px 0 2px" }}>
            To get push alerts on this device, add Creed to your home screen, then reopen and check here.
          </div>
        )}
      </div>

      {/* Appearance */}
      <div className="section">
        <div className="seclabel"><Icon name="paint" size={13} /> {t("settings.appearance")}</div>
        <div className="drow">
          <span className="l">{t("settings.darkMode")}</span>
          <Sw on={darkMode} onTap={toggleDark} />
        </div>
        <div className="drow">
          <span className="l">{t("settings.navigation")}</span>
          <div style={{ display: "flex", borderRadius: 6, overflow: "hidden" }}>
            {[{ key: "right", label: "Right" }, { key: "left", label: "Left" }, { key: "bottom", label: "Bottom" }].map((opt) => {
              const isActive = opt.key === "bottom" ? navBottom : opt.key === "left" ? navLeft && !navBottom : !navLeft && !navBottom;
              return (<button key={opt.key} onClick={() => { if (opt.key === "bottom") toggleNavBottom(); else if (opt.key === "left") { if (navBottom) toggleNavBottom(); toggleNavSide(); } else { if (navBottom) toggleNavBottom(); if (navLeft) toggleNavSide(); } }} style={{ padding: "4px 10px", fontSize: 13, background: isActive ? "var(--color-primary)" : darkMode ? "#12121a" : "#fff", color: isActive ? "#fff" : "#888", border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`, fontFamily: "Oswald" }}>{opt.label}</button>);
            })}
          </div>
        </div>
        <div className="drow">
          <span className="l">{t("settings.language")} / Idioma</span>
          <div style={{ display: "flex", borderRadius: 6, overflow: "hidden" }}>
            {[{ key: "en", label: "English" }, { key: "es", label: "Español" }].map((opt) => {
              const isActive = (typeof window !== "undefined" ? localStorage.getItem("c_lang") : "en") === opt.key || (!localStorage.getItem("c_lang") && opt.key === "en");
              return (<button key={opt.key} onClick={() => { localStorage.setItem("c_lang", opt.key); window.location.reload(); }} style={{ padding: "4px 12px", fontSize: 13, background: isActive ? "var(--color-primary)" : darkMode ? "#12121a" : "#fff", color: isActive ? "#fff" : "#888", border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`, fontFamily: "Oswald" }}>{opt.label}</button>);
            })}
          </div>
        </div>
        <div className="drow">
          <span className="l">Show Grizz tips</span>
          <Sw on={grizzTips} onTap={() => { const next = !grizzTips; setTipsEnabled(next, user.id); setGrizzTips(next); }} />
        </div>
      </div>

      {/* Security */}
      <div className="section">
        <div className="seclabel"><Icon name="safety" size={13} /> {t("settings.changePassword")}</div>
        {!showPassword ? (
          <div className="drow" onClick={() => setShowPassword(true)} style={{ cursor: "pointer" }}>
            <span className="l">{t("settings.changePassword")}</span>
            <span className="v" style={{ color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 4 }}>
              Update <Icon name="next" size={13} color="var(--color-primary)" />
            </span>
          </div>
        ) : (
          <div className="row" style={{ paddingTop: 6 }}>
            <input
              type="password"
              autoFocus
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
                setShowPassword(false);
                useStore.getState().showToast("Password updated", "success");
              }}
            >
              {t("settings.save")}
            </button>
          </div>
        )}
      </div>

      {/* Quest Bonuses — owner config, unchanged logic (business-adjacent but
          kept here until it gets a home in Ops → Settings). */}
      {isOwner && (
        <div className="section">
          <div className="seclabel"><Icon name="quest" size={13} /> Quest Bonuses</div>
          <div className="dim" style={{ fontSize: 13, margin: "2px 0 8px" }}>Toggle quests on/off and set custom bonus amounts for your team.</div>
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
              if (orgs.length) useStore.getState().setOrg(orgs[0] as never);
            };

            return defaultQuests.map((q) => {
              const c = config[q.key] || { enabled: true, bonus: q.defaultBonus };
              return (
                <div key={q.key} className="drow" style={{ gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                    <input
                      type="checkbox"
                      checked={c.enabled !== false}
                      onChange={async () => {
                        const updated = { ...config, [q.key]: { ...c, enabled: !c.enabled } };
                        await saveConfig(updated);
                      }}
                      style={{ width: "auto", accentColor: "var(--color-primary)" }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, opacity: c.enabled === false ? 0.4 : 1 }}>{q.name}</div>
                      <div className="dim" style={{ fontSize: 11 }}>{q.desc}</div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 2, flexShrink: 0 }}>
                    <span style={{ fontSize: 13 }}>$</span>
                    <input
                      type="number"
                      defaultValue={c.bonus}
                      min="0"
                      style={{ width: 55, fontSize: 15, padding: "2px 4px", textAlign: "center" }}
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

      {/* Sign out + version + delete */}
      <button
        className="br"
        onClick={() => { logout(); onClose(); }}
        style={{ width: "100%", marginTop: 4, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}
      >
        {t("settings.logout")}
      </button>
      <div style={{ textAlign: "center", color: "var(--color-dim)", fontSize: 12, margin: "12px 0 8px" }}>
        Creed HM · v1.0.0
      </div>
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <button
          onClick={async () => {
            if (!await useStore.getState().showConfirm("Delete Account", "Delete your account? This cannot be undone.")) return;
            if (!await useStore.getState().showConfirm("Are You Sure?", "All your data will be lost.")) return;
            await db.del("profiles", user.id);
            logout();
            onClose();
          }}
          style={{ background: "none", border: "none", fontSize: 12.5, color: "var(--color-accent-red)", textDecoration: "underline", cursor: "pointer" }}
        >
          {t("settings.deleteAccount")}
        </button>
      </div>
    </div>
  );
}
