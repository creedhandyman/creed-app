"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { t } from "@/lib/i18n";
import { prettyPhone } from "@/lib/sms-inbound";
import { fmtWhen } from "@/lib/texts-client";
import { Icon } from "./Icon";

/**
 * The Texts card on a job page and a customer page (build 3 of "receiving
 * Twilio replies"): the conversations on the business number that touch this
 * job or customer, newest first. Tap one to open it on the Texts screen (from
 * a job: just the texts on that job). Shows nothing while texting is off or
 * when there are no texts, so pages without any stay as they were.
 */

const COLOR = "#38bdf8";

interface Row {
  phone: string;
  lastAt: string;
  lastDirection: "in" | "out";
  preview: string;
  unread: number;
  name: string;
  optedOut: boolean;
}

export default function TextsCard({
  jobId,
  customerId,
  variant,
  onOpen,
}: {
  jobId?: string;
  customerId?: string;
  /** "section": a job page section; "card": a customer page card. */
  variant: "section" | "card";
  onOpen: (target: { phone: string; onJob?: string }) => void;
}) {
  const texting = useStore((s) => s.org?.auto_sms_enroute === true);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!texting || (!jobId && !customerId)) {
      setRows([]);
      return;
    }
    let live = true;
    const q = jobId ? `forJob=${encodeURIComponent(jobId)}` : `forCustomer=${encodeURIComponent(customerId as string)}`;
    apiFetch(`/api/sms/threads?${q}`)
      .then((r) => (r.ok ? r.json() : { threads: [] }))
      .then((j: { threads?: Row[] }) => {
        if (live) setRows(j.threads || []);
      })
      .catch(() => {
        /* offline: show nothing */
      });
    return () => {
      live = false;
    };
  }, [texting, jobId, customerId]);

  if (!rows.length) return null;

  const list = rows.map((r) => (
    <div
      key={r.phone}
      className="linkrow"
      onClick={() => onOpen({ phone: r.phone, onJob: jobId })}
      style={{ cursor: "pointer" }}
    >
      <span className="lf" style={{ flex: 1, minWidth: 0, alignItems: "center" }}>
        <span className="ic" style={{ color: COLOR }}><Icon name="texts" size={15} /></span>
        <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ fontWeight: r.unread ? 700 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.name || prettyPhone(r.phone)}
            <span className="dim" style={{ fontWeight: 400, fontSize: 12.5 }}> · {fmtWhen(r.lastAt)}</span>
          </span>
          <span className="dim" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.lastDirection === "out" ? `${t("texts.you")}: ` : ""}{r.preview || t("texts.photo")}
          </span>
        </span>
      </span>
      {r.optedOut && <span style={{ fontSize: 11.5, color: "var(--color-warning)", fontWeight: 600 }}>STOP</span>}
      {r.unread > 0 && (
        <span style={{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: COLOR, color: "#04131c", fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {r.unread > 9 ? "9+" : r.unread}
        </span>
      )}
      <Icon name="next" size={15} style={{ color: "var(--color-dim)", flexShrink: 0 }} />
    </div>
  ));

  if (variant === "section") {
    return (
      <div className="section">
        <div className="seclabel"><Icon name="texts" size={13} /> {t("nav.texts")}</div>
        {list}
      </div>
    );
  }
  return (
    <div className="cd mb">
      <h4 style={{ fontSize: 15, margin: "0 0 6px", display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="texts" size={15} color={COLOR} />
        {t("nav.texts")} ({rows.length})
      </h4>
      {list}
    </div>
  );
}
