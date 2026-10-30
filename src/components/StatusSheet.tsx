"use client";
import { useEffect } from "react";
import { statusColor } from "@/lib/status";
import { useBackLayer } from "@/lib/back-layer";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";

/** The manual job-status picker: every status in its pipeline color with a
 *  one-line meaning, the current one marked. Replaces the phone's plain
 *  dropdown on the job detail header and the bulk bar. Picking only reports the
 *  choice — the caller owns the rules (paid-with-balance sheet, unchecked
 *  work-order confirm, bulk Apply). */
export const JOB_STATUSES = ["lead", "quoted", "accepted", "scheduled", "active", "complete", "invoiced", "paid"] as const;

export function statusLabel(s: string): string {
  return s === "lead" ? t("jobs.lead") : (t(`status.${s}`) || s);
}

export default function StatusSheet({
  open, current, title, onPick, onClose,
}: {
  open: boolean;
  current?: string;
  title?: string;
  onPick: (status: string) => void;
  onClose: () => void;
}) {
  // Phone back closes the sheet instead of leaving the job.
  useBackLayer(open, onClose);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        className="cd sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title || t("jobs.chooseStatus")}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 420, paddingTop: 20 }}
      >
        <h3 style={{ fontFamily: "Oswald", fontSize: 19, textTransform: "uppercase", marginBottom: 10 }}>
          {title || t("jobs.chooseStatus")}
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {JOB_STATUSES.map((st) => {
            const color = statusColor(st);
            const on = st === current;
            return (
              <button
                key={st}
                type="button"
                onClick={() => onPick(st)}
                aria-current={on ? "true" : undefined}
                style={{
                  display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
                  padding: "10px 12px", borderRadius: 12, cursor: "pointer", color: "inherit",
                  background: on ? color + "22" : "transparent",
                  border: `1px solid ${on ? color + "88" : "var(--color-border, rgba(128,128,128,.25))"}`,
                }}
              >
                <span aria-hidden style={{ width: 12, height: 12, borderRadius: 99, background: color, flexShrink: 0, boxShadow: `0 0 8px ${color}66` }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: "Oswald", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", color }}>
                    {statusLabel(st)}
                  </span>
                  <span className="dim" style={{ display: "block", fontSize: 12.5 }}>{t(`jobs.statusHint.${st}`)}</span>
                </span>
                {on && <Icon name="check" size={16} color={color} />}
              </button>
            );
          })}
        </div>
        <button className="bo" type="button" onClick={onClose} style={{ marginTop: 12, width: "100%" }}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
