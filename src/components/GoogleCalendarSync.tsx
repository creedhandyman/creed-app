"use client";
/**
 * Ops → Settings → Google Calendar: two-way sync with a "Creed jobs" calendar
 * in the business's Google account (lib/gcal/*, routes /api/gcal/*). Connect,
 * see when it last synced, Sync now, Disconnect, and a red Reconnect prompt
 * when Google stopped accepting the connection (revoked / expired).
 */
import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";

export interface GcalStatus {
  configured: boolean;
  setup: boolean;
  connected: boolean;
  status?: "active" | "needs_reconnect" | null;
  email?: string | null;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  live?: boolean;
}

export async function fetchGcalStatus(): Promise<GcalStatus | null> {
  try {
    const r = await apiFetch("/api/gcal/status");
    if (!r.ok) return null;
    return (await r.json()) as GcalStatus;
  } catch {
    return null;
  }
}

/** For the Settings list row: "Reconnect" (warning) / "On" / nothing. */
export function useGcalStatus(): GcalStatus | null {
  const [s, setS] = useState<GcalStatus | null>(null);
  useEffect(() => { let on = true; fetchGcalStatus().then((v) => { if (on) setS(v); }); return () => { on = false; }; }, []);
  return s;
}

const when = (iso?: string | null) => {
  if (!iso) return t("gcal.never");
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export default function GoogleCalendarSync() {
  const toast = useStore((s) => s.showToast);
  const confirm = useStore((s) => s.showConfirm);
  const [st, setSt] = useState<GcalStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => setSt(await fetchGcalStatus()), []);
  useEffect(() => { load(); }, [load]);

  const connect = async () => {
    setBusy("connect");
    try {
      const r = await apiFetch("/api/gcal/connect", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) { toast(j.error === "not_configured" ? t("gcal.notConfigured") : t("gcal.failed"), "error"); return; }
      window.location.href = j.url;
    } catch {
      toast(t("gcal.failed"), "error");
    } finally {
      setBusy(null);
    }
  };

  const syncNow = async () => {
    setBusy("sync");
    try {
      const r = await apiFetch("/api/gcal/sync", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (j.ok) toast(t("gcal.synced"), "success");
      else if (j.reason === "busy") toast(t("gcal.busy"), "info");
      else toast(j.reason === "needs_reconnect" ? t("gcal.reconnectNeeded") : t("gcal.failed"), "error");
    } catch {
      toast(t("gcal.failed"), "error");
    } finally {
      setBusy(null);
      load();
    }
  };

  const disconnect = async () => {
    if (!(await confirm(t("gcal.disconnect"), t("gcal.disconnectQ")))) return;
    setBusy("disconnect");
    try {
      await apiFetch("/api/gcal/disconnect", { method: "POST" });
      toast(t("gcal.disconnected"), "success");
    } catch {
      toast(t("gcal.failed"), "error");
    } finally {
      setBusy(null);
      load();
    }
  };

  const needsReconnect = st?.connected && st.status === "needs_reconnect";
  const btn = { display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 14px", fontSize: 15 } as const;

  return (
    <div className="cd">
      <h4 style={{ fontSize: 16, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="schedule" size={16} color="var(--color-primary)" />
        {t("gcal.title")}
      </h4>
      <div className="dim" style={{ fontSize: 14, marginBottom: 12 }}>{t("gcal.help")}</div>

      {!st ? (
        <div className="dim" style={{ fontSize: 14 }}>…</div>
      ) : !st.setup ? (
        <div className="dim" style={{ fontSize: 14 }}>{t("gcal.notSetUp")}</div>
      ) : !st.connected ? (
        <>
          {!st.configured && <div className="dim" style={{ fontSize: 14, marginBottom: 10 }}>{t("gcal.notConfigured")}</div>}
          <button type="button" className="bb" style={btn} disabled={!st.configured || busy === "connect"} onClick={connect}>
            <Icon name="link" size={15} /> {busy === "connect" ? "…" : t("gcal.connect")}
          </button>
        </>
      ) : (
        <>
          {needsReconnect && (
            <div role="alert" style={{ border: "1px solid var(--color-accent-red, #e5484d)", background: "rgba(229,72,77,.12)", borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15, color: "var(--color-accent-red, #e5484d)" }}>
                <Icon name="warn" size={16} /> {t("gcal.reconnectTitle")}
              </div>
              <div style={{ fontSize: 14, margin: "6px 0 10px" }}>{t("gcal.reconnectBody")}</div>
              <button type="button" className="br" style={btn} disabled={busy === "connect"} onClick={connect}>
                <Icon name="refresh" size={15} /> {busy === "connect" ? "…" : t("gcal.reconnect")}
              </button>
            </div>
          )}
          <div style={{ fontSize: 14.5, marginBottom: 4 }}>
            {needsReconnect ? <Icon name="alert" size={14} color="var(--color-accent-red, #e5484d)" /> : <Icon name="check" size={14} color="var(--color-success)" />}{" "}
            {t("gcal.connectedAs")} <b>{st.email || "Google"}</b>
          </div>
          <div className="dim" style={{ fontSize: 13.5, marginBottom: 4 }}>{t("gcal.calendarName")}</div>
          <div className="dim" style={{ fontSize: 13.5, marginBottom: 12 }}>
            {t("gcal.lastSynced")}: {when(st.lastSyncedAt)}{!needsReconnect && st.lastError ? ` · ${t("gcal.lastError")}: ${st.lastError}` : ""}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {!needsReconnect && (
              <button type="button" className="bo" style={btn} disabled={!!busy} onClick={syncNow}>
                <Icon name="refresh" size={15} /> {busy === "sync" ? "…" : t("gcal.syncNow")}
              </button>
            )}
            <button type="button" className="bo" style={btn} disabled={!!busy} onClick={disconnect}>
              <Icon name="close" size={15} /> {t("gcal.disconnect")}
            </button>
          </div>
          <div className="dim" style={{ fontSize: 13, marginTop: 12 }}>{t("gcal.rules")}</div>
        </>
      )}
    </div>
  );
}
