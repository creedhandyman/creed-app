"use client";
/**
 * The customer page's "Email & referrals" card. Shows nothing unless the
 * business turned on email campaigns or customer referrals. Data comes from
 * /api/customers/marketing.
 */
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { fmtCents, REFERRAL_STATUS_LABEL, type ReferralStatus } from "@/lib/referrals";
import { Icon } from "./Icon";

interface Data {
  unsubscribed_at: string | null;
  campaigns_received: number;
  referrals_enabled: boolean;
  link: string | null;
  referrals: { id: string; status: ReferralStatus; reward_cents: number | null; referred_name: string }[];
  credit_cents: number;
  referred_by: { id: string; name: string } | null;
}

export default function CustomerMarketingCard({ customerId, hasEmail }: { customerId: string; hasEmail: boolean }) {
  const org = useStore((s) => s.org);
  const on = org?.campaigns_enabled === true || org?.referrals_enabled === true;
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!on) return;
    let live = true;
    apiFetch(`/api/customers/marketing?id=${encodeURIComponent(customerId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Data | null) => { if (live) setD(j); })
      .catch(() => { /* offline: show nothing */ });
    return () => { live = false; };
  }, [customerId, on]);

  if (!on || !d) return null;

  const dontEmail = async () => {
    const ok = await useStore.getState().showConfirm(
      "Stop marketing email",
      "This customer won't get any more campaign emails. Quotes, invoices and job messages still go out. This can't be undone from the app.",
      { confirmLabel: "Don't email", danger: true },
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await apiFetch("/api/customers/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: customerId, action: "dont_email" }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) setD({ ...d, unsubscribed_at: j.unsubscribed_at || new Date().toISOString() });
      else useStore.getState().showToast(j.error || "Couldn't update", "error");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!d.link) return;
    try { await navigator.clipboard.writeText(d.link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* */ }
  };

  return (
    <div className="cd mb">
      <h4 style={{ fontSize: 15, margin: "0 0 8px", display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="mail" size={15} color="var(--color-primary)" />
        Email &amp; referrals
      </h4>

      {org?.campaigns_enabled && (
        <div style={{ fontSize: 14, marginBottom: 8 }}>
          {!hasEmail
            ? <span className="dim">No email on file, so no campaigns.</span>
            : d.unsubscribed_at
              ? <span>Unsubscribed {new Date(d.unsubscribed_at).toLocaleDateString()}. Gets no campaign emails.</span>
              : <span>Gets campaign emails{d.campaigns_received ? ` · ${d.campaigns_received} received` : ""}.</span>}
          {hasEmail && !d.unsubscribed_at && (
            <button className="bo" disabled={busy} onClick={dontEmail} style={{ fontSize: 12, padding: "3px 10px", width: "auto", marginLeft: 8 }}>
              Don&apos;t email
            </button>
          )}
        </div>
      )}

      {d.referrals_enabled && (
        <>
          {d.referred_by && <div className="dim" style={{ fontSize: 13.5, marginBottom: 6 }}>Referred by {d.referred_by.name}</div>}
          {d.link ? (
            <div className="row" style={{ gap: 6, alignItems: "center" }}>
              <input readOnly value={d.link} style={{ flex: 1, fontSize: 13 }} onFocus={(e) => e.currentTarget.select()} />
              <button className="bo" onClick={copy} style={{ fontSize: 12, padding: "4px 10px", width: "auto", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
          ) : (
            <div className="dim" style={{ fontSize: 13.5 }}>Publish your site in Branding to give customers a referral link.</div>
          )}
          {d.credit_cents > 0 && (
            <div style={{ fontSize: 14, marginTop: 8, color: "var(--color-success)" }}>
              {fmtCents(d.credit_cents)} credit to use on their next quote
            </div>
          )}
          {d.referrals.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {d.referrals.map((r) => (
                <div key={r.id} className="row" style={{ justifyContent: "space-between", fontSize: 13.5, padding: "3px 0" }}>
                  <span>{r.referred_name}</span>
                  <span className="dim">{REFERRAL_STATUS_LABEL[r.status]}{r.reward_cents && r.status !== "pending" ? ` · ${fmtCents(r.reward_cents)}` : ""}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
