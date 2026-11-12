"use client";
/**
 * Ops → Campaigns (shown only while email campaigns are on). A list of the
 * business's campaigns with their numbers, and an editor: who it goes to
 * (live count), subject, body, starter templates, an AI first draft, a test
 * email to yourself, then Send now or Schedule behind a confirm.
 * Server: /api/campaigns (+ /count, /draft, /send, /cancel); the cron at
 * /api/campaigns/dispatch does the actual sending. Rules: lib/campaigns.ts.
 */
import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { Icon } from "../Icon";
import {
  AUDIENCES,
  AUDIENCE_LABEL,
  STARTER_TEMPLATES,
  campaignProblems,
  type Campaign,
  type CampaignAudience,
} from "@/lib/campaigns";

type Stats = Record<string, number>;

const STATUS_LABEL: Record<Campaign["status"], string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  cancelled: "Cancelled",
};

const fmtWhen = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

async function post<T = Record<string, unknown>>(url: string, body: unknown): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const res = await apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { ok: res.ok, data };
}

export default function Campaigns() {
  const org = useStore((s) => s.org);
  const toast = useStore((s) => s.showToast);
  const [list, setList] = useState<Campaign[] | null>(null);
  const [stats, setStats] = useState<Record<string, Stats>>({});
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<Partial<Campaign> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/campaigns", { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setLoadError(d?.error || "Couldn't load campaigns."); setList([]); return; }
      setList(d.campaigns || []);
      setStats(d.stats || {});
      setLoadError("");
    } catch {
      setLoadError("Couldn't reach the server.");
      setList([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (editing) {
    return (
      <Editor
        initial={editing}
        address={org?.address || ""}
        onClose={() => { setEditing(null); load(); }}
        toast={toast}
      />
    );
  }

  return (
    <div>
      <div className="cd mb">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div className="dim" style={{ fontSize: 14 }}>
            One email to a group of your customers. People who unsubscribed are always left out.
          </div>
          <button className="bb" onClick={() => setEditing({ audience: "all", subject: "", body: "", name: "" })} style={{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="add" size={14} /> New
          </button>
        </div>
      </div>

      {loadError && <div className="cd mb" style={{ color: "var(--color-accent-red)" }}>{loadError}</div>}
      {list === null && <div className="dim" style={{ padding: 12 }}>Loading…</div>}
      {list && list.length === 0 && !loadError && (
        <div className="cd mb dim" style={{ fontSize: 14 }}>No campaigns yet. Tap New to write your first one.</div>
      )}
      {(list || []).map((c) => {
        const st = stats[c.id] || {};
        const sent = st.sent || 0;
        return (
          <button
            key={c.id}
            className="cd mb"
            onClick={() => setEditing(c)}
            style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer", color: "inherit", font: "inherit" }}
          >
            <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 15 }}>{c.name || c.subject || "Untitled"}</span>
              <span className="dim" style={{ fontSize: 12.5 }}>{STATUS_LABEL[c.status]}</span>
            </div>
            <div className="dim" style={{ fontSize: 13, marginTop: 3 }}>
              {AUDIENCE_LABEL[c.audience]}
              {c.status === "scheduled" && c.scheduled_for ? ` · goes out ${fmtWhen(c.scheduled_for)}` : ""}
              {c.status === "sent" && c.sent_at ? ` · sent ${fmtWhen(c.sent_at)}` : ""}
            </div>
            {c.status !== "draft" && (
              <div style={{ fontSize: 13, marginTop: 4 }}>
                {sent} of {c.recipient_count || 0} sent
                {st.opened ? ` · ${st.opened} opened` : ""}
                {st.clicked ? ` · ${st.clicked} clicked` : ""}
                {st.failed ? ` · ${st.failed} failed` : ""}
                {st.bounced ? ` · ${st.bounced} bounced` : ""}
              </div>
            )}
            {c.last_error && <div style={{ fontSize: 13, marginTop: 4, color: "var(--color-accent-red)" }}>{c.last_error}</div>}
          </button>
        );
      })}
    </div>
  );
}

function Editor({ initial, address, onClose, toast }: {
  initial: Partial<Campaign>;
  address: string;
  onClose: () => void;
  toast: (m: string, kind?: "success" | "error" | "info") => void;
}) {
  const readOnly = !!initial.status && initial.status !== "draft";
  const [id, setId] = useState(initial.id || "");
  const [name, setName] = useState(initial.name || "");
  const [audience, setAudience] = useState<CampaignAudience>(initial.audience || "all");
  const [subject, setSubject] = useState(initial.subject || "");
  const [body, setBody] = useState(initial.body || "");
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [idea, setIdea] = useState("");
  const [when, setWhen] = useState("");

  useEffect(() => {
    if (readOnly) return;
    let stop = false;
    setCount(null);
    post<{ count?: number }>("/api/campaigns/count", { audience }).then(({ ok, data }) => {
      if (!stop) setCount(ok && typeof data.count === "number" ? data.count : null);
    });
    return () => { stop = true; };
  }, [audience, readOnly]);

  const save = async (): Promise<string | null> => {
    const { ok, data } = await post<{ campaign?: Campaign }>("/api/campaigns", { id: id || undefined, name, subject, body, audience });
    if (!ok || !data.campaign) { toast(data.error || "Couldn't save", "error"); return null; }
    setId(data.campaign.id);
    return data.campaign.id;
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); } finally { setBusy(""); }
  };

  const problems = campaignProblems({ subject, body }, { address });

  const sendTest = () => run("test", async () => {
    const cid = await save();
    if (!cid) return;
    const { ok, data } = await post<{ to?: string }>("/api/campaigns/send", { id: cid, test: true });
    toast(ok ? `Test sent to ${data.to}` : data.error || "Test didn't send", ok ? "success" : "error");
  });

  const send = () => run("send", async () => {
    if (problems.length) { toast(problems[0], "error"); return; }
    const cid = await save();
    if (!cid) return;
    const at = when ? new Date(when) : null;
    const n = count ?? 0;
    const whenText = at ? `on ${fmtWhen(at.toISOString())}` : "within the next 15 minutes";
    const okd = await useStore.getState().showConfirm(
      "Send this campaign?",
      `"${subject}" goes to ${n} ${n === 1 ? "customer" : "customers"} (${AUDIENCE_LABEL[audience].toLowerCase()}) ${whenText}. You can't change it after this, only cancel what hasn't gone out.`,
      { confirmLabel: at ? "Schedule" : "Send", danger: false },
    );
    if (!okd) return;
    const { ok, data } = await post<{ count?: number }>("/api/campaigns/send", { id: cid, scheduledFor: at ? at.toISOString() : undefined });
    if (!ok) { toast(data.error || "Couldn't send", "error"); return; }
    toast(at ? `Scheduled for ${data.count} customers` : `Sending to ${data.count} customers`, "success");
    onClose();
  });

  const cancel = () => run("cancel", async () => {
    const isDraft = !initial.status || initial.status === "draft";
    if (!id) { onClose(); return; }
    const okd = await useStore.getState().showConfirm(
      isDraft ? "Delete draft" : "Cancel campaign",
      isDraft ? "Delete this draft?" : "Stop this campaign? Emails already sent stay sent; the rest won't go out.",
    );
    if (!okd) return;
    const { ok, data } = await post("/api/campaigns/cancel", { id });
    if (!ok) { toast(data.error || "Couldn't cancel", "error"); return; }
    onClose();
  });

  const draftWithAi = () => run("ai", async () => {
    if (!idea.trim()) { toast("Say what the email is about first", "error"); return; }
    const { ok, data } = await post<{ subject?: string; body?: string }>("/api/campaigns/draft", { idea, audience });
    if (!ok || !data.subject) { toast(data.error || "Couldn't write a draft", "error"); return; }
    setSubject(data.subject);
    setBody(data.body || "");
  });

  return (
    <div>
      <button className="bo" onClick={onClose} style={{ marginBottom: 10, display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Icon name="back" size={14} /> All campaigns
      </button>

      {!readOnly && (
        <div className="cd mb">
          <label className="sl">Start from</label>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            {STARTER_TEMPLATES.map((tpl) => (
              <button
                key={tpl.key}
                className="bo"
                style={{ fontSize: 12.5 }}
                onClick={() => { setName(tpl.name); setAudience(tpl.audience); setSubject(tpl.subject); setBody(tpl.body); }}
              >
                {tpl.name}
              </button>
            ))}
          </div>
          <label className="sl" style={{ marginTop: 10, display: "block" }}>Or have AI write a first draft</label>
          <div className="row" style={{ gap: 6, marginTop: 4 }}>
            <input value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. winterize your home before the first freeze" style={{ flex: 1 }} />
            <button className="bo" disabled={!!busy} onClick={draftWithAi} style={{ whiteSpace: "nowrap" }}>
              {busy === "ai" ? "Writing…" : "Draft it"}
            </button>
          </div>
        </div>
      )}

      <div className="cd mb">
        <label className="sl">Name (only you see this)</label>
        <input value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} placeholder="Fall check-up" style={{ marginTop: 4, width: "100%" }} />

        <label className="sl" style={{ marginTop: 10, display: "block" }}>Goes to</label>
        <select value={audience} disabled={readOnly} onChange={(e) => setAudience(e.target.value as CampaignAudience)} style={{ marginTop: 4, width: "100%" }}>
          {AUDIENCES.map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
        </select>
        {!readOnly && (
          <div className="dim" style={{ fontSize: 13, marginTop: 3 }}>
            {count === null ? "Counting…" : `${count} ${count === 1 ? "customer" : "customers"} with an email, not unsubscribed`}
          </div>
        )}

        <label className="sl" style={{ marginTop: 10, display: "block" }}>Subject</label>
        <input value={subject} disabled={readOnly} onChange={(e) => setSubject(e.target.value)} style={{ marginTop: 4, width: "100%" }} />

        <label className="sl" style={{ marginTop: 10, display: "block" }}>Email</label>
        <textarea value={body} disabled={readOnly} onChange={(e) => setBody(e.target.value)} style={{ marginTop: 4, width: "100%", minHeight: 200 }} />
        <div className="dim" style={{ fontSize: 13, marginTop: 3 }}>
          You can use {"{first_name}"}, {"{business_name}"} and {"{referral_link}"}. Your business address and an unsubscribe link are added at the bottom.
        </div>
      </div>

      {!readOnly && (
        <div className="cd mb">
          <label className="sl">Send later (optional)</label>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ marginTop: 4, width: "100%" }} />
          {problems.length > 0 && (
            <div style={{ fontSize: 13.5, marginTop: 8, color: "var(--color-accent-red)" }}>{problems[0]}</div>
          )}
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button className="bo" disabled={!!busy} onClick={() => run("save", async () => { if (await save()) toast("Draft saved", "success"); })}>
              {busy === "save" ? "Saving…" : "Save draft"}
            </button>
            <button className="bo" disabled={!!busy} onClick={sendTest}>
              {busy === "test" ? "Sending…" : "Email me a test"}
            </button>
            <button className="bb" disabled={!!busy || problems.length > 0 || !count} onClick={send}>
              {busy === "send" ? "Working…" : when ? "Schedule" : "Send"}
            </button>
          </div>
        </div>
      )}

      {(id || readOnly) && (initial.status === "draft" || initial.status === "scheduled" || initial.status === "sending" || !initial.status) && (
        <button className="bo" disabled={!!busy} onClick={cancel} style={{ color: "var(--color-accent-red)" }}>
          {readOnly ? "Cancel campaign" : "Delete draft"}
        </button>
      )}
    </div>
  );
}
