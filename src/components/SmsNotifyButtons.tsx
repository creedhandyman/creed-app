"use client";
/**
 * SmsNotifyButtons — three one-tap text templates the contractor fires to a
 * customer for a specific job: "On the way", "Running late", and "Job done"
 * (with a view/pay link). Each tap opens a small confirm strip where the
 * message can be tweaked, then sends via the phone's NATIVE Messages app
 * (an `sms:` deep link prefilled with the number + body).
 *
 * Why native instead of server Twilio: a solo handyman rarely has Twilio +
 * A2P 10DLC carrier registration set up, so the old /api/sms path mostly
 * errored out ("SMS not configured" / carrier-filtered). A native sms: link
 * always works on a phone, costs nothing, and — crucially — sends from the
 * contractor's own number, so the customer's reply comes straight back to
 * them. A "Copy" button is the desktop fallback (no SMS handler there).
 *
 * The customer's phone comes from the linked Customer (job.customer_id). With
 * no phone on file the buttons disable with an explanatory tooltip.
 */
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Icon } from "./Icon";

interface Props {
  jobId: string;
  /** Tighter sizing for cramped rows (Schedule's day-detail). */
  compact?: boolean;
  /** "grid" adds a "Notify customer" section label above the buttons (used in
   *  the Jobs detail view); "row" (default) is the bare button row. */
  variant?: "row" | "grid";
}

type TemplateKey = "enroute" | "late" | "complete";

const LATE_OPTIONS = [10, 15, 30, 45] as const;

const ACTIONS = [
  { key: "enroute", label: "On the way", icon: "navigation", hue: "var(--color-primary)" },
  { key: "late", label: "Running late", icon: "time", hue: "var(--color-warning)" },
  { key: "complete", label: "Job done", icon: "checkCircle", hue: "var(--color-success)" },
] as const;

export default function SmsNotifyButtons({ jobId, compact, variant = "row" }: Props) {
  const job = useStore((s) => s.jobs.find((j) => j.id === jobId));
  const customers = useStore((s) => s.customers);
  const org = useStore((s) => s.org);
  const showToast = useStore((s) => s.showToast);

  const customer = job?.customer_id ? customers.find((c) => c.id === job.customer_id) : undefined;
  const phone = customer?.phone || "";
  const orgName = org?.name || "us";

  const [open, setOpen] = useState<TemplateKey | null>(null);
  const [lateMinutes, setLateMinutes] = useState<number>(15);
  const [draft, setDraft] = useState("");

  const statusUrl = useMemo(() => {
    if (typeof window === "undefined" || !job) return "";
    return `${window.location.origin}/status?job=${job.id}`;
  }, [job]);

  const greet = (job?.client || customer?.name || "").split(/\s+/)[0] || "";
  const helloLine = greet ? `Hi ${greet}! ` : "";

  const buildTemplate = (kind: TemplateKey, minutes: number): string => {
    if (!job) return "";
    if (kind === "enroute") {
      return (
        `${helloLine}This is ${orgName} — we're on our way to ${job.property}. ` +
        `Track your job: ${statusUrl}`
      );
    }
    if (kind === "late") {
      return (
        `${helloLine}Quick heads-up from ${orgName} — we're running about ` +
        `${minutes} minutes late to ${job.property}. Thanks for your patience!`
      );
    }
    return (
      `${helloLine}Work at ${job.property} is complete. ` +
      `Total: $${(job.total || 0).toFixed(2)}. View & pay: ${statusUrl}`
    );
  };

  const openTemplate = (k: TemplateKey) => {
    if (!phone) {
      showToast("No phone on file for this customer", "warning");
      return;
    }
    setDraft(buildTemplate(k, lateMinutes));
    setOpen((cur) => (cur === k ? null : k));
  };

  // sms: deep link. "?&body=" is the form that prefills the body on BOTH iOS
  // and Android. Number is stripped to digits/+ so punctuation can't break it.
  const smsHref = (text: string) => `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(text)}`;

  const copyMsg = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      showToast("Message copied — paste it into your texts", "success");
    } catch {
      showToast("Couldn't copy on this device", "error");
    }
  };

  if (!job) return null;

  const noPhoneTitle = phone
    ? undefined
    : "No phone on file — link a customer with a phone number to enable.";

  const renderTrigger = (a: (typeof ACTIONS)[number]) => {
    const active = open === a.key;
    return (
      <button
        key={a.key}
        type="button"
        disabled={!phone}
        title={noPhoneTitle}
        onClick={(e) => {
          e.stopPropagation();
          openTemplate(a.key);
        }}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          padding: compact ? "7px 4px" : "9px 5px",
          borderRadius: 11,
          background: active ? a.hue + "22" : "var(--color-card-dark-2)",
          border: `1px solid ${active ? a.hue : "var(--color-border-dark-2)"}`,
          color: "inherit",
          opacity: phone ? 1 : 0.45,
          cursor: phone ? "pointer" : "not-allowed",
        }}
      >
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            background: a.hue + "22",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={a.icon} size={15} color={a.hue} />
        </span>
        <span
          style={{
            fontFamily: "Oswald",
            fontSize: compact ? 10.5 : 11.5,
            fontWeight: 600,
            letterSpacing: ".02em",
            textAlign: "center",
            lineHeight: 1.15,
          }}
        >
          {a.label}
        </span>
      </button>
    );
  };

  const popup = open ? (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: "var(--color-card-dark)",
        border: "1px solid var(--color-border-dark-2)",
        borderRadius: 12,
        padding: 11,
      }}
    >
      {open === "late" && (
        <div style={{ display: "flex", gap: 5, marginBottom: 9, alignItems: "center", flexWrap: "wrap" }}>
          <span className="dim" style={{ fontSize: 12.5, marginRight: 2 }}>How late?</span>
          {LATE_OPTIONS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setLateMinutes(m);
                setDraft(buildTemplate("late", m));
              }}
              style={{
                padding: "3px 10px",
                borderRadius: 99,
                fontSize: 12.5,
                fontFamily: "Oswald",
                background: lateMinutes === m ? "var(--color-warning)" : "transparent",
                color: lateMinutes === m ? "#1a1a1a" : "var(--color-dim)",
                border: `1px solid ${lateMinutes === m ? "var(--color-warning)" : "var(--color-border-dark-2)"}`,
                cursor: "pointer",
              }}
            >
              {m}m
            </button>
          ))}
        </div>
      )}
      <div className="dim" style={{ fontSize: 12, marginBottom: 5 }}>
        To {phone} · edit before sending if needed
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        style={{
          width: "100%",
          fontSize: 14,
          padding: 9,
          borderRadius: 9,
          border: "1px solid var(--color-border-dark-2)",
          background: "var(--color-dark-bg)",
          color: "inherit",
          resize: "vertical",
          fontFamily: "Source Sans 3, sans-serif",
        }}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <a
          href={smsHref(draft)}
          onClick={() => setOpen(null)}
          className="bb"
          style={{
            flex: 1,
            textAlign: "center",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            fontSize: 14,
          }}
        >
          <Icon name="send" size={15} color="#fff" /> Open Messages
        </a>
        <button type="button" className="bo" onClick={copyMsg} style={{ fontSize: 14 }}>
          Copy
        </button>
        <button
          type="button"
          className="bo"
          onClick={() => setOpen(null)}
          aria-label="Cancel"
          style={{ fontSize: 14, padding: "0 11px" }}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="dim" style={{ fontSize: 11.5, marginTop: 7, lineHeight: 1.4 }}>
        Opens your phone&apos;s Messages with the text ready — it sends from your number, so replies come to you.
      </div>
    </div>
  ) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {variant === "grid" && (
        <div className="seclabel" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="bell" size={13} /> Notify customer
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>{ACTIONS.map(renderTrigger)}</div>
      {popup}
    </div>
  );
}
