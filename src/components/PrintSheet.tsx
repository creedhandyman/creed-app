"use client";
import { useEffect } from "react";
import { useBackLayer } from "@/lib/back-layer";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";

/** The job view's Print button: which PDF — the customer-facing Quote or the
 *  Invoice. The one that fits the job's stage is listed first and tagged
 *  "Suggested" (quotes up to the work, the invoice once it's done). Picking only
 *  reports the choice; the caller builds the PDF. */
const INVOICE_STAGES = ["complete", "invoiced", "paid"];

export default function PrintSheet({
  open, status, hasQuote, onQuote, onInvoice, onClose,
}: {
  open: boolean;
  status?: string;
  /** The job has quote lines to print (a bare lead doesn't). */
  hasQuote: boolean;
  onQuote: () => void;
  onInvoice: () => void;
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
  const invoiceFirst = INVOICE_STAGES.includes(status || "") || !hasQuote;
  const options = [
    { key: "quote", icon: "doc", label: t("jobs.quotePdf"), sub: hasQuote ? t("jobs.quotePdfSub") : t("jobs.printNoQuote"), enabled: hasQuote, run: onQuote },
    { key: "invoice", icon: "receipt", label: t("jobs.invoicePdf"), sub: t("jobs.invoicePdfSub"), enabled: true, run: onInvoice },
  ];
  if (invoiceFirst) options.reverse();
  const suggested = invoiceFirst ? "invoice" : "quote";

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        className="cd sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t("common.print")}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 420, paddingTop: 20 }}
      >
        <h3 style={{ fontFamily: "Oswald", fontSize: 19, textTransform: "uppercase", marginBottom: 10 }}>
          {t("common.print")}
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              disabled={!o.enabled}
              onClick={() => o.run()}
              style={{
                display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
                padding: "12px 14px", borderRadius: 12, color: "inherit",
                cursor: o.enabled ? "pointer" : "not-allowed", opacity: o.enabled ? 1 : 0.5,
                background: "transparent",
                border: `1px solid ${o.key === suggested && o.enabled ? "var(--color-primary)" : "var(--color-border, rgba(128,128,128,.25))"}`,
              }}
            >
              <Icon name={o.icon} size={20} color="var(--color-primary)" />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontFamily: "Oswald", fontSize: 16, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>
                  {o.label}
                  {o.key === suggested && o.enabled && (
                    <span className="dim" style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 500, letterSpacing: ".08em" }}>{t("jobs.printSuggested")}</span>
                  )}
                </span>
                <span className="dim" style={{ display: "block", fontSize: 12.5 }}>{o.sub}</span>
              </span>
            </button>
          ))}
        </div>
        <button className="bo" type="button" onClick={onClose} style={{ marginTop: 12, width: "100%" }}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
