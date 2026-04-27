"use client";
/**
 * SmsNotifyButtons — three one-tap SMS templates the contractor fires
 * to a customer's phone for a specific job: "On the way", "Running
 * X minutes late", and "Job complete — invoice link". Each tap opens
 * a tiny preview/confirm strip so the message can be tweaked or
 * cancelled before send. Sends via /api/sms (Twilio).
 *
 * The component looks up the customer's phone from the linked Customer
 * entity (job.customer_id). If no phone is on file, the buttons go
 * disabled with an explanatory tooltip — no silent failures.
 */
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";

interface Props {
  jobId: string;
  /** Render in a tighter layout (Schedule's day-detail row, where
   *  vertical space is cramped). */
  compact?: boolean;
}

type TemplateKey = "enroute" | "late" | "complete";

const LATE_OPTIONS = [10, 15, 30, 45] as const;

export default function SmsNotifyButtons({ jobId, compact }: Props) {
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
  const [sending, setSending] = useState(false);

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
    setOpen(k);
  };

  const send = async () => {
    if (!phone || !draft.trim() || !job) return;
    setSending(true);
    try {
      const res = await fetch("/api/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phone, body: draft.trim(), jobId: job.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data?.error || "Couldn't send text", "error");
      } else {
        showToast(`Texted ${greet || "customer"} ✓`, "success");
        setOpen(null);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Network error", "error");
    }
    setSending(false);
  };

  if (!job) return null;

  const btnSize = compact ? { fontSize: 11, padding: "4px 8px" } : { fontSize: 12, padding: "5px 10px" };
  const noPhoneTitle = phone ? undefined : "No phone on file — link a customer with a phone number to enable.";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        <button
          className="bo"
          disabled={!phone}
          title={noPhoneTitle}
          onClick={(e) => { e.stopPropagation(); openTemplate("enroute"); }}
          style={{ ...btnSize, opacity: phone ? 1 : 0.4 }}
        >
          🚗 On the way
        </button>
        <button
          className="bo"
          disabled={!phone}
          title={noPhoneTitle}
          onClick={(e) => { e.stopPropagation(); openTemplate("late"); }}
          style={{ ...btnSize, opacity: phone ? 1 : 0.4 }}
        >
          ⏱ Running late
        </button>
        <button
          className="bo"
          disabled={!phone}
          title={noPhoneTitle}
          onClick={(e) => { e.stopPropagation(); openTemplate("complete"); }}
          style={{ ...btnSize, opacity: phone ? 1 : 0.4 }}
        >
          ✅ Job complete
        </button>
      </div>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "var(--color-card-dark, #12121a)",
            border: "1px solid var(--color-primary)",
            borderRadius: 8,
            padding: 10,
            fontSize: 12,
          }}
        >
          {open === "late" && (
            <div style={{ display: "flex", gap: 4, marginBottom: 8, alignItems: "center" }}>
              <span className="dim" style={{ fontSize: 11, marginRight: 4 }}>How late?</span>
              {LATE_OPTIONS.map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setLateMinutes(m);
                    setDraft(buildTemplate("late", m));
                  }}
                  style={{
                    padding: "3px 8px",
                    borderRadius: 4,
                    fontSize: 11,
                    background: lateMinutes === m ? "var(--color-primary)" : "transparent",
                    color: lateMinutes === m ? "#fff" : "#888",
                    border: `1px solid ${lateMinutes === m ? "var(--color-primary)" : "#444"}`,
                    cursor: "pointer",
                  }}
                >
                  {m} min
                </button>
              ))}
            </div>
          )}
          <div className="dim" style={{ fontSize: 10, marginBottom: 4 }}>
            To {phone} · edit before sending if needed
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            style={{
              width: "100%",
              fontSize: 12,
              padding: 8,
              borderRadius: 6,
              border: "1px solid #1e1e2e",
              background: "var(--color-dark-bg, #0a0a0f)",
              color: "inherit",
              resize: "vertical",
              fontFamily: "Source Sans 3, sans-serif",
            }}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button
              className="bg"
              onClick={send}
              disabled={sending || !draft.trim()}
              style={{ fontSize: 12, padding: "5px 12px" }}
            >
              {sending ? "Sending…" : "📱 Send"}
            </button>
            <button
              className="bo"
              onClick={() => setOpen(null)}
              disabled={sending}
              style={{ fontSize: 12, padding: "5px 12px" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
