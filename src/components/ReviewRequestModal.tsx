"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import type { Job, Customer } from "@/lib/types";

interface Props {
  job: Job | null;          // job that just completed; null hides the modal
  onClose: () => void;       // called after send/skip/dismiss
  onSent?: () => void;       // called when a send action fires (post-patch)
}

/**
 * Review-request modal — appears when a job hits "complete" or "paid" so the
 * crew can fire off a one-tap text or email asking for a review while the
 * client's experience is still fresh. Pre-fills the message with the org
 * name, property, and a /review link tied to this specific job.
 *
 * No external API: sms: and mailto: open the user's native messaging app,
 * the user taps Send there. Same pattern as the existing "Send Job to
 * Client" button — no Twilio/SendGrid setup required.
 */
export default function ReviewRequestModal({ job, onClose, onSent }: Props) {
  const org = useStore((s) => s.org);
  const customers = useStore((s) => s.customers);
  const darkMode = useStore((s) => s.darkMode);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!job) return;
    // Pull contact info from the linked Customer entity. The legacy
    // free-text `job.client` string is still used as the display
    // greeting (it's whatever was typed when the job was created),
    // but phone/email come from the structured customer record now.
    const c = job.customer_id
      ? customers.find((cu) => cu.id === job.customer_id) ?? null
      : null;
    setCustomer(c);

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const reviewUrl = `${origin}/review?org=${org?.id || ""}&job=${job.id}`;
    const orgName = org?.name || "us";
    const firstName = (job.client || c?.name || "").split(/\s+/)[0] || "";

    setMessage(
      `Hi${firstName ? ` ${firstName}` : ""}! Thanks for choosing ${orgName} for the work at ${job.property}. ` +
      `If you have a minute, we'd really appreciate a quick review — it makes a big difference for a small business: ${reviewUrl}`
    );
  }, [job, customers, org]);

  if (!job) return null;

  const phone = customer?.phone || "";
  const email = customer?.email || "";

  // Persist review_requested_at so we don't re-prompt on the next status
  // change or row re-render. Best-effort patch; we don't block the action.
  const markRequested = async () => {
    try {
      await db.patch("jobs", job.id, { review_requested_at: new Date().toISOString() });
      onSent?.();
    } catch { /* non-critical */ }
  };

  const sendSms = () => {
    if (!phone) {
      useStore.getState().showToast("No phone number on file for this client", "warning");
      return;
    }
    const url = `sms:${phone}?body=${encodeURIComponent(message)}`;
    window.location.href = url;
    markRequested();
    onClose();
  };

  const sendEmail = () => {
    if (!email) {
      useStore.getState().showToast("No email on file for this client", "warning");
      return;
    }
    const subject = encodeURIComponent(`Quick favor from ${org?.name || "us"}`);
    const body = encodeURIComponent(message);
    const url = `mailto:${email}?subject=${subject}&body=${body}`;
    window.location.href = url;
    markRequested();
    onClose();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      useStore.getState().showToast("Review request copied — paste & send", "success");
      markRequested();
    } catch {
      useStore.getState().showToast("Couldn't copy — select the text and copy manually", "error");
    }
    onClose();
  };

  const skip = () => onClose();

  return (
    <div
      onClick={skip}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 199,
        background: "rgba(0,0,0,.55)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "10vh 16px",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 420,
          background: darkMode ? "#12121a" : "#fff",
          border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`,
          borderRadius: 12,
          padding: 18,
          boxShadow: "0 8px 32px rgba(0,0,0,.5)",
        }}
      >
        <div style={{ fontSize: 28, textAlign: "center", marginBottom: 4 }}>⭐</div>
        <h3 style={{ fontSize: 16, color: "var(--color-primary)", textAlign: "center", marginBottom: 4 }}>
          Ask for a Review?
        </h3>
        <p className="dim" style={{ fontSize: 12, textAlign: "center", margin: "0 0 12px" }}>
          {job.client || "Client"} just had work completed at {job.property}. Send them the review link while it&apos;s fresh.
        </p>

        {/* Editable message preview */}
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          style={{
            width: "100%",
            fontSize: 12,
            padding: 8,
            borderRadius: 6,
            border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`,
            background: darkMode ? "#0d0d14" : "#f7f7fa",
            color: "inherit",
            resize: "vertical",
            marginBottom: 12,
          }}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            className="bb"
            onClick={sendSms}
            disabled={!phone}
            style={{ fontSize: 13, padding: "8px 12px", opacity: phone ? 1 : 0.5 }}
            title={phone ? `Text ${phone}` : "No phone number on file"}
          >
            📱 Send via Text {phone ? `(${phone})` : "(no phone on file)"}
          </button>
          <button
            className="bo"
            onClick={sendEmail}
            disabled={!email}
            style={{ fontSize: 13, padding: "8px 12px", opacity: email ? 1 : 0.5 }}
            title={email ? `Email ${email}` : "No email on file"}
          >
            ✉ Send via Email {email ? `(${email})` : "(no email on file)"}
          </button>
          <button
            className="bo"
            onClick={copy}
            style={{ fontSize: 13, padding: "8px 12px" }}
          >
            📋 Copy Message
          </button>
          <button
            onClick={skip}
            style={{
              fontSize: 11,
              padding: "6px",
              background: "none",
              color: darkMode ? "#888" : "#666",
            }}
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
