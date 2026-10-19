"use client";
import { MAX_BIDS, subsSummary } from "@/lib/flip";
import type { FlipBid, FlipPermitStatus, FlipSub } from "@/lib/types";
import { t } from "@/lib/i18n";
import { Icon } from "../Icon";

/* Flip Mode — subcontracted trades on one flip (persisted on
   flip_projects.subs, JSONB). Per trade: its permit and up to 3 bids; picking
   a bid hires that sub, and what's been paid to them counts as real rehab
   spend on the dashboard (subsSummary in src/lib/flip.ts). */

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const numVal = (v: string) => (v === "" ? undefined : Number(v));

const TRADES = ["Roofing", "Electrical", "Plumbing", "HVAC", "Foundation", "Windows", "Siding", "Flooring", "Drywall", "Painting", "Concrete", "Cabinets & counters"];
const PERMITS: FlipPermitStatus[] = ["none", "needed", "applied", "issued", "final"];
const PERMIT_C: Record<FlipPermitStatus, string> = {
  none: "var(--color-dim)",
  needed: "var(--color-accent-red)",
  applied: "var(--flip-gold)",
  issued: "var(--flip-gold)",
  final: "var(--color-money)",
};

export default function FlipSubs({ subs, onChange }: { subs: FlipSub[] | null | undefined; onChange: (next: FlipSub[]) => void }) {
  const list = subs || [];
  const sum = subsSummary(list);

  const setSub = (id: string, patch: Partial<FlipSub>) => onChange(list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const setBid = (sub: FlipSub, bidId: string, patch: Partial<FlipBid>) =>
    setSub(sub.id, { bids: sub.bids.map((b) => (b.id === bidId ? { ...b, ...patch } : b)) });
  // One hire per trade: picking a bid un-picks the others; tapping the hired one un-hires it.
  const pick = (sub: FlipSub, bidId: string) =>
    setSub(sub.id, { bids: sub.bids.map((b) => ({ ...b, picked: b.id === bidId ? !b.picked : false })) });

  return (
    <div className="section">
      <div className="seclabel"><Icon name="worker" size={14} /> {t("flip.subs")}</div>

      {list.length === 0 && <div className="dim" style={{ fontSize: 13, padding: "6px 0 4px" }}>{t("flip.subsEmpty")}</div>}

      {list.map((s, si) => {
        const permit = s.permit?.status || "none";
        return (
          <div key={s.id} style={{ padding: "10px 0 8px", borderTop: si ? "1px solid var(--color-border-dark-2)" : undefined }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                value={s.trade}
                onChange={(e) => setSub(s.id, { trade: e.target.value })}
                placeholder={t("flip.tradePh")}
                list="flip-trades"
                style={{ flex: 1, minWidth: 0, fontWeight: 600 }}
              />
              <button
                className="iconbtn"
                aria-label={t("flip.removeTrade")}
                onClick={() => onChange(list.filter((x) => x.id !== s.id))}
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            {/* Permit */}
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
              <Icon name="doc" size={15} color={PERMIT_C[permit]} />
              <select
                value={permit}
                onChange={(e) => setSub(s.id, { permit: { ...s.permit, status: e.target.value as FlipPermitStatus } })}
                aria-label={t("flip.permit")}
                style={{ flex: 1, minWidth: 0, fontSize: 14, padding: "6px 8px", color: PERMIT_C[permit] }}
              >
                {PERMITS.map((p) => <option key={p} value={p}>{t(`flip.permit_${p}`)}</option>)}
              </select>
              {["applied", "issued", "final"].includes(permit) && (
                <input
                  value={s.permit?.number || ""}
                  onChange={(e) => setSub(s.id, { permit: { status: permit, number: e.target.value } })}
                  placeholder={t("flip.permitNoPh")}
                  style={{ width: 120, flex: "none", fontSize: 14, padding: "6px 8px" }}
                />
              )}
            </div>

            {/* Bids */}
            {s.bids.map((b) => (
              <div key={b.id} style={{ marginTop: 8, padding: 8, borderRadius: 10, border: `1px solid ${b.picked ? "var(--color-money)" : "var(--color-border-dark-2)"}`, background: b.picked ? "rgba(0,230,118,.06)" : undefined }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    value={b.company || ""}
                    onChange={(e) => setBid(s, b.id, { company: e.target.value })}
                    placeholder={t("flip.bidCompanyPh")}
                    style={{ flex: 1, minWidth: 0, fontSize: 14, padding: "6px 8px" }}
                  />
                  <button
                    onClick={() => setSub(s.id, { bids: s.bids.filter((x) => x.id !== b.id) })}
                    aria-label={t("flip.removeBid")}
                    style={{ background: "none", color: "var(--color-dim)", padding: 4, flex: "none" }}
                  >
                    <Icon name="delete" size={14} />
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 6, marginTop: 6, alignItems: "stretch" }}>
                  <label className="ipill">
                    <span>{t("flip.bidAmount")}</span>
                    <div className="ipv"><i>$</i><input type="number" inputMode="decimal" min={0} value={b.amount ?? ""} onChange={(e) => setBid(s, b.id, { amount: numVal(e.target.value) })} /></div>
                  </label>
                  {b.picked || (b.paid ?? 0) > 0 ? (
                    <label className="ipill">
                      <span>{t("flip.paidSoFar")}</span>
                      <div className="ipv"><i>$</i><input type="number" inputMode="decimal" min={0} value={b.paid ?? ""} onChange={(e) => setBid(s, b.id, { paid: numVal(e.target.value) })} /></div>
                    </label>
                  ) : (
                    <label className="ipill">
                      <span>{t("flip.bidPhone")}</span>
                      <div className="ipv"><input type="tel" inputMode="tel" value={b.phone || ""} onChange={(e) => setBid(s, b.id, { phone: e.target.value })} /></div>
                    </label>
                  )}
                  <button
                    className={b.picked ? "bg" : "bo"}
                    onClick={() => pick(s, b.id)}
                    style={{ padding: "0 12px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    {b.picked && <Icon name="check" size={13} />} {b.picked ? t("flip.hired") : t("flip.hire")}
                  </button>
                </div>
              </div>
            ))}
            {s.bids.length < MAX_BIDS && (
              <button
                onClick={() => setSub(s.id, { bids: [...s.bids, { id: newId() }] })}
                style={{ background: "none", color: "var(--flip-gold)", fontSize: 13, fontWeight: 600, padding: "8px 0 0", display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <Icon name="add" size={13} /> {s.bids.length ? t("flip.addBid") : t("flip.addFirstBid")}
              </button>
            )}
          </div>
        );
      })}

      <datalist id="flip-trades">{TRADES.map((tr) => <option key={tr} value={tr} />)}</datalist>

      <button
        className="bo"
        onClick={() => onChange([...list, { id: newId(), trade: "", permit: { status: "none" }, bids: [] }])}
        style={{ width: "100%", margin: "10px 0 4px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
      >
        <Icon name="add" size={15} /> {t("flip.addTrade")}
      </button>

      {sum.hired > 0 && (
        <div className="drow" style={{ borderTop: "1px solid var(--color-border-dark-2)" }}>
          <span className="l">{t("flip.subsHired")} ({sum.hired})</span>
          <span className="v">{money(sum.paid)} {t("flip.paid")} <span className="dim" style={{ fontSize: 12.5 }}>/ {money(sum.picked)}</span></span>
        </div>
      )}
      {sum.permitOpen.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, color: "var(--flip-gold)", padding: "6px 0 2px" }}>
          <Icon name="warn" size={13} color="var(--flip-gold)" />
          {t("flip.permitsOpen").replace("{n}", String(sum.permitOpen.length))}: {sum.permitOpen.map((s) => s.trade || "?").join(", ")}
        </div>
      )}
    </div>
  );
}
