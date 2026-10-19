"use client";
import { DRAW_STEPS, drawFee, drawSummary, setDrawStatus, type FlipLine, type ResaleData } from "@/lib/flip";
import { buildDrawRequestHtml } from "@/lib/export-flip-draw";
import { openPrint } from "@/lib/print-template";
import { useStore } from "@/lib/store";
import type { FlipDraw, FlipDrawStatus, FlipLoan, FlipProject } from "@/lib/types";
import { t } from "@/lib/i18n";
import { Icon } from "../Icon";

/* Flip Mode — the lender and its draw schedule (flip_projects.loan, JSONB).
   Rehab lenders hold the rehab money back and release it in draws after an
   inspection; you pay first and get paid back. All numbers come from
   drawSummary (src/lib/flip.ts); the draw request PDF from export-flip-draw. */

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const numVal = (v: string) => (v === "" ? undefined : Number(v));
const today = () => new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
const fmtDay = (ymd?: string) => (ymd ? new Date(`${ymd}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

const STATUS_C: Record<FlipDrawStatus, string> = {
  planned: "var(--color-dim)",
  requested: "var(--flip-gold)",
  inspected: "var(--flip-gold)",
  funded: "var(--color-money)",
};
// Typical rehab-loan milestones, used when splitting the holdback evenly.
const MILESTONES = ["flip.ms1", "flip.ms2", "flip.ms3", "flip.ms4"];

export default function FlipDraws({ project, loan, onChange, spent, lines, work }: {
  project: FlipProject;
  loan: FlipLoan | null | undefined;
  onChange: (next: FlipLoan) => void;
  spent: number;
  lines: FlipLine[];
  work: ResaleData;
}) {
  const org = useStore((s) => s.org);
  const showToast = useStore((s) => s.showToast);
  const l: FlipLoan = loan || {};
  const draws = l.draws || [];
  const sum = drawSummary(l, spent);
  const active = sum.holdback > 0 || draws.length > 0;

  const set = (patch: Partial<FlipLoan>) => onChange({ ...l, ...patch });
  const setDraws = (next: FlipDraw[]) => set({ draws: next });
  const setDraw = (id: string, patch: Partial<FlipDraw>) => setDraws(draws.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const fromJobs = () =>
    setDraws(lines.map((x) => ({ id: newId(), label: x.label, amount: Math.round(x.budget), status: "planned" as const })));
  const splitHoldback = () => {
    const each = Math.floor(sum.holdback / 4);
    setDraws(MILESTONES.map((k, i) => ({
      id: newId(),
      label: t(k),
      amount: i === 3 ? sum.holdback - each * 3 : each,
      status: "planned" as const,
    })));
  };

  const printRequest = (d: FlipDraw) => {
    // A planned draw is being requested now — stamp it so the PDF and the
    // schedule agree.
    let draw = d;
    if (d.status === "planned") {
      draw = setDrawStatus(d, "requested", today());
      setDraw(d.id, draw);
    }
    const html = buildDrawRequestHtml({ project: { ...project, loan: { ...l, draws: draws.map((x) => (x.id === d.id ? draw : x)) } }, draw, lines, work, org });
    if (!openPrint(html)) showToast(t("flip.allowPopups"), "error");
  };

  return (
    <div className="section">
      <div className="seclabel"><Icon name="money" size={14} /> {t("flip.lenderDraws")}</div>

      {/* Loan */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 6, marginTop: 8 }}>
        <input value={l.lender || ""} onChange={(e) => set({ lender: e.target.value })} placeholder={t("flip.lenderPh")} style={{ fontSize: 14, padding: "7px 9px" }} />
        <input value={l.loan_no || ""} onChange={(e) => set({ loan_no: e.target.value })} placeholder={t("flip.loanNoPh")} style={{ fontSize: 14, padding: "7px 9px" }} />
      </div>
      <input value={l.contact || ""} onChange={(e) => set({ contact: e.target.value })} placeholder={t("flip.drawContactPh")} style={{ fontSize: 14, padding: "7px 9px", marginTop: 6 }} />
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.8fr 0.9fr", gap: 6, marginTop: 6 }}>
        <label className="ipill">
          <span>{t("flip.holdback")}</span>
          <div className="ipv"><i>$</i><input type="number" inputMode="decimal" min={0} value={l.holdback ?? ""} onChange={(e) => set({ holdback: numVal(e.target.value) })} /></div>
        </label>
        <label className="ipill">
          <span>{t("flip.rate")}</span>
          <div className="ipv"><input type="number" inputMode="decimal" min={0} value={l.rate ?? ""} onChange={(e) => set({ rate: numVal(e.target.value) })} /><i>%</i></div>
        </label>
        <label className="ipill">
          <span>{t("flip.drawFee")}</span>
          <div className="ipv"><i>$</i><input type="number" inputMode="decimal" min={0} value={l.draw_fee ?? ""} onChange={(e) => set({ draw_fee: numVal(e.target.value) })} /></div>
        </label>
      </div>
      {!active && <div className="dim" style={{ fontSize: 12.5, padding: "8px 0 2px" }}>{t("flip.drawsEmpty")}</div>}

      {/* Where the money stands */}
      {active && (
        <div style={{ padding: "10px 0 2px" }}>
          {sum.holdback > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontWeight: 600 }}>{t("flip.funded")}</span>
                <span style={{ fontFamily: "Oswald", fontSize: 16 }}>{money(sum.funded)}<span className="dim" style={{ fontSize: 13 }}> / {money(sum.holdback)}</span></span>
              </div>
              <div className="track" style={{ margin: "6px 0 4px" }}>
                <div className="fill" style={{ width: `${Math.min(100, (sum.funded / sum.holdback) * 100)}%`, background: "var(--color-money)" }} />
              </div>
            </>
          )}
          {sum.pending > 0 && <div className="drow"><span className="l">{t("flip.waitingOnLender")}</span><span className="v">{money(sum.pending)}</span></div>}
          {sum.holdback > 0 && <div className="drow"><span className="l">{t("flip.leftToDraw")}</span><span className="v">{money(sum.remaining)}</span></div>}
          {sum.fees > 0 && <div className="drow"><span className="l">{t("flip.drawFees")}</span><span className="v">{money(sum.fees)}</span></div>}
          {sum.interestMonthly > 0 && <div className="drow"><span className="l">{t("flip.drawInterest")}</span><span className="v">≈ {money(sum.interestMonthly)}/{t("flip.mo")}</span></div>}
          {sum.holdback > 0 && sum.floating > 0 && (
            <div style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 13, color: "var(--flip-gold)", fontWeight: 600, padding: "8px 0 2px" }}>
              <Icon name="info" size={14} color="var(--flip-gold)" /> {t("flip.floating").replace("{x}", money(sum.floating))}
            </div>
          )}
          {sum.readyToDraw >= 1 && (
            <div style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 13, color: "var(--color-money)", fontWeight: 600, padding: "6px 0 2px" }}>
              <Icon name="checkCircle" size={14} color="var(--color-money)" /> {t("flip.readyToDraw").replace("{x}", money(sum.readyToDraw))}
            </div>
          )}
          {sum.overScheduled && (
            <div style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12.5, color: "var(--color-accent-red)", padding: "6px 0 2px" }}>
              <Icon name="warn" size={13} color="var(--color-accent-red)" /> {t("flip.overScheduled").replace("{s}", money(sum.scheduled)).replace("{h}", money(sum.holdback))}
            </div>
          )}
        </div>
      )}

      {/* Draw schedule */}
      {draws.map((d, i) => (
        <div key={d.id} style={{ marginTop: 10, padding: 9, borderRadius: 10, border: `1px solid ${d.status === "funded" ? "rgba(0,230,118,.45)" : "var(--color-border-dark-2)"}` }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 14, color: STATUS_C[d.status], flex: "none" }}>#{i + 1}</span>
            <input value={d.label || ""} onChange={(e) => setDraw(d.id, { label: e.target.value })} placeholder={t("flip.milestonePh")} style={{ flex: 1, minWidth: 0, fontSize: 14, padding: "6px 8px" }} />
            <button onClick={() => setDraws(draws.filter((x) => x.id !== d.id))} aria-label={t("flip.removeDraw")} style={{ background: "none", color: "var(--color-dim)", padding: 4, flex: "none" }}>
              <Icon name="delete" size={14} />
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr", gap: 6, marginTop: 6 }}>
            <label className="ipill">
              <span>{t("flip.drawAmount")}</span>
              <div className="ipv"><i>$</i><input type="number" inputMode="decimal" min={0} value={d.amount ?? ""} onChange={(e) => setDraw(d.id, { amount: numVal(e.target.value) })} /></div>
            </label>
            <select
              value={d.status}
              onChange={(e) => setDraw(d.id, setDrawStatus(d, e.target.value as FlipDrawStatus, today()))}
              aria-label={t("flip.drawStatus")}
              style={{ fontSize: 14, padding: "6px 8px", color: STATUS_C[d.status], fontWeight: 600 }}
            >
              {DRAW_STEPS.map((s) => <option key={s} value={s}>{t(`flip.draw_${s}`)}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap", fontSize: 12.5, color: "var(--color-dim)" }}>
            {d.requested_at && <span>{t("flip.requestedOn")} {fmtDay(d.requested_at)}</span>}
            {d.status === "funded" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                · {t("flip.fundedOn")}
                <input type="date" value={d.funded_at || ""} onChange={(e) => e.target.value && setDraw(d.id, { funded_at: e.target.value })} aria-label={t("flip.fundedOn")} style={{ width: "auto", fontSize: 12.5, padding: "2px 6px", minHeight: 0 }} />
              </span>
            )}
            {drawFee(l, d) > 0 && d.status !== "planned" && <span>· {t("flip.fee")} {money(drawFee(l, d))}</span>}
            <span style={{ flex: 1 }} />
            {d.status !== "funded" && (
              <button className="bo" onClick={() => printRequest(d)} style={{ padding: "4px 10px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon name="print" size={12} /> {t("flip.drawRequestPdf")}
              </button>
            )}
          </div>
          <input value={d.note || ""} onChange={(e) => setDraw(d.id, { note: e.target.value })} placeholder={t("flip.drawNotePh")} style={{ fontSize: 13, padding: "5px 8px", marginTop: 6 }} />
        </div>
      ))}

      {/* Build the schedule */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 4px" }}>
        <button className="bo" onClick={() => setDraws([...draws, { id: newId(), status: "planned" }])} style={{ flex: 1, minWidth: 130, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Icon name="add" size={14} /> {t("flip.addDraw")}
        </button>
        {draws.length === 0 && lines.length > 0 && (
          <button className="bo" onClick={fromJobs} style={{ flex: 1, minWidth: 130, fontSize: 13 }}>{t("flip.drawsFromJobs")}</button>
        )}
        {draws.length === 0 && sum.holdback > 0 && (
          <button className="bo" onClick={splitHoldback} style={{ flex: 1, minWidth: 130, fontSize: 13 }}>{t("flip.drawsSplit")}</button>
        )}
      </div>
    </div>
  );
}
