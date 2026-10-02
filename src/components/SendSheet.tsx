"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Icon } from "./Icon";

/**
 * Bottom sheet for sending something to a customer from the owner's own
 * phone: Text (sms:) · Email (mailto:) · Copy · Share (native sheet). The
 * message is editable. `onSent` fires on any of those — the caller records
 * that it went out (e.g. jobs.quote_sent_at). Opening the sheet alone does
 * not count as sent.
 */
export interface SendSheetProps {
  title: string;
  phone?: string;
  email?: string;
  subject: string;
  message: string;
  onClose: () => void;
  onSent: () => void;
}

export default function SendSheet({ title, phone = "", email = "", subject, message, onClose, onSent }: SendSheetProps) {
  const [msg, setMsg] = useState(message);
  useEffect(() => setMsg(message), [message]);
  const toast = useStore.getState().showToast;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const digits = phone.replace(/[^\d+]/g, "");

  const sent = () => { onSent(); onClose(); };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(5,5,12,.72)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="cd" style={{ width: "100%", maxWidth: 520, borderRadius: "18px 18px 0 0", padding: "16px 16px calc(16px + env(safe-area-inset-bottom))", margin: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <h3 style={{ fontFamily: "Oswald", fontSize: 18, textTransform: "uppercase" }}>{title}</h3>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        <div className="dim" style={{ fontSize: 12.5, marginBottom: 6 }}>
          {phone || email ? `To ${[phone, email].filter(Boolean).join(" · ")} — edit the message if needed` : "No phone or email on file — pick a contact when your Messages or Mail app opens, or use Copy / Share."}
        </div>
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={7}
          style={{ width: "100%", fontSize: 14, padding: 10, borderRadius: 10, resize: "vertical", fontFamily: "Source Sans 3, sans-serif" }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
          <a className="bb" href={`sms:${digits}?&body=${encodeURIComponent(msg)}`} onClick={sent}
            style={{ textAlign: "center", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: 11 }}>
            <Icon name="send" size={15} color="#fff" /> Text
          </a>
          <a className="bo" href={`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(msg)}`} onClick={sent}
            style={{ textAlign: "center", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: 11, color: "inherit" }}>
            <Icon name="mail" size={15} /> Email
          </a>
          <button className="bo" style={{ padding: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            onClick={async () => {
              try { await navigator.clipboard.writeText(msg); toast("Copied — paste it into any message", "success"); sent(); }
              catch { toast("Couldn't copy on this device — use Text or Share", "error"); }
            }}>
            <Icon name="doc" size={15} /> Copy
          </button>
          {canShare ? (
            <button className="bo" style={{ padding: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              onClick={async () => {
                try { await navigator.share({ title: subject, text: msg }); sent(); }
                catch (e) { if ((e as Error)?.name !== "AbortError") toast("Couldn't open sharing — use Text or Copy", "error"); }
              }}>
              <Icon name="link" size={15} /> Share
            </button>
          ) : <span />}
        </div>
      </div>
    </div>
  );
}
