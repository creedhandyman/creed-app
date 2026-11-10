"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { t } from "@/lib/i18n";
import { prettyPhone } from "@/lib/sms-inbound";
import { MAX_REPLY } from "@/lib/sms-threads";
import { fmtWhen, refreshTextsUnread } from "@/lib/texts-client";
import { useBackLayer } from "@/lib/back-layer";
import TopBar from "@/components/TopBar";
import { Icon } from "@/components/Icon";
import { statusLabel } from "@/components/StatusSheet";

/**
 * Texts: customer conversations on the business number (build 2 of
 * "receiving Twilio replies"). A list, one row per phone number, newest
 * first; tap one for both sides of the conversation and a reply box that
 * sends from the business number (/api/sms/reply: STOP check + log).
 * Owners/managers see every conversation, crew those on their jobs (the
 * server decides). Unknown numbers get Make a lead (owners/managers).
 * Polls every 15s while open.
 */

const COLOR = "#38bdf8";
const POLL_MS = 15_000;

interface ThreadRow {
  phone: string;
  lastAt: string;
  lastDirection: "in" | "out";
  preview: string;
  unread: number;
  jobId: string | null;
  match: string | null;
  name: string;
  address: string;
  optedOut: boolean;
}

interface Msg {
  id: string;
  direction: "in" | "out";
  body: string;
  status: string;
  error: string;
  kind: string;
  media: { url: string }[];
  createdAt: string;
}

interface Thread {
  phone: string;
  jobId: string | null;
  customerId: string | null;
  /** Showing only the texts on this job (opened from its page). */
  onlyJob: string | null;
  /** Owner/manager on an unknown or Check-match conversation: may re-file it. */
  canAssign: boolean;
  match: string | null;
  name: string;
  address: string;
  jobStatus: string;
  optedOut: boolean;
  texting: boolean;
  admin: boolean;
  messages: Msg[];
}

interface Props {
  openJob: (jobId: string) => void;
  /** Open straight onto one conversation (a push or bell tap, or a job or
   *  customer page's Texts card; onJob = from that job's page: show only its
   *  texts, and closing goes back to the job). */
  initial?: { phone?: string; jobId?: string; at?: string; onJob?: string } | null;
  clearInitial?: () => void;
}

const who = (name: string, phone: string) => name || prettyPhone(phone);

function initialsOf(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter((c) => c && /[A-Za-z]/.test(c)).slice(0, 2).join("").toUpperCase();
}

export default function Texts({ openJob, initial, clearInitial }: Props) {
  const darkMode = useStore((s) => s.darkMode);
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [listError, setListError] = useState(false);
  const [open, setOpen] = useState<string | null>(initial?.phone || null);
  const fromJob = useRef<string | null>(initial?.phone && initial.onJob ? initial.onJob : null);
  const close = useCallback(() => {
    const back = fromJob.current;
    fromJob.current = null;
    setOpen(null);
    if (back) openJob(back);
  }, [openJob]);
  const wantJob = useRef<{ jobId: string; at?: string } | null>(
    initial?.jobId ? { jobId: initial.jobId, at: initial.at } : null,
  );

  useEffect(() => {
    if (initial) clearInitial?.();
    // one-shot: the deep link is applied on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useBackLayer(!!open, close);

  const loadList = useCallback(async () => {
    try {
      const want = wantJob.current;
      const qs = want
        ? `?job=${encodeURIComponent(want.jobId)}${want.at ? `&at=${encodeURIComponent(want.at)}` : ""}`
        : "";
      const r = await apiFetch(`/api/sms/threads${qs}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { threads?: ThreadRow[]; unread?: number; bellPhone?: string | null };
      const list = j.threads || [];
      setThreads(list);
      setListError(false);
      // A bell tap names a job and a time, not a number. A property-manager
      // job can have two conversations (the manager and the resident), so the
      // server picks the one whose text came in at that alert (bellPhone);
      // else the job's conversation with unread texts, else its newest.
      if (want) {
        wantJob.current = null;
        const onJob = list.filter((x) => x.jobId === want.jobId);
        const hit = j.bellPhone || (onJob.find((x) => x.unread > 0) || onJob[0])?.phone;
        if (hit) setOpen(hit);
      }
    } catch {
      setListError(true);
      setThreads((cur) => cur || []);
    }
  }, []);

  useEffect(() => {
    if (open) return;
    loadList();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") loadList();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [open, loadList]);

  if (open) {
    return <Conversation phone={open} onJob={fromJob.current} onBack={close} openJob={openJob} darkMode={darkMode} />;
  }

  return (
    <div className="fi">
      <TopBar title={t("nav.texts")} icon="texts" color={COLOR} />
      {threads === null ? (
        <div className="dim" style={{ textAlign: "center", padding: 30 }}>…</div>
      ) : threads.length === 0 ? (
        <div className="cd" style={{ textAlign: "center", padding: "34px 18px" }}>
          <Icon name="texts" size={30} color="var(--color-dim)" />
          <div style={{ fontSize: 15, marginTop: 10 }}>{listError ? t("texts.loadFailed") : t("texts.empty")}</div>
        </div>
      ) : (
        <div className="cd" style={{ padding: 0, overflow: "hidden" }}>
          {threads.map((th, i) => {
            const name = who(th.name, th.phone);
            const ini = th.name ? initialsOf(th.name) : "";
            const flag = th.match === "several" ? t("texts.checkJob") : !th.jobId && !th.name ? t("texts.newNumber") : "";
            return (
              <div
                key={th.phone}
                onClick={() => setOpen(th.phone)}
                style={{
                  display: "flex", gap: 11, padding: "12px 13px", cursor: "pointer", alignItems: "center",
                  borderTop: i ? "1px solid var(--color-border-dark)" : "none",
                  background: th.unread ? `linear-gradient(90deg, ${COLOR}14, transparent 70%)` : "transparent",
                }}
              >
                <div style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0, background: `${COLOR}22`, color: COLOR, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Oswald", fontWeight: 600 }}>
                  {ini || <Icon name="phone" size={17} color={COLOR} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 15.5, fontWeight: th.unread ? 700 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                    <span className="dim" style={{ fontSize: 12.5, whiteSpace: "nowrap", flexShrink: 0 }}>{fmtWhen(th.lastAt)}</span>
                  </div>
                  {(th.address || flag) && (
                    <div style={{ fontSize: 12.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {flag && <span style={{ color: "var(--color-warning)", fontWeight: 600 }}>{flag}{th.address ? " · " : ""}</span>}
                      <span className="dim">{th.address}</span>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
                    <span className="dim" style={{ flex: 1, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: th.unread ? 600 : undefined, color: th.unread ? (darkMode ? "#e6ebf5" : "#1b2130") : undefined }}>
                      {th.lastDirection === "out" ? `${t("texts.you")}: ` : ""}{th.preview || t("texts.photo")}
                    </span>
                    {th.optedOut && <span style={{ fontSize: 11.5, color: "var(--color-warning)", fontWeight: 600 }}>STOP</span>}
                    {th.unread > 0 && (
                      <span style={{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: COLOR, color: "#04131c", fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {th.unread > 9 ? "9+" : th.unread}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function statusLine(m: Msg): { text: string; bad: boolean } | null {
  if (m.direction !== "out") return null;
  if (m.status === "skipped") return { text: t("texts.notSentStop"), bad: true };
  if (m.status === "failed" || m.status === "undelivered") return { text: t("texts.failed"), bad: true };
  if (m.status === "delivered") return { text: t("texts.delivered"), bad: false };
  return { text: t("texts.sent"), bad: false };
}

function Conversation({
  phone, onJob, onBack, openJob, darkMode,
}: {
  phone: string;
  /** Opened from this job's page: only its texts, until Show all. */
  onJob: string | null;
  onBack: () => void;
  openJob: (id: string) => void;
  darkMode: boolean;
}) {
  const showToast = useStore((s) => s.showToast);
  const loadAll = useStore((s) => s.loadAll);
  const [th, setTh] = useState<Thread | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [making, setMaking] = useState(false);
  const [filterJob, setFilterJob] = useState<string | null>(onJob);
  const [picking, setPicking] = useState<"customer" | "job" | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastId = useRef<string>("");

  const markRead = useCallback(async () => {
    try {
      await apiFetch("/api/sms/thread", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) });
      refreshTextsUnread();
    } catch { /* next open marks them */ }
  }, [phone]);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/sms/thread?phone=${encodeURIComponent(phone)}${filterJob ? `&job=${encodeURIComponent(filterJob)}` : ""}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError((j as { error?: string }).error || t("texts.loadFailed"));
        return;
      }
      const next = j as Thread & { unread?: number };
      setTh(next);
      setError("");
      if ((next.unread || 0) > 0) markRead();
    } catch {
      setError(t("texts.loadFailed"));
    }
  }, [phone, filterJob, markRead]);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Keep the newest text in view when one arrives.
  useEffect(() => {
    const newest = th?.messages[th.messages.length - 1]?.id || "";
    if (newest && newest !== lastId.current) {
      lastId.current = newest;
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [th]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await apiFetch("/api/sms/reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, body, ...(th?.onlyJob ? { jobId: th.onlyJob } : {}) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) showToast((j as { error?: string }).error || t("texts.sendFailed"), "error");
      else setDraft("");
      await load();
    } catch {
      showToast(t("texts.sendFailed"), "error");
    } finally {
      setSending(false);
    }
  };

  const makeLead = async () => {
    if (making) return;
    setMaking(true);
    try {
      const r = await apiFetch("/api/sms/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) showToast((j as { error?: string }).error || t("texts.leadFailed"), "error");
      else {
        showToast(t("texts.leadMade"), "success");
        loadAll();
        await load();
      }
    } catch {
      showToast(t("texts.leadFailed"), "error");
    } finally {
      setMaking(false);
    }
  };

  const assign = async (target: { customerId: string } | { jobId: string }) => {
    setPicking(null);
    if (making) return;
    setMaking(true);
    try {
      const r = await apiFetch("/api/sms/assign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, ...target }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) showToast((j as { error?: string }).error || t("texts.moveFailed"), "error");
      else {
        showToast(t("texts.moved"), "success");
        loadAll();
        setFilterJob(null);
        await load();
      }
    } catch {
      showToast(t("texts.moveFailed"), "error");
    } finally {
      setMaking(false);
    }
  };

  const title = th ? who(th.name, phone) : prettyPhone(phone);
  const unknown = !!th && !th.jobId && !th.name;
  const canType = !!th && th.texting && !th.optedOut;

  return (
    <div className="fi">
      <TopBar
        title={title}
        icon="texts"
        color={COLOR}
        onBack={onBack}
        right={
          <a href={`tel:${phone}`} className="iconbtn" aria-label={t("texts.call")} style={{ display: "inline-flex" }}>
            <Icon name="phone" size={17} />
          </a>
        }
      />

      {th && (th.address || th.jobId || unknown) && (
        <div className="cd mb" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {th.address || (unknown ? t("texts.unknown") : prettyPhone(phone))}
            </div>
            {th.name && <div className="dim" style={{ fontSize: 12.5 }}>{prettyPhone(phone)}</div>}
          </div>
          {th.jobId && (
            <button className="bo" onClick={() => openJob(th.jobId!)} style={{ flexShrink: 0, padding: "6px 12px", fontSize: 13 }}>
              {t("texts.openJob")}
            </button>
          )}
          {unknown && th.admin && (
            <button className="bb" onClick={makeLead} disabled={making} style={{ flexShrink: 0, padding: "6px 12px", fontSize: 13 }}>
              {making ? "…" : t("texts.makeLead")}
            </button>
          )}
        </div>
      )}

      {th?.canAssign && (
        <div className="mb" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "0 4px" }}>
          {th.match === "several" && (
            <span style={{ flex: "1 1 200px", fontSize: 13, color: "var(--color-warning)" }}>{t("texts.several")}</span>
          )}
          {unknown && <span className="dim" style={{ flex: "1 1 200px", fontSize: 13 }}>{t("texts.linkHint")}</span>}
          <button className="bo" onClick={() => setPicking("customer")} disabled={making} style={{ padding: "6px 12px", fontSize: 13 }}>
            {t("texts.linkCustomer")}
          </button>
          <button className="bo" onClick={() => setPicking("job")} disabled={making} style={{ padding: "6px 12px", fontSize: 13 }}>
            {t("texts.moveJob")}
          </button>
        </div>
      )}
      {th?.match === "several" && !th.canAssign && (
        <div className="mb" style={{ fontSize: 13, color: "var(--color-warning)", padding: "0 4px" }}>{t("texts.several")}</div>
      )}

      {th?.onlyJob && (
        <div className="mb dim" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "0 4px" }}>
          <span style={{ flex: 1 }}>{t("texts.onlyThisJob")}</span>
          <button className="bo" onClick={() => setFilterJob(null)} style={{ padding: "4px 10px", fontSize: 12.5 }}>{t("texts.showAll")}</button>
        </div>
      )}

      <PickSheet
        open={!!picking}
        kind={picking || "customer"}
        customerId={th?.customerId || null}
        onPick={(id) => assign(picking === "customer" ? { customerId: id } : { jobId: id })}
        onClose={() => setPicking(null)}
      />

      {error && !th && <div className="cd" style={{ textAlign: "center", padding: 24 }}>{error}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 2px 10px" }}>
        {th?.messages.map((m) => {
          const mine = m.direction === "out";
          if (m.direction === "in" && (m.kind === "stop" || m.kind === "start")) {
            return (
              <div key={m.id} className="dim" style={{ textAlign: "center", fontSize: 12.5, margin: "4px 0" }}>
                {m.kind === "stop" ? t("texts.stopped") : t("texts.started")} · {fmtWhen(m.createdAt)}
              </div>
            );
          }
          const st = statusLine(m);
          return (
            <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start" }}>
              <div
                style={{
                  maxWidth: "82%", padding: "8px 12px", borderRadius: 16, fontSize: 15, lineHeight: 1.38, whiteSpace: "pre-wrap", wordBreak: "break-word",
                  background: mine ? COLOR : darkMode ? "var(--color-card-dark-3)" : "#e7eaf0",
                  color: mine ? "#04131c" : undefined,
                  borderBottomRightRadius: mine ? 5 : 16,
                  borderBottomLeftRadius: mine ? 16 : 5,
                }}
              >
                {m.media.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: m.body ? 6 : 0 }}>
                    {m.media.map((p) => (
                      <a key={p.url} href={p.url} target="_blank" rel="noreferrer">
                        <img src={p.url} alt={t("texts.photo")} style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 10, display: "block" }} />
                      </a>
                    ))}
                  </div>
                )}
                {m.body}
              </div>
              <div className="dim" style={{ fontSize: 11.5, marginTop: 2, padding: "0 4px" }}>
                {fmtWhen(m.createdAt)}
                {st && <span style={{ color: st.bad ? "var(--color-warning)" : undefined }}> · {st.text}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {th && (
        <div className="cd" style={{ padding: 10 }}>
          {th.optedOut ? (
            <div style={{ fontSize: 13.5, color: "var(--color-warning)" }}>{t("texts.optedOut")}</div>
          ) : !th.texting ? (
            <div style={{ fontSize: 13.5, color: "var(--color-warning)" }}>{t("texts.textingOff")}</div>
          ) : null}
          {canType && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_REPLY))}
                placeholder={t("texts.placeholder")}
                rows={2}
                style={{ flex: 1, resize: "none", fontSize: 15 }}
              />
              <button className="bb" onClick={send} disabled={sending || !draft.trim()} style={{ flexShrink: 0, padding: "9px 14px" }}>
                {sending ? "…" : t("texts.send")}
              </button>
            </div>
          )}
        </div>
      )}
      {/* Scrolled into view on a new text, so the reply box shows too. */}
      <div ref={endRef} />
    </div>
  );
}

/**
 * Pick where an unknown or Check-match conversation belongs: a customer
 * (Link to customer) or a job (Move to job). Searches what's already loaded.
 * A customer's own jobs come first when the conversation has a customer.
 */
function PickSheet({
  open, kind, customerId, onPick, onClose,
}: {
  open: boolean;
  kind: "customer" | "job";
  customerId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const customers = useStore((s) => s.customers) ?? [];
  const jobs = useStore((s) => s.jobs);
  const [q, setQ] = useState("");
  // Phone back closes the sheet, not the conversation.
  useBackLayer(open, onClose);
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);
  if (!open) return null;

  const needle = q.trim().toLowerCase();
  const rows: { id: string; title: string; sub: string }[] =
    kind === "customer"
      ? customers
          .filter((c) => !needle || `${c.name} ${c.phone || ""} ${c.primary_contact || ""}`.toLowerCase().includes(needle))
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
          .slice(0, 40)
          .map((c) => ({ id: c.id, title: c.name || "—", sub: [c.primary_contact, c.phone].filter(Boolean).join(" · ") }))
      : jobs
          .filter((j) => !j.archived)
          .filter((j) => !needle || `${j.property} ${j.client}`.toLowerCase().includes(needle))
          .sort((a, b) => {
            const mine = Number(b.customer_id === customerId && !!customerId) - Number(a.customer_id === customerId && !!customerId);
            return mine || (b.job_date || "").localeCompare(a.job_date || "");
          })
          .slice(0, 40)
          .map((j) => ({ id: j.id, title: j.property || "—", sub: [j.client, statusLabel(j.status), j.job_date].filter(Boolean).join(" · ") }));

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="cd sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, paddingTop: 18 }}>
        <h3 style={{ fontFamily: "Oswald", fontSize: 18, textTransform: "uppercase", marginBottom: 6 }}>
          {kind === "customer" ? t("texts.linkCustomer") : t("texts.moveJob")}
        </h3>
        <div className="dim" style={{ fontSize: 13, marginBottom: 10 }}>
          {kind === "customer" ? t("texts.linkCustomerHint") : t("texts.moveJobHint")}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={kind === "customer" ? t("texts.searchCustomers") : t("texts.searchJobs")}
          autoFocus
          style={{ width: "100%", marginBottom: 8 }}
        />
        <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
          {rows.length === 0 && <div className="dim" style={{ fontSize: 13.5, padding: "10px 2px" }}>{t("texts.noMatches")}</div>}
          {rows.map((r) => (
            <div key={r.id} className="linkrow" onClick={() => onPick(r.id)} style={{ cursor: "pointer" }}>
              <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
                {r.sub && <span className="dim" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sub}</span>}
              </span>
              <Icon name="next" size={15} style={{ color: "var(--color-dim)", flexShrink: 0 }} />
            </div>
          ))}
        </div>
        <button className="bo" type="button" onClick={onClose} style={{ marginTop: 12, width: "100%" }}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
