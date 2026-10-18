"use client";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { analyzeFlipActuals, compsArv, flipActuals, resaleData, subsSummary } from "@/lib/flip";
import { buildResaleHtml, type ResaleOptions } from "@/lib/export-flip-resale";
import { openPrint } from "@/lib/print-template";
import { useBackLayer } from "@/lib/back-layer";
import type { FlipComp, FlipProject, FlipSub } from "@/lib/types";
import { statusColor } from "@/lib/status";
import { goWithIntent } from "@/lib/nav-intent";
import { db } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { Icon } from "../Icon";
import FlipSubs from "./FlipSubs";

/* Flip Mode — Phase 2 project dashboard for ONE saved flip: budget vs actual,
   the holding-cost clock and projected profit with actual spend swapped in.
   Every number comes from flipActuals / analyzeFlipActuals (src/lib/flip.ts)
   over data the app already has — receipts + time entries on the jobs linked
   to this flip (jobs.flip_project_id). Nothing here is stored. */

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.round(Math.abs(n)).toLocaleString()}`;
const fill = (n: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), n);

const VERDICT_C = { good: "var(--color-money)", warn: "var(--flip-gold)", bad: "var(--color-accent-red)" } as const;

function Bar({ actual, budget }: { actual: number; budget: number }) {
  const over = actual > budget;
  const pct = budget > 0 ? Math.min(100, (actual / budget) * 100) : actual > 0 ? 100 : 0;
  return (
    <div className="track" style={{ margin: "6px 0 2px" }}>
      <div className="fill" style={{ width: `${pct}%`, background: over ? "var(--color-accent-red)" : undefined }} />
    </div>
  );
}

const OverChip = ({ over }: { over: number }) => (
  <span className="chip" style={{ color: "var(--color-accent-red)", background: "rgba(192,0,0,.14)", flex: "none" }}>
    {t("flip.overBy")} {money(over)}
  </span>
);

export default function FlipDashboard({ project, setPage, onSubsChange }: {
  project: FlipProject;
  setPage: (p: string) => void;
  onSubsChange: (subs: FlipSub[]) => void;
}) {
  const jobs = useStore((s) => s.jobs);
  const receipts = useStore((s) => s.receipts);
  const timeEntries = useStore((s) => s.timeEntries);
  const profiles = useStore((s) => s.profiles);
  const loadAll = useStore((s) => s.loadAll);
  const org = useStore((s) => s.org);
  const showToast = useStore((s) => s.showToast);

  const act = useMemo(
    () => flipActuals({ flipId: project.id, jobs, receipts, timeEntries, profiles }),
    [project.id, jobs, receipts, timeEntries, profiles],
  );
  // Subs are paid outside the app's receipts/time entries — what's been paid
  // to hired subs counts as real rehab spend. The rehab is only "done" once
  // the linked jobs are done AND every hired sub is paid their bid.
  const sub = useMemo(() => subsSummary(project.subs), [project.subs]);
  const spent = act.spent + sub.paid;
  const rehabDone = (act.lines.length > 0 ? act.allDone : sub.hired > 0) && sub.paid >= sub.picked;
  const a = useMemo(
    () => analyzeFlipActuals(project, { spent, rehabDone }),
    [project, spent, rehabDone],
  );

  const budget = project.rehab_budget || 0;
  const overall = Math.max(0, spent - budget);

  // Resale package — a printable sheet for the agent / buyers / appraiser.
  const [resaleOpen, setResaleOpen] = useState(false);
  useBackLayer(resaleOpen, () => setResaleOpen(false));
  const resale = useMemo(() => resaleData(project.id, jobs), [project.id, jobs]);
  const hasPermits = (project.subs || []).some((x) => x.trade && x.permit && x.permit.status !== "none");
  const hasComps = (project.comps || []).some((c) => c && (c.address || c.price));
  const [opts, setOpts] = useState<ResaleOptions>({ photos: true, renders: false, permits: true, comps: true, invested: false });
  const makeResale = () => {
    const html = buildResaleHtml({ project, data: resale, spent, org, opts });
    if (!openPrint(html)) showToast(t("flip.allowPopups"), "error");
    setResaleOpen(false);
  };
  const vc = VERDICT_C[a.verdict];
  const delta = a.profit - a.plan.profit;
  const sold = !!project.sold_at;

  // Jobs not tied to any flip yet — this address first, then the newest.
  const linkable = useMemo(() => {
    const addr = project.address.trim().toLowerCase();
    const match = (p?: string) => !!addr && !!p && (p.toLowerCase().includes(addr) || addr.includes(p.toLowerCase()));
    return jobs
      .filter((j) => !j.flip_project_id && !j.archived)
      .sort((x, y) => Number(match(y.property)) - Number(match(x.property)) || (y.created_at || "").localeCompare(x.created_at || ""))
      .slice(0, 30);
  }, [jobs, project.address]);

  const linkJob = async (jobId: string) => {
    if (!jobId) return;
    await db.patch("jobs", jobId, { flip_project_id: project.id });
    loadAll();
  };

  return (
    <>
      {/* Projected profit with actuals */}
      <div className="cd mb" style={{ border: `1px solid ${vc}`, textAlign: "center", padding: "14px" }}>
        <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 12.5, letterSpacing: ".12em", textTransform: "uppercase", color: vc }}>
          {sold ? t("flip.finalProfit") : t("flip.projectedNow")}
        </div>
        <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 40, lineHeight: 1.1, marginTop: 2, color: vc }}>{money(a.profit)}</div>
        <div style={{ fontSize: 13, color: "var(--color-dim)" }}>
          {t("flip.plan")} {money(a.plan.profit)}
          {Math.abs(delta) >= 1 && (
            <span style={{ color: delta < 0 ? "var(--color-accent-red)" : "var(--color-money)", fontWeight: 600 }}> · {delta < 0 ? "" : "+"}{money(delta)}</span>
          )}
          {" · "}{t("flip.roi")} {Math.round(a.roi * 100)}%
        </div>
      </div>

      {/* Holding clock */}
      <div className="section">
        <div className="seclabel"><Icon name="time" size={14} /> {t("flip.holdingClock")}</div>
        {project.acquired_at ? (
          <>
            <div className="drow">
              <span className="l">{sold ? t("flip.heldFor") : t("flip.daysHeld")}</span>
              <span className="v" style={{ fontFamily: "Oswald", fontSize: 18 }}>{fill(t("flip.nDays"), { n: a.days })}</span>
            </div>
            <div className="drow">
              <span className="l">{t("flip.holdingSoFar")}</span>
              <span className="v">{money(a.holdingToDate)}</span>
            </div>
            <div className="drow">
              <span className="l">{t("flip.holdingPlanned")} ({project.holding_months || 0} {t("flip.mo")})</span>
              <span className={`v${a.holdingToDate > a.plan.holding ? " over" : ""}`}>{money(a.plan.holding)}</span>
            </div>
            {!sold && a.perDay > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0 4px", fontSize: 14, color: "var(--flip-gold)", fontWeight: 600 }}>
                <Icon name="fire" size={15} color="var(--flip-gold)" /> {fill(t("flip.burning"), { x: money(a.perDay) })}
              </div>
            )}
          </>
        ) : (
          <div className="dim" style={{ fontSize: 13, padding: "6px 0 4px" }}>{t("flip.clockNotStarted")}</div>
        )}
      </div>

      {/* Budget vs actual */}
      <div className="section">
        <div className="seclabel"><Icon name="money" size={14} /> {t("flip.budgetVsActual")}</div>
        <div style={{ padding: "8px 0 4px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{t("flip.rehab")}</span>
            <span style={{ fontFamily: "Oswald", fontSize: 16 }}>
              <span className={overall > 0 ? "over" : undefined}>{money(spent)}</span>
              <span className="dim" style={{ fontSize: 13 }}> / {money(budget)}</span>
            </span>
          </div>
          <Bar actual={spent} budget={budget} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12.5, color: "var(--color-dim)" }}>
            <span>{t("flip.materials")} {money(act.materials)} · {t("flip.labor")} {money(act.labor)}{sub.paid > 0 && <> · {t("flip.subsShort")} {money(sub.paid)}</>}</span>
            {overall > 0 ? <OverChip over={overall} /> : budget > 0 && <span>{money(budget - spent)} {t("flip.left")}</span>}
          </div>
          {act.unratedHrs > 0 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, color: "var(--flip-gold)", marginTop: 6 }}>
              <Icon name="warn" size={13} color="var(--flip-gold)" /> {fill(t("flip.unrated"), { n: Math.round(act.unratedHrs * 10) / 10 })}
            </div>
          )}
        </div>

        {act.lines.length === 0 ? (
          <div className="dim" style={{ fontSize: 13, padding: "6px 0 4px" }}>{t("flip.noJobs")}</div>
        ) : act.lines.map((l) => (
          <button
            key={l.jobId}
            onClick={() => goWithIntent(setPage, { page: "jobs", jobId: l.jobId })}
            style={{ display: "block", width: "100%", textAlign: "left", background: "none", padding: "10px 0 6px", borderTop: "1px solid var(--color-border-dark-2)", color: "inherit" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: statusColor(l.status), flex: "none" }} />
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.label || t("flip.untitledJob")}</span>
              <span style={{ fontFamily: "Oswald", fontSize: 15, flex: "none" }}>
                <span className={l.over > 0 ? "over" : undefined}>{money(l.actual)}</span>
                <span className="dim" style={{ fontSize: 12.5 }}> / {money(l.budget)}</span>
              </span>
            </div>
            <Bar actual={l.actual} budget={l.budget} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, color: "var(--color-dim)" }}>
              <span>
                {t(`status.${l.status}`)}
                {l.tasksTotal > 0 && <> · {fill(t("flip.tasksDone"), { d: l.tasksDone, n: l.tasksTotal })} ({Math.round((l.tasksDone / l.tasksTotal) * 100)}%)</>}
              </span>
              {l.over > 0 ? <OverChip over={l.over} /> : l.budget > 0 && <span>{Math.round((l.actual / l.budget) * 100)}% {t("flip.spent")}</span>}
            </div>
          </button>
        ))}

        {sub.hired > 0 && (
          <div style={{ padding: "10px 0 6px", borderTop: "1px solid var(--color-border-dark-2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="worker" size={14} color="var(--color-dim)" />
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{t("flip.subsHired")} ({sub.hired})</span>
              <span style={{ fontFamily: "Oswald", fontSize: 15, flex: "none" }}>
                {money(sub.paid)}<span className="dim" style={{ fontSize: 12.5 }}> / {money(sub.picked)}</span>
              </span>
            </div>
            <Bar actual={sub.paid} budget={sub.picked} />
            <div style={{ fontSize: 12, color: "var(--color-dim)" }}>{t("flip.subsBarNote")}</div>
          </div>
        )}

        {linkable.length > 0 && (
          <select value="" onChange={(e) => linkJob(e.target.value)} style={{ marginTop: 8, fontSize: 14 }}>
            <option value="">{t("flip.linkJob")}</option>
            {linkable.map((j) => <option key={j.id} value={j.id}>{j.property || j.client} — {t(`status.${j.status}`)}</option>)}
          </select>
        )}
        <div className="dim" style={{ fontSize: 12, padding: "6px 0 2px" }}>{t("flip.budgetNote")}</div>
      </div>

      <FlipSubs subs={project.subs} onChange={onSubsChange} />

      {/* Projected P&L with actuals */}
      <div className="section">
        <div className="seclabel"><Icon name="list" size={14} /> {t("flip.projectedPnl")}</div>
        {[
          { l: t("flip.purchase"), n: project.purchase_price || 0, plan: project.purchase_price || 0 },
          { l: act.allDone ? t("flip.rehabActual") : t("flip.rehabProjected"), n: a.rehabProjected, plan: budget },
          { l: t("flip.holding"), n: a.holdingProjected, plan: a.plan.holding },
          { l: t("flip.financing"), n: project.financing_cost || 0, plan: project.financing_cost || 0 },
          { l: t("flip.contingency"), n: project.contingency || 0, plan: project.contingency || 0 },
        ].map((r) => (
          <div key={r.l} className="drow">
            <span className="l">{r.l}{Math.round(r.n) !== Math.round(r.plan) && <span style={{ fontSize: 12 }}> ({t("flip.plan").toLowerCase()} {money(r.plan)})</span>}</span>
            <span className={`v${r.n > r.plan + 0.5 ? " over" : ""}`}>{money(r.n)}</span>
          </div>
        ))}
        <div className="drow"><span className="l" style={{ fontWeight: 600, color: "inherit" }}>{t("flip.allIn")}</span><span className="v" style={{ fontFamily: "Oswald", fontSize: 16 }}>{money(a.allIn)}</span></div>
        <div className="drow"><span className="l">{sold ? t("flip.soldPrice") : t("flip.arv")} − {t("flip.sellingCosts")} ({project.selling_pct || 0}%)</span><span className="v">{money(a.netSale)}</span></div>
        <div className="drow"><span className="l" style={{ fontWeight: 600, color: "inherit" }}>{sold ? t("flip.finalProfit") : t("flip.projectedNow")}</span><span className="v" style={{ fontFamily: "Oswald", fontSize: 16, color: vc }}>{money(a.profit)}</span></div>
      </div>

      {/* Resale package */}
      <div className="section">
        <div className="seclabel"><Icon name="doc" size={14} /> {t("flip.sellIt")}</div>
        <div className="dim" style={{ fontSize: 13, padding: "6px 0 8px" }}>{t("flip.resaleSub")}</div>
        <button className="bgold" onClick={() => setResaleOpen(true)} style={{ width: "100%", marginBottom: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
          <Icon name="print" size={16} /> {t("flip.resalePackage")}
        </button>
      </div>

      {resaleOpen && (
        <div className="sheet-overlay" onClick={() => setResaleOpen(false)}>
          <div className="cd sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, paddingTop: 20 }}>
            <h3 style={{ fontFamily: "Oswald", fontSize: 19, textTransform: "uppercase", marginBottom: 4 }}>{t("flip.resalePackage")}</h3>
            <div className="dim" style={{ fontSize: 13, marginBottom: 10 }}>{project.address}</div>
            <div style={{ fontSize: 13.5, marginBottom: 10 }}>
              {fill(t("flip.resaleCounts"), {
                a: resale.areas.length,
                i: resale.areas.reduce((n, x) => n + x.items.length, 0),
                p: resale.before.length + resale.after.length,
              })}
            </div>
            {([
              ["photos", t("flip.optPhotos"), resale.before.length + resale.after.length > 0],
              ["permits", t("flip.optPermits"), hasPermits],
              ["comps", t("flip.optComps"), hasComps],
              ["renders", t("flip.optRenders"), resale.renders.length > 0],
              ["invested", t("flip.optInvested"), spent > 0],
            ] as [keyof ResaleOptions, string, boolean][]).filter(([, , has]) => has).map(([k, label]) => (
              <label key={k} className="drow" style={{ cursor: "pointer" }}>
                <span className="l" style={{ color: "inherit" }}>{label}</span>
                <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts((o) => ({ ...o, [k]: e.target.checked }))} style={{ width: 20, height: 20, minHeight: 0, padding: 0, flexShrink: 0 }} />
              </label>
            ))}
            {opts.invested && spent > 0 && <div style={{ fontSize: 12, color: "var(--flip-gold)", padding: "4px 0" }}>{t("flip.investedWarn")}</div>}
            {opts.renders && resale.renders.length > 0 && <div className="dim" style={{ fontSize: 12, padding: "4px 0" }}>{t("flip.rendersNote")}</div>}
            <button className="bgold" onClick={makeResale} style={{ width: "100%", marginTop: 12, padding: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
              <Icon name="print" size={16} /> {t("flip.makePdf")}
            </button>
            <button type="button" onClick={() => setResaleOpen(false)} className="dim" style={{ background: "none", border: "none", fontSize: 13, padding: 8, width: "100%", cursor: "pointer" }}>
              {t("flip.cancel")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* Comps — up to 3 nearby sales backing the ARV, persisted on
   flip_projects.comps (JSONB). Manual entry; no MLS. The "comps say" line is
   derived (avg $/sq ft × this house's sq ft) and only fills ARV when tapped. */
export const MAX_COMPS = 3;

export function FlipComps({ comps, sqft, onChange, onUseArv }: {
  comps: FlipComp[] | null | undefined;
  sqft: number | null | undefined;
  onChange: (next: FlipComp[]) => void;
  onUseArv: (arv: number) => void;
}) {
  const rows: FlipComp[] = Array.from({ length: MAX_COMPS }, (_, i) => comps?.[i] || {});
  const est = compsArv(rows, sqft);
  const set = (i: number, patch: Partial<FlipComp>) => {
    const next = rows.map((r, k) => (k === i ? { ...r, ...patch } : r));
    // Drop trailing blank rows (not worth storing). Only trailing ones, so a
    // filled row never shifts up into another row's inputs mid-typing.
    const blank = (r: FlipComp) => !(r.address || r.price || r.sqft || r.note);
    while (next.length && blank(next[next.length - 1])) next.pop();
    onChange(next);
  };
  const numVal = (v: string) => (v === "" ? undefined : Number(v));

  return (
    <div className="section">
      <div className="seclabel"><Icon name="home" size={14} /> {t("flip.comps")}</div>
      {rows.map((c, i) => (
        <div key={i} style={{ padding: "8px 0 6px", borderTop: i ? "1px solid var(--color-border-dark-2)" : undefined }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              value={c.address || ""}
              onChange={(e) => set(i, { address: e.target.value })}
              placeholder={fill(t("flip.compAddressPh"), { n: i + 1 })}
              style={{ flex: 1, minWidth: 0 }}
            />
            <select
              value={c.status || "sold"}
              onChange={(e) => set(i, { status: e.target.value as FlipComp["status"] })}
              aria-label={t("flip.compStatus")}
              style={{ width: "auto", fontSize: 14, padding: "6px 8px" }}
            >
              <option value="sold">{t("flip.compSold")}</option>
              <option value="pending">{t("flip.compPending")}</option>
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 0.9fr", gap: 6, marginTop: 6 }}>
            <label className="ipill">
              <span>{t("flip.compPrice")}</span>
              <div className="ipv"><i>$</i><input type="number" inputMode="decimal" min={0} value={c.price ?? ""} onChange={(e) => set(i, { price: numVal(e.target.value) })} /></div>
            </label>
            <label className="ipill">
              <span>{t("flip.sqft")}</span>
              <div className="ipv"><input type="number" inputMode="decimal" min={0} value={c.sqft ?? ""} onChange={(e) => set(i, { sqft: numVal(e.target.value) })} /></div>
            </label>
            <div className="ipill" style={{ justifyContent: "center" }}>
              <span>{t("flip.perSqft")}</span>
              <div className="ipv" style={{ color: "var(--color-dim)" }}>{c.price && c.sqft ? `$${Math.round(c.price / c.sqft)}` : "—"}</div>
            </div>
          </div>
        </div>
      ))}
      {est && (
        <div className="drow" style={{ borderTop: "1px solid var(--color-border-dark-2)" }}>
          <span className="l">
            {fill(t("flip.compsSay"), { n: est.count, p: `$${Math.round(est.ppsf)}` })}
            {est.arv > 0 && <> → <b style={{ color: "inherit" }}>{money(est.arv)}</b></>}
          </span>
          {est.arv > 0 ? (
            <button className="bo" onClick={() => onUseArv(Math.round(est.arv))} style={{ padding: "4px 10px", fontSize: 13, flex: "none" }}>{t("flip.useAsArv")}</button>
          ) : (
            <span className="v dim" style={{ fontSize: 12 }}>{t("flip.addSqft")}</span>
          )}
        </div>
      )}
    </div>
  );
}
