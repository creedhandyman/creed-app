"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { db, supabase } from "@/lib/supabase";
import { residentContact } from "@/lib/resident";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";
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
    // Greet the RESIDENT when one is on file (PM jobs) — same preference
    // the automated cron uses (lib/resident.ts).
    const resident = residentContact(job.rooms);
    const firstName = (resident.name || job.client || c?.name || "").split(/\s+/)[0] || "";

    setMessage(
      `Hi${firstName ? ` ${firstName}` : ""}! Thanks for choosing ${orgName} for the work at ${job.property}. ` +
      `If you have a minute, we'd really appreciate a quick review — it makes a big difference for a small business: ${reviewUrl}`
    );
  }, [job, customers, org]);

  if (!job) return null;

  // Resident contact beats the paying customer's — a PM's number here
  // would ask the same manager for a review after every work order.
  const resident = residentContact(job.rooms);
  const phone = resident.phone || customer?.phone || "";
  const email = resident.email || customer?.email || "";

  // Persist review_requested_at so we don't re-prompt on the next status
  // change or row re-render. Best-effort patch; we don't block the action.
  // Also cancel any pending automated review-request row for this job —
  // the user just sent the message manually, so the cron shouldn't
  // double-ping the customer an hour later.
  const markRequested = async () => {
    try {
      await db.patch("jobs", job.id, { review_requested_at: new Date().toISOString() });
      // Cancel pending automated request, if any. Direct supabase update
      // (not db.patch) because we filter by job_id + status, not by id.
      // Best-effort — failure here just means the cron may still fire,
      // which is a soft duplicate, not a data integrity issue.
      try {
        await supabase
          .from("review_requests")
          .update({ status: "cancelled" })
          .eq("job_id", job.id)
          .eq("status", "scheduled");
      } catch { /* non-critical */ }
      onSent?.();
    } catch { /* non-critical */ }
  };

  const sendSms = () => {
    if (!phone) {
      useStore.getState().showToast(t("review.noPhone"), "warning");
      return;
    }
    // Digits-only + "?&body=" — the form that pre-fills on both iOS and
    // Android (same as SendSheet and the Jobs send strip).
    const url = `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(message)}`;
    window.location.href = url;
    markRequested();
    onClose();
  };

  const sendEmail = () => {
    if (!email) {
      useStore.getState().showToast(t("review.noEmail"), "warning");
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
      useStore.getState().showToast(t("review.copied"), "success");
      markRequested();
    } catch {
      useStore.getState().showToast(t("review.copyFailed"), "error");
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
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>
          <Icon name="star" size={28} color="var(--color-highlight)" />
        </div>
        <h3 style={{ fontSize: 18, color: "var(--color-primary)", textAlign: "center", marginBottom: 4 }}>
          {t("review.askTitle")}
        </h3>
        <p className="dim" style={{ fontSize: 14, textAlign: "center", margin: "0 0 12px" }}>
          {/* Name whoever actually gets the text — the resident on PM jobs. */}
          {t("review.askSub").replace("{client}", resident.name || job.client || customer?.name || t("quest.client"))}
        </p>

        {/* Editable message preview */}
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          style={{
            width: "100%",
            fontSize: 14,
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
            style={{ fontSize: 15, padding: "8px 12px", opacity: phone ? 1 : 0.5, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}
            title={phone || t("review.noPhone")}
          >
            <Icon name="send" size={15} /> {t("review.viaText")}{phone ? ` (${phone})` : ""}
          </button>
          {!phone && <div className="dim" style={{ fontSize: 12, textAlign: "center", marginTop: -2 }}>{t("review.noPhone")}</div>}
          <button
            className="bo"
            onClick={sendEmail}
            disabled={!email}
            style={{ fontSize: 15, padding: "8px 12px", opacity: email ? 1 : 0.5, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}
            title={email || t("review.noEmail")}
          >
            <Icon name="mail" size={15} /> {t("review.viaEmail")}{email ? ` (${email})` : ""}
          </button>
          {!email && <div className="dim" style={{ fontSize: 12, textAlign: "center", marginTop: -2 }}>{t("review.noEmail")}</div>}
          <button
            className="bo"
            onClick={copy}
            style={{ fontSize: 15, padding: "8px 12px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}
          >
            <Icon name="doc" size={15} /> {t("review.copyMsg")}
          </button>
          <button
            onClick={skip}
            style={{
              fontSize: 13,
              padding: "6px",
              background: "none",
              color: darkMode ? "#888" : "#666",
            }}
          >
            {t("review.maybeLater")}
          </button>
        </div>
      </div>
    </div>
  );
}
