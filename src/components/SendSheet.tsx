"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Icon } from "./Icon";
import { t } from "@/lib/i18n";
import { MAX_JOB_MESSAGE } from "@/lib/job-send";
import { sendJobMessage } from "@/lib/job-text-client";

/**
 * Bottom sheet for sending something to a customer from the owner's own
 * phone: Text (sms:) · Email (mailto:) · Copy · Share (native sheet). The
 * message is editable. `onSent` fires on any of those — the caller records
 * that it went out (e.g. jobs.quote_sent_at). Opening the sheet alone does
 * not count as sent.
 *
 * With `viaBusiness` + `jobId` (Ops set to the business number) the main
 * button is "Send text": it goes out from the business number through
 * /api/sms, shows in Texts, and `onSent("business")` fires ONLY once the
 * server confirms the send. The phone options stay underneath.
 */
export interface SendSheetProps {
  title: string;
  phone?: string;
  email?: string;
  subject: string;
  message: string;
  onClose: () => void;
  /** How it went out — Copy only puts it on the clipboard (the caller can skip a "sent" toast).
   *  "business" = sent from the business number and confirmed by the server. */
  onSent: (via: SentVia) => void;
  /** The saved job this message is about (needed to send from the business number). */
  jobId?: string;
  /** Ops is set to send customer texts from the business number. */
  viaBusiness?: boolean;
}

export type SentVia = "text" | "email" | "copy" | "share" | "business";

export default function SendSheet({ title, phone = "", email = "", subject, message, onClose, onSent, jobId, viaBusiness }: SendSheetProps) {
  const [msg, setMsg] = useState(message);
  useEffect(() => setMsg(message), [message]);
  const [sending, setSending] = useState(false);
  const toast = useStore.getState().showToast;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const digits = phone.replace(/[^\d+]/g, "");
  const business = !!viaBusiness && !!jobId;

  const sent = (via: SentVia) => { onSent(via); onClose(); };

  // From the business number: the server picks the customer's number off the
  // job. Nothing is marked sent unless it answers ok; a failure keeps the
  // sheet (and the edited message) open.
  const sendBusiness = async () => {
    if (!jobId || sending || !msg.trim()) return;
    setSending(true);
    const r = await sendJobMessage(jobId, "client", msg);
    setSending(false);
    if (!r.ok) {
      toast(r.offline ? t("jobs.textNotSentOffline") : r.error || t("jobs.textNotSent"), "error");
      return;
    }
    sent("business");
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(5,5,12,.72)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="cd" style={{ width: "100%", maxWidth: 520, borderRadius: "18px 18px 0 0", padding: "16px 16px calc(16px + env(safe-area-inset-bottom))", margin: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <h3 style={{ fontFamily: "Oswald", fontSize: 18, textTransform: "uppercase" }}>{title}</h3>
          <button className="iconbtn" onClick={onClose} aria-label={t("common.close")}><Icon name="close" size={16} /></button>
        </div>
        <div className="dim" style={{ fontSize: 12.5, marginBottom: 6 }}>
          {phone || email ? t("send.toEdit").replace("{to}", [phone, email].filter(Boolean).join(" · ")) : t("send.noContact")}
        </div>
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={7} maxLength={business ? MAX_JOB_MESSAGE : undefined}
          style={{ width: "100%", fontSize: 14, padding: 10, borderRadius: 10, resize: "vertical", fontFamily: "Source Sans 3, sans-serif" }} />
        {business && (
          <button type="button" className="bb" disabled={sending || !msg.trim() || !phone} onClick={() => { void sendBusiness(); }}
            style={{ width: "100%", marginTop: 10, padding: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Icon name="send" size={15} color="#fff" /> {sending ? t("jobs.sendingText") : t("jobs.sendText")}
          </button>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: business ? 8 : 10 }}>
          <a className={business ? "bo" : "bb"} href={`sms:${digits}?&body=${encodeURIComponent(msg)}`} onClick={() => sent("text")}
            style={{ textAlign: "center", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: 11, ...(business ? { color: "inherit" } : {}) }}>
            {business
              ? <><Icon name="send" size={15} /> {t("jobs.messagesShort")}</>
              : <><Icon name="send" size={15} color="#fff" /> {t("send.text")}</>}
          </a>
          <a className="bo" href={`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(msg)}`} onClick={() => sent("email")}
            style={{ textAlign: "center", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: 11, color: "inherit" }}>
            <Icon name="mail" size={15} /> {t("send.email")}
          </a>
          <button className="bo" style={{ padding: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            onClick={async () => {
              try { await navigator.clipboard.writeText(msg); toast(t("send.copied"), "success"); sent("copy"); }
              catch { toast(t("send.copyFailed"), "error"); }
            }}>
            <Icon name="doc" size={15} /> {t("common.copy")}
          </button>
          {canShare ? (
            <button className="bo" style={{ padding: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              onClick={async () => {
                try { await navigator.share({ title: subject, text: msg }); sent("share"); }
                catch (e) { if ((e as Error)?.name !== "AbortError") toast(t("send.shareFailed"), "error"); }
              }}>
              <Icon name="link" size={15} /> {t("send.share")}
            </button>
          ) : <span />}
        </div>
        {business && (
          <div className="dim" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.4 }}>{t("jobs.sendTextHelp")}</div>
        )}
      </div>
    </div>
  );
}
