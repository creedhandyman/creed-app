"use client";
/**
 * "Automatic texts" on the customer page: may Creed's own number text this
 * customer automatically (visit reminders, review requests, quote follow-ups,
 * invoice reminders)? Shows the answer on file — when and how it was given —
 * and lets an owner/manager record a yes the customer gave in person / on a
 * call, or turn automatic texts off. The rule is lib/sms-consent.ts
 * `autoTextConsent` (the same one the senders ask). Hand-sent texts (the
 * phone's own Messages app) don't use any of this.
 */
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import {
  autoTextConsent, customerSmsConsentOf, nextCustomerSmsConsent, CONSENT_METHODS,
  type ConsentMethod, type SmsConsentEntry,
} from "@/lib/sms-consent";
import type { Customer, Job } from "@/lib/types";
import { Icon } from "./Icon";

const fmtWhen = (at: string | undefined) => {
  const d = at ? new Date(at) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "";
};

/** "Website quote form · Nov 12, 2026" / "Told me in person · by Bernard · …" */
export function describeConsent(e: SmsConsentEntry): string {
  const how = e.method ? t(`consent.method.${e.method}`) : e.source;
  return [how, e.by ? t("consent.by").replace("{name}", e.by) : "", fmtWhen(e.at)].filter(Boolean).join(" · ");
}

export default function TextConsentCard({ customer, jobs }: { customer: Customer; jobs: Job[] }) {
  const user = useStore((s) => s.user);
  const loadAll = useStore((s) => s.loadAll);
  const showConfirm = useStore((s) => s.showConfirm);
  const showToast = useStore((s) => s.showToast);
  const canEdit = user?.role === "owner" || user?.role === "manager";

  const status = useMemo(() => autoTextConsent(customer, ...jobs.map((j) => j.rooms)), [customer, jobs]);
  const onFile = customerSmsConsentOf(customer.sms_consent);
  const history = onFile ? [onFile, ...(onFile.history || [])] : [];
  // The answer on file was for a number the customer no longer has.
  const digits = (customer.phone || "").replace(/\D/g, "").slice(-10);
  const otherNumber = !!onFile?.phone && digits.length === 10 && onFile.phone !== digits;

  const [sheet, setSheet] = useState(false);
  const [method, setMethod] = useState<ConsentMethod>("in_person");
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const save = async (entry: SmsConsentEntry): Promise<boolean> => {
    const next = nextCustomerSmsConsent(customer.sms_consent, entry, "set");
    if (!next) return false;
    setBusy(true);
    const ok = await db.patch("customers", customer.id, { sms_consent: next });
    setBusy(false);
    if (ok) await loadAll();
    return ok;
  };

  const recordYes = async () => {
    const ok = await save({
      granted: true,
      at: new Date().toISOString(),
      source: "recorded by owner",
      by: user?.name || "",
      method,
      phone: customer.phone || undefined,
    });
    if (ok) { setSheet(false); showToast(t("consent.savedYes"), "success"); }
  };

  const turnOff = async () => {
    if (!(await showConfirm(t("consent.offTitle"), t("consent.offBody")))) return;
    const ok = await save({
      granted: false,
      at: new Date().toISOString(),
      source: "turned off by owner",
      by: user?.name || "",
      phone: customer.phone || undefined,
    });
    if (ok) showToast(t("consent.savedOff"), "success");
  };

  const color = status.ok ? "var(--color-success)" : status.record ? "var(--color-accent-red)" : "var(--color-dim)";
  const pill = status.ok ? t("consent.on") : status.record ? t("consent.off") : t("consent.notAsked");

  return (
    <div className="cd mb">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <h4 style={{ fontSize: 15, margin: 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="texts" size={15} color="var(--color-primary)" /> {t("consent.title")}
        </h4>
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color, border: `1px solid ${color}`, borderRadius: 99, padding: "2px 9px", flexShrink: 0 }}>
          {pill}
        </span>
      </div>

      {status.record && (
        <div style={{ fontSize: 14, marginBottom: 6 }}>
          {status.via === "job" && <span className="dim">{t("consent.fromJob")} </span>}
          {describeConsent(status.record)}
        </div>
      )}
      {otherNumber && status.via !== "job" && (
        <div style={{ fontSize: 14, marginBottom: 6, color: "var(--color-warning)" }}>{t("consent.otherNumber")}</div>
      )}

      <p className="dim" style={{ fontSize: 13, margin: "0 0 10px", lineHeight: 1.45 }}>{t("consent.explain")}</p>

      {canEdit && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {!status.ok ? (
            <button className="bb" disabled={busy || !customer.phone} onClick={() => setSheet(true)} style={{ fontSize: 14, padding: "6px 12px", width: "auto" }}>
              <Icon name="check" size={14} /> {t("consent.recordYes")}
            </button>
          ) : (
            <button className="bo" disabled={busy} onClick={turnOff} style={{ fontSize: 14, padding: "6px 12px", width: "auto" }}>
              <Icon name="stop" size={14} /> {t("consent.turnOff")}
            </button>
          )}
          {history.length > 0 && (
            <button className="bo" onClick={() => setShowHistory((v) => !v)} style={{ fontSize: 14, padding: "6px 12px", width: "auto" }}>
              {t("consent.history").replace("{n}", String(history.length))}
            </button>
          )}
        </div>
      )}
      {canEdit && !customer.phone && !status.ok && (
        <div className="dim" style={{ fontSize: 12.5, marginTop: 6 }}>{t("consent.needPhone")}</div>
      )}

      {showHistory && (
        <div style={{ marginTop: 10 }}>
          {history.map((h, i) => (
            <div key={i} style={{ fontSize: 13, padding: "6px 0", borderTop: "1px solid var(--color-border-dark)", display: "flex", gap: 8 }}>
              <span style={{ color: h.granted ? "var(--color-success)" : "var(--color-accent-red)", fontWeight: 700, flexShrink: 0 }}>
                {h.granted ? t("consent.yes") : t("consent.no")}
              </span>
              <span style={{ minWidth: 0 }}>
                {describeConsent(h)}
                {h.text && <span className="dim" style={{ display: "block", fontSize: 12, marginTop: 2 }}>“{h.text}”</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {sheet && (
        <div className="sheet-overlay" onClick={() => !busy && setSheet(false)}>
          <div className="cd sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, paddingTop: 20 }}>
            <h3 style={{ fontFamily: "Oswald", fontSize: 19, textTransform: "uppercase", marginBottom: 6 }}>{t("consent.sheetTitle")}</h3>
            <p className="dim" style={{ fontSize: 14, margin: "0 0 12px", lineHeight: 1.45 }}>
              {t("consent.sheetBody").replace("{name}", customer.name).replace("{phone}", customer.phone || "")}
            </p>
            <label className="sl">{t("consent.howLabel")}</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, margin: "4px 0 16px" }}>
              {CONSENT_METHODS.map((m) => (
                <button key={m} type="button" className={method === m ? "bb" : "bo"} onClick={() => setMethod(m)} style={{ fontSize: 14, padding: "9px 6px" }}>
                  {t(`consent.method.${m}`)}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="bo" disabled={busy} onClick={() => setSheet(false)} style={{ flex: 1 }}>{t("consent.cancel")}</button>
              <button className="bg" disabled={busy} onClick={recordYes} style={{ flex: 1 }}>{busy ? "…" : t("consent.save")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
