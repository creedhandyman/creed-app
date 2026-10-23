"use client";
/**
 * Settings → "Schedule in your phone calendar": the person's private
 * subscribe link (/api/calendar/link → /api/calendar/feed/<token>.ics).
 * Owners/managers can also take the whole crew's schedule. The link is
 * fetched on demand (it creates the token the first time).
 */
import { useState } from "react";
import { useStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";

type Links = { url: string; webcal: string; google: string };

export default function CalendarSubscribe() {
  const user = useStore((s) => s.user);
  const admin = user?.role === "owner" || user?.role === "manager";
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [links, setLinks] = useState<Partial<Record<"mine" | "team", Links>>>({});
  const [busy, setBusy] = useState(false);
  const cur = links[scope];

  const load = async (reset = false) => {
    setBusy(true);
    try {
      const res = await apiFetch("/api/calendar/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, reset }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.url) { useStore.getState().showToast(j.error || "Couldn't get the calendar link", "error"); return; }
      setLinks((p) => ({ ...p, [scope]: j as Links }));
      if (reset) useStore.getState().showToast(t("cal.resetDone"), "success");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!await useStore.getState().showConfirm(t("cal.resetTitle"), t("cal.resetBody"), { confirmLabel: t("cal.reset") })) return;
    void load(true);
  };

  const copy = async () => {
    if (!cur) return;
    try { await navigator.clipboard.writeText(cur.url); useStore.getState().showToast(t("cal.copied"), "success"); }
    catch { useStore.getState().showToast(cur.url, "info"); }
  };

  const btn: React.CSSProperties = { flex: 1, minWidth: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13, padding: "8px 6px", textDecoration: "none", textAlign: "center" };

  return (
    <div className="section">
      <div className="seclabel"><Icon name="schedule" size={13} /> {t("cal.title")}</div>
      <div className="dim" style={{ fontSize: 13, margin: "2px 0 8px" }}>{t("cal.desc")}</div>
      {admin && (
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {(["mine", "team"] as const).map((s) => (
            <button key={s} type="button" className={scope === s ? "bb" : "bo"} onClick={() => setScope(s)} style={{ flex: 1, fontSize: 13, padding: "5px 0" }}>
              {t(s === "mine" ? "cal.mine" : "cal.team")}
            </button>
          ))}
        </div>
      )}
      {!cur ? (
        <button className="bb" disabled={busy} onClick={() => load()} style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Icon name="schedule" size={15} /> {busy ? "…" : t("cal.get")}
        </button>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <a className="bo" href={cur.webcal} style={btn}><Icon name="schedule" size={14} /> {t("cal.apple")}</a>
            <a className="bo" href={cur.google} target="_blank" rel="noopener noreferrer" style={btn}><Icon name="external" size={14} /> {t("cal.google")}</a>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button className="bo" onClick={copy} style={btn}><Icon name="link" size={14} /> {t("cal.copy")}</button>
            <button className="bo" disabled={busy} onClick={reset} style={{ ...btn, color: "var(--color-dim)" }}><Icon name="refresh" size={14} /> {t("cal.reset")}</button>
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>{t("cal.lag")}</div>
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>{t("cal.private")}</div>
        </>
      )}
    </div>
  );
}
