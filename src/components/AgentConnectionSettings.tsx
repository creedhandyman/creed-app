"use client";
/**
 * Ops → Settings → AI assistant connection. Make an API key for an AI
 * assistant (name + permissions), see it ONCE, revoke it, replace it (a lost
 * key can't be shown again, so Replace is the recovery path), and see when
 * each key was last used plus the latest calls. Server: /api/agent/keys.
 * The tools themselves: lib/agent/server.ts (REST /api/agent/v1, MCP /api/mcp).
 */
import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { t } from "@/lib/i18n";
import { AGENT_SCOPES, type AgentScope } from "@/lib/agent/scopes";
import { Icon } from "./Icon";

interface KeyRow {
  id: string;
  name: string;
  scopes: string[];
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}
interface ActivityRow {
  id: number;
  key_id: string | null;
  tool: string;
  via: string | null;
  ok: boolean;
  summary: string | null;
  created_at: string;
}

const SCOPE_LABEL: Record<AgentScope, string> = {
  "customers:read": "agent.scope.customers",
  "work_orders:write": "agent.scope.workOrders",
  "quotes:draft": "agent.scope.quotes",
  "schedule:read": "agent.scope.slots",
  "schedule:write": "agent.scope.schedule",
};

const when = (iso: string | null): string => {
  if (!iso) return t("agent.never");
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export default function AgentConnectionSettings() {
  const toast = useStore((s) => s.showToast);
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [notSetUp, setNotSetUp] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<AgentScope[]>([...AGENT_SCOPES]);
  const [busy, setBusy] = useState<string | null>(null);
  const [shown, setShown] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState("");
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const load = useCallback(async () => {
    try {
      const r = await apiFetch("/api/agent/keys");
      const j = await r.json().catch(() => ({}));
      if (r.status === 503) { setNotSetUp(true); setKeys([]); return; }
      if (!r.ok) { toast(j.error || t("agent.loadFailed"), "error"); setKeys([]); return; }
      setNotSetUp(false);
      setKeys(j.keys || []);
      setActivity(j.activity || []);
    } catch {
      toast(t("agent.loadFailed"), "error");
      setKeys([]);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const post = async (body: Record<string, unknown>, tag: string) => {
    setBusy(tag);
    try {
      const r = await apiFetch("/api/agent/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast(j.error || t("agent.failed"), "error"); return null; }
      return j as { key?: string; row?: KeyRow };
    } catch {
      toast(t("agent.failed"), "error");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    const n = name.trim();
    if (!n) { toast(t("agent.needName"), "error"); return; }
    if (!scopes.length) { toast(t("agent.needScope"), "error"); return; }
    const j = await post({ name: n, scopes }, "create");
    if (j?.key) { setShown({ key: j.key, name: n }); setName(""); load(); }
  };

  const replace = async (k: KeyRow) => {
    if (!await useStore.getState().showConfirm(t("agent.replaceTitle"), t("agent.replaceBody").replace("{name}", k.name), { confirmLabel: t("agent.replace") })) return;
    const j = await post({ action: "replace", id: k.id }, k.id);
    if (j?.key) { setShown({ key: j.key, name: k.name }); load(); }
  };

  const revoke = async (k: KeyRow) => {
    if (!await useStore.getState().showConfirm(t("agent.revokeTitle"), t("agent.revokeBody").replace("{name}", k.name), { confirmLabel: t("agent.revoke") })) return;
    if (await post({ action: "revoke", id: k.id }, k.id)) { toast(t("agent.revoked"), "success"); load(); }
  };

  const copy = async (text: string, tag: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(tag); setTimeout(() => setCopied(""), 1800); }
    catch { toast(t("agent.copyFailed"), "error"); }
  };

  const keyName = (id: string | null) => keys?.find((k) => k.id === id)?.name || "";
  const active = (keys || []).filter((k) => !k.revoked_at);
  const revoked = (keys || []).filter((k) => k.revoked_at);

  const urlRow = (label: string, url: string, tag: string) => (
    <div style={{ marginTop: 8 }}>
      <div className="dim" style={{ fontSize: 12.5 }}>{label}</div>
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <code style={{ flex: 1, fontSize: 13, wordBreak: "break-all" }}>{url}</code>
        <button type="button" className="bo" onClick={() => copy(url, tag)} style={{ padding: "6px 10px", fontSize: 13 }}>
          <Icon name={copied === tag ? "check" : "copy"} size={14} />
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="cd mb">
        <h4 style={{ fontSize: 16, marginBottom: 6, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="ai" size={16} color="var(--color-primary)" /> {t("agent.title")}
        </h4>
        <div className="dim" style={{ fontSize: 14 }}>{t("agent.intro")}</div>
        <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>{t("agent.limits")}</div>
        {urlRow(t("agent.mcpUrl"), `${origin}/api/mcp`, "mcp")}
        {urlRow(t("agent.restUrl"), `${origin}/api/agent/v1`, "rest")}
      </div>

      {notSetUp ? (
        <div className="cd mb" style={{ fontSize: 14 }}>
          <Icon name="warn" size={15} color="var(--color-warning)" /> {t("agent.notSetUp")}
        </div>
      ) : (
        <>
          <div className="cd mb">
            <h4 style={{ fontSize: 15, marginBottom: 8 }}>{t("agent.newKey")}</h4>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t("agent.namePh")} style={{ width: "100%", marginBottom: 10 }} />
            <div className="dim" style={{ fontSize: 13, marginBottom: 6 }}>{t("agent.canDo")}</div>
            {AGENT_SCOPES.map((s) => (
              <label key={s} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, padding: "4px 0", cursor: "pointer" }}>
                <input type="checkbox" checked={scopes.includes(s)}
                  onChange={(e) => setScopes((cur) => (e.target.checked ? AGENT_SCOPES.filter((x) => x === s || cur.includes(x)) : cur.filter((x) => x !== s)))} />
                {t(SCOPE_LABEL[s])}
              </label>
            ))}
            <button type="button" className="bb mt" disabled={busy === "create"} onClick={create}>
              <Icon name="add" size={15} /> {busy === "create" ? t("agent.working") : t("agent.create")}
            </button>
          </div>

          <div className="cd mb">
            <h4 style={{ fontSize: 15, marginBottom: 8 }}>{t("agent.keys")}</h4>
            {keys === null ? <div className="dim">{t("agent.loading")}</div>
              : !active.length ? <div className="dim" style={{ fontSize: 14 }}>{t("agent.noKeys")}</div>
              : active.map((k) => (
                <div key={k.id} style={{ padding: "10px 0", borderTop: "1px solid var(--color-border-dark-2, rgba(128,128,128,.25))" }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{k.name}</div>
                  <div className="dim" style={{ fontSize: 12.5 }}>
                    <code>{k.key_prefix}…</code> · {t("agent.lastUsed")}: {when(k.last_used_at)}
                  </div>
                  <div className="dim" style={{ fontSize: 12.5, marginTop: 2 }}>
                    {k.scopes.filter((s): s is AgentScope => s in SCOPE_LABEL).map((s) => t(SCOPE_LABEL[s])).join(" · ")}
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 8 }}>
                    <button type="button" className="bo" disabled={busy === k.id} onClick={() => replace(k)} style={{ fontSize: 13, padding: "6px 12px" }}>
                      <Icon name="refresh" size={14} /> {t("agent.replace")}
                    </button>
                    <button type="button" className="br" disabled={busy === k.id} onClick={() => revoke(k)} style={{ fontSize: 13, padding: "6px 12px" }}>
                      {t("agent.revoke")}
                    </button>
                  </div>
                </div>
              ))}
            {revoked.length > 0 && (
              <div className="dim" style={{ fontSize: 12.5, marginTop: 10 }}>
                {t("agent.revokedList")}: {revoked.slice(0, 8).map((k) => `${k.name} (${k.key_prefix}…)`).join(", ")}
              </div>
            )}
          </div>

          <div className="cd mb">
            <h4 style={{ fontSize: 15, marginBottom: 8 }}>{t("agent.activity")}</h4>
            {!activity.length ? <div className="dim" style={{ fontSize: 14 }}>{t("agent.noActivity")}</div>
              : activity.map((a) => (
                <div key={a.id} style={{ display: "flex", gap: 8, fontSize: 13, padding: "4px 0", alignItems: "baseline" }}>
                  <Icon name={a.ok ? "checkCircle" : "errorCircle"} size={13} color={a.ok ? "var(--color-success)" : "var(--color-accent-red, #d33)"} />
                  <span className="dim" style={{ whiteSpace: "nowrap" }}>{when(a.created_at)}</span>
                  <span style={{ fontWeight: 600 }}>{a.tool}</span>
                  <span className="dim" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {[a.summary, keyName(a.key_id)].filter(Boolean).join(" · ")}
                  </span>
                </div>
              ))}
          </div>
        </>
      )}

      {shown && (
        <div className="sheet-overlay">
          <div className="sheet cd">
            <h4 style={{ fontSize: 17, marginBottom: 6 }}>{t("agent.shownTitle").replace("{name}", shown.name)}</h4>
            <div className="dim" style={{ fontSize: 14, marginBottom: 10 }}>{t("agent.shownBody")}</div>
            <code style={{ display: "block", padding: 10, borderRadius: 8, background: "rgba(128,128,128,.12)", wordBreak: "break-all", fontSize: 14 }}>{shown.key}</code>
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <button type="button" className="bb" onClick={() => copy(shown.key, "key")}>
                <Icon name={copied === "key" ? "check" : "copy"} size={15} /> {copied === "key" ? t("agent.copied") : t("agent.copy")}
              </button>
              <button type="button" className="bo" onClick={() => setShown(null)}>{t("agent.done")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
