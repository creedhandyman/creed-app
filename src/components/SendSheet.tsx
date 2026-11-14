"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Icon } from "./Icon";
import { t } from "@/lib/i18n";

/**
 * Bottom sheet for sending something to a customer from the owner's own
 * phone: Text (sms:) · Email (mailto:) · Copy · Share (native sheet). The
 * message is editable. `onSent` fires on any of those — the caller records
 * that it went out (e.g. jobs.quote_sent_at). Opening the sheet alone does
 * not count as sent.
 *
 * Used by BOTH Send buttons — the quote editor's (QuoteForge) and the job
 * screen's (Jobs: Send quote / Follow up / Message customer / Send invoice) —
 * so the two stay the same. The job screen may pass `recipients` (client +
 * tenant chips); `onSent` then says which one it went to.
 */
export interface SendRecipient {
  label: string;
  phone: string;
  email?: string;
  message: string;
}
export interface SendSheetProps {
  title: string;
  phone?: string;
  email?: string;
  subject: string;
  message: string;
  onClose: () => void;
  /** Two or more people to send to (e.g. client + tenant): shows a chip per
   *  person; picking one swaps in their number, email and message. When set,
   *  it replaces phone / email / message. */
  recipients?: SendRecipient[];
  /** How it went out — Copy only puts it on the clipboard (the caller can skip
   *  a "sent" toast). `to` = the index into `recipients` (0 without them). */
  onSent: (via: "text" | "email" | "copy" | "share", to: number) => void;
}

export default function SendSheet({ title, phone: phoneProp = "", email: emailProp = "", subject, message, recipients, onClose, onSent }: SendSheetProps) {
  const [to, setTo] = useState(0);
  const cur = recipients?.[to];
  const phone = cur ? cur.phone : phoneProp;
  const email = cur ? cur.email || "" : emailProp;
  const startMsg = cur ? cur.message : message;
  const [msg, setMsg] = useState(startMsg);
  useEffect(() => setMsg(startMsg), [startMsg]);
  const toast = useStore.getState().showToast;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const digits = phone.replace(/[^\d+]/g, "");

  const sent = (via: "text" | "email" | "copy" | "share") => { onSent(via, to); onClose(); };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(5,5,12,.72)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="cd" style={{ width: "100%", maxWidth: 520, borderRadius: "18px 18px 0 0", padding: "16px 16px calc(16px + env(safe-area-inset-bottom))", margin: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <h3 style={{ fontFamily: "Oswald", fontSize: 18, textTransform: "uppercase" }}>{title}</h3>
          <button className="iconbtn" onClick={onClose} aria-label={t("common.close")}><Icon name="close" size={16} /></button>
        </div>
        {recipients && recipients.length > 1 && (
          <div style={{ display: "flex", gap: 5, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="dim" style={{ fontSize: 12.5, marginRight: 2 }}>{t("jobs.sendTo")}</span>
            {recipients.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setTo(i)}
                style={{
                  padding: "3px 10px", borderRadius: 99, fontSize: 12.5, fontFamily: "Oswald",
                  background: to === i ? "var(--color-primary)" : "transparent",
                  color: to === i ? "#fff" : "var(--color-dim)",
                  border: `1px solid ${to === i ? "var(--color-primary)" : "var(--color-border-dark-2)"}`,
                  cursor: "pointer",
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
        <div className="dim" style={{ fontSize: 12.5, marginBottom: 6 }}>
          {phone || email ? t("send.toEdit").replace("{to}", [phone, email].filter(Boolean).join(" · ")) : t("send.noContact")}
        </div>
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={7}
          style={{ width: "100%", fontSize: 14, padding: 10, borderRadius: 10, resize: "vertical", fontFamily: "Source Sans 3, sans-serif" }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
          <a className="bb" href={`sms:${digits}?&body=${encodeURIComponent(msg)}`} onClick={() => sent("text")}
            style={{ textAlign: "center", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: 11 }}>
            <Icon name="send" size={15} color="#fff" /> {t("send.text")}
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
      </div>
    </div>
  );
}
