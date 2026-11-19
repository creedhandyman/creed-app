"use client";
/**
 * "Sign in with Creed" consent screen. An AI app (e.g. Claude) sent the
 * owner here to connect Creed's MCP server. They sign in (if this browser
 * isn't already), pick the business and what the app may do, and Approve or
 * Deny. The server (/api/oauth/authorize) re-checks everything and returns
 * the only place the browser may go next: the app's registered return URL.
 */
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { AGENT_SCOPES, type AgentScope } from "@/lib/agent/scopes";
import { Icon } from "@/components/Icon";

const SCOPE_LABEL: Record<AgentScope, string> = {
  "customers:read": "agent.scope.customers",
  "work_orders:write": "agent.scope.workOrders",
  "quotes:draft": "agent.scope.quotes",
  "schedule:read": "agent.scope.slots",
  "schedule:write": "agent.scope.schedule",
};

interface Check {
  client_name: string;
  redirect_host: string;
  scopes: AgentScope[];
  scopes_open: boolean;
  signed_in: boolean;
  businesses: { id: string; name: string; role: string }[];
}

export default function Consent() {
  const query = useMemo(() => {
    if (typeof window === "undefined") return {} as Record<string, string>;
    return Object.fromEntries(new URLSearchParams(window.location.search).entries());
  }, []);
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [info, setInfo] = useState<Check | null>(null);
  const [fatal, setFatal] = useState<{ description: string; redirect: string | null } | null>(null);
  const [orgId, setOrgId] = useState("");
  const [picked, setPicked] = useState<AgentScope[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [who, setWho] = useState("");

  const call = async (action: string, extra: Record<string, unknown> = {}, tok = token) => {
    const r = await fetch("/api/oauth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      body: JSON.stringify({ action, query, ...extra }),
    });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  };

  const check = async (tok: string | null) => {
    const { status, j } = await call("check", {}, tok);
    if (status !== 200) { setFatal({ description: j.description || t("oauth.badRequest"), redirect: j.redirect || null }); return; }
    setInfo(j as Check);
    setPicked((j as Check).scopes);
    if ((j as Check).businesses.length) setOrgId((j as Check).businesses[0].id);
  };

  // Already signed in to Creed in this browser? Use that session.
  useEffect(() => {
    (async () => {
      let tok: string | null = null;
      try {
        const { data } = await supabase.auth.getSession();
        tok = data.session?.access_token || null;
        setWho(data.session?.user?.email || "");
      } catch { /* no session */ }
      setToken(tok);
      await check(tok);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async () => {
    setBusy(true); setMsg("");
    try {
      // A one-off client: signing in here doesn't sign this browser into the app.
      const temp = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: "creed-oauth-consent" },
      });
      const { data, error } = await temp.auth.signInWithPassword({ email: email.trim(), password });
      if (error || !data.session) { setMsg(error?.message || t("oauth.signInFailed")); return; }
      setToken(data.session.access_token);
      setWho(data.session.user.email || "");
      await check(data.session.access_token);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (approve: boolean) => {
    setBusy(true); setMsg("");
    try {
      const { status, j } = approve ? await call("approve", { org_id: orgId, scopes: picked }) : await call("deny");
      if (j.redirect) { window.location.href = j.redirect; return; }
      setMsg(j.description || (status === 401 ? t("oauth.signInFirst") : t("oauth.failed")));
    } finally {
      setBusy(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "var(--color-bg, #0b0d10)" }}>
      <div className="cd" style={{ width: "100%", maxWidth: 440, padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontFamily: "Oswald", fontWeight: 700, fontSize: 18, letterSpacing: ".5px", textTransform: "uppercase" }}>
          <Icon name="ai" size={18} color="var(--color-primary)" /> {t("oauth.title")}
        </div>
        {children}
      </div>
    </main>
  );

  if (fatal) {
    return shell(
      <>
        <div style={{ fontSize: 15, marginBottom: 12 }}><Icon name="warn" size={15} color="var(--color-warning)" /> {fatal.description}</div>
        {fatal.redirect && <a className="bo" href={fatal.redirect}>{t("oauth.backToApp")}</a>}
      </>,
    );
  }
  if (!info) return shell(<div className="dim">{t("agent.loading")}</div>);

  const asking = (
    <div style={{ fontSize: 15, marginBottom: 14 }}>
      <b>{info.client_name}</b> {t("oauth.wants")}
      <div className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>{t("oauth.returnsTo").replace("{host}", info.redirect_host)}</div>
    </div>
  );

  if (!info.signed_in) {
    return shell(
      <>
        {asking}
        <div className="dim" style={{ fontSize: 14, marginBottom: 10 }}>{t("oauth.signInPrompt")}</div>
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("oauth.email")} style={{ width: "100%", marginBottom: 8 }} />
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("oauth.password")} style={{ width: "100%", marginBottom: 10 }}
          onKeyDown={(e) => { if (e.key === "Enter") signIn(); }} />
        {msg && <div style={{ color: "var(--color-accent-red, #d33)", fontSize: 13.5, marginBottom: 8 }}>{msg}</div>}
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="bb" disabled={busy || !email || !password} onClick={signIn}>{busy ? t("agent.working") : t("oauth.signIn")}</button>
          <button type="button" className="bo" disabled={busy} onClick={() => decide(false)}>{t("oauth.deny")}</button>
        </div>
      </>,
    );
  }

  if (!info.businesses.length) {
    return shell(
      <>
        {asking}
        <div style={{ fontSize: 14, marginBottom: 12 }}>{t("oauth.ownersOnly")}</div>
        {who && <div className="dim" style={{ fontSize: 13, marginBottom: 12 }}>{t("oauth.signedInAs").replace("{email}", who)}</div>}
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="bo" onClick={() => { setInfo({ ...info, signed_in: false }); setToken(null); }}>{t("oauth.otherAccount")}</button>
          <button type="button" className="bo" disabled={busy} onClick={() => decide(false)}>{t("oauth.deny")}</button>
        </div>
      </>,
    );
  }

  const offered = info.scopes_open ? [...AGENT_SCOPES] : info.scopes;
  return shell(
    <>
      {asking}
      {who && <div className="dim" style={{ fontSize: 13, marginBottom: 10 }}>{t("oauth.signedInAs").replace("{email}", who)}</div>}
      <div className="dim" style={{ fontSize: 13, marginBottom: 6 }}>{t("oauth.business")}</div>
      {info.businesses.map((b) => (
        <label key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, padding: "4px 0", cursor: "pointer" }}>
          <input type="radio" name="biz" checked={orgId === b.id} onChange={() => setOrgId(b.id)} /> {b.name}
        </label>
      ))}
      <div className="dim" style={{ fontSize: 13, margin: "12px 0 6px" }}>{t("agent.canDo")}</div>
      {offered.map((s) => (
        <label key={s} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14.5, padding: "4px 0", cursor: "pointer" }}>
          <input type="checkbox" checked={picked.includes(s)}
            onChange={(e) => setPicked((cur) => (e.target.checked ? AGENT_SCOPES.filter((x) => x === s || cur.includes(x)) : cur.filter((x) => x !== s)))} />
          {t(SCOPE_LABEL[s])}
        </label>
      ))}
      <div className="dim" style={{ fontSize: 12.5, margin: "10px 0 14px" }}>{t("agent.limits")} {t("oauth.revokeLater")}</div>
      {msg && <div style={{ color: "var(--color-accent-red, #d33)", fontSize: 13.5, marginBottom: 8 }}>{msg}</div>}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="bb" disabled={busy || !orgId || !picked.length} onClick={() => decide(true)}>
          <Icon name="check" size={15} /> {busy ? t("agent.working") : t("oauth.approve")}
        </button>
        <button type="button" className="bo" disabled={busy} onClick={() => decide(false)}>{t("oauth.deny")}</button>
      </div>
    </>,
  );
}
