"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { analyzeFlip, RULE_70, type FlipVerdict } from "@/lib/flip";
import type { FlipProject, FlipStatus } from "@/lib/types";
import { t } from "@/lib/i18n";
import { Icon } from "../Icon";
import TopBar from "@/components/TopBar";
import FlipDashboard, { FlipComps } from "./FlipDashboard";

interface Props {
  setPage: (p: string) => void;
}

/* Flip Mode — Deal Analyzer ("should I buy this?").
   Inputs live on the flip_projects row; every number on screen comes from
   analyzeFlip() (src/lib/flip.ts) and is never stored. A new analysis is a
   phone-only draft until "Start this flip project" saves it; edits to a
   saved project autosave (debounced + serialized so fast pill edits can't
   land out of order). */

type Draft = Partial<FlipProject> & { address: string };
type NumKey =
  | "purchase_price" | "rehab_budget" | "arv" | "down_pct" | "holding_monthly"
  | "holding_months" | "financing_cost" | "selling_pct" | "contingency";

// Same defaults as the SQL column defaults, so a draft reads the same before
// and after it's saved.
const NEW_DRAFT: Draft = { address: "", status: "analyzing", down_pct: 15, holding_months: 5, selling_pct: 6 };

const FIELDS: { key: NumKey; label: string; unit: "$" | "%" | "mo" }[] = [
  { key: "purchase_price", label: "flip.purchase", unit: "$" },
  { key: "arv", label: "flip.arv", unit: "$" },
  { key: "rehab_budget", label: "flip.rehab", unit: "$" },
  { key: "contingency", label: "flip.contingency", unit: "$" },
  { key: "holding_monthly", label: "flip.holdingMonthly", unit: "$" },
  { key: "holding_months", label: "flip.holdingMonths", unit: "mo" },
  { key: "down_pct", label: "flip.downPct", unit: "%" },
  { key: "financing_cost", label: "flip.financing", unit: "$" },
  { key: "selling_pct", label: "flip.sellingPct", unit: "%" },
];

const STATUSES: FlipStatus[] = ["analyzing", "acquired", "active", "listed", "sold", "dead"];
// Once a house is bought, opening it lands on the dashboard (budget vs actual).
const OWNED: FlipStatus[] = ["acquired", "active", "listed", "sold"];

// A stored TIMESTAMPTZ <-> the date input's local YYYY-MM-DD (noon, so a
// timezone shift can't move it a day).
const toDateInput = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA") : "");
const fromDateInput = (v: string) => (v ? new Date(`${v}T12:00:00`).toISOString() : null);

const VERDICT_STYLE: Record<FlipVerdict | "empty", { c: string; tint: string; icon: "checkCircle" | "warn" | "errorCircle" | "calc"; label: string }> = {
  empty: { c: "var(--color-dim)", tint: "transparent", icon: "calc", label: "flip.enterNumbers" },
  good: { c: "var(--color-money)", tint: "rgba(0,230,118,.10)", icon: "checkCircle", label: "flip.verdictGood" },
  warn: { c: "var(--flip-gold)", tint: "rgba(255,204,0,.10)", icon: "warn", label: "flip.verdictWarn" },
  bad: { c: "var(--color-accent-red)", tint: "rgba(192,0,0,.13)", icon: "errorCircle", label: "flip.verdictBad" },
};

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.round(Math.abs(n)).toLocaleString()}`;
const draftKey = (uid?: string) => `c_flip_draft_${uid || "anon"}`;

function readDraft(uid?: string): Draft {
  try {
    const raw = localStorage.getItem(draftKey(uid));
    if (raw) return { ...NEW_DRAFT, ...JSON.parse(raw) };
  } catch { /* private mode / bad JSON — start fresh */ }
  return { ...NEW_DRAFT };
}

export default function FlipAnalyzer({ setPage }: Props) {
  const user = useStore((s) => s.user);
  const flipProjects = useStore((s) => s.flipProjects);
  const jobs = useStore((s) => s.jobs);
  const upsertFlipProject = useStore((s) => s.upsertFlipProject);
  const deleteFlipProject = useStore((s) => s.deleteFlipProject);
  const showToast = useStore((s) => s.showToast);
  const showConfirm = useStore((s) => s.showConfirm);

  // null = the unsaved new-analysis draft; otherwise a saved project's id.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => readDraft(user?.id));
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<"deal" | "dash">("deal");

  // ── Autosave for saved projects: one pending patch, flushed after a pause,
  //    each flush chained behind the last so writes land in order.
  const pendingRef = useRef<{ id: string; patch: Partial<FlipProject> } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const flush = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const p = pendingRef.current;
    pendingRef.current = null;
    if (!p) return;
    const row = useStore.getState().flipProjects.find((f) => f.id === p.id);
    chainRef.current = chainRef.current.then(() =>
      upsertFlipProject({ id: p.id, address: p.patch.address ?? row?.address ?? "", ...p.patch })
    );
  };
  const queueSave = (id: string, patch: Partial<FlipProject>) => {
    // A patch for another project (just switched) goes out first.
    if (pendingRef.current && pendingRef.current.id !== id) flush();
    pendingRef.current = { id, patch: { ...pendingRef.current?.patch, ...patch } };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 700);
  };
  // Leaving the screen saves what's pending instead of dropping it.
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Remember the unsaved draft on this phone so leaving the screen doesn't lose it.
  useEffect(() => {
    if (activeId) return;
    try { localStorage.setItem(draftKey(user?.id), JSON.stringify(draft)); } catch { /* */ }
  }, [draft, activeId, user?.id]);

  const update = (patch: Partial<FlipProject>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (activeId) {
      // address is NOT NULL — never write a blank one.
      const safe = { ...patch };
      if ("address" in safe && !String(safe.address || "").trim()) delete safe.address;
      if (Object.keys(safe).length) queueSave(activeId, safe);
    }
  };

  const openProject = (id: string | null) => {
    flush();
    setActiveId(id);
    if (id === null) { setDraft(readDraft(user?.id)); return; }
    const row = flipProjects.find((f) => f.id === id);
    if (row) setDraft({ ...row, comps: row.comps ?? undefined });
    setView(row && OWNED.includes(row.status) ? "dash" : "deal");
  };

  const a = useMemo(() => analyzeFlip(draft), [draft]);
  // Nothing typed yet = a neutral card, not a red "loses money".
  const hasNumbers = !!(draft.arv || draft.purchase_price);
  const v = VERDICT_STYLE[hasNumbers ? a.verdict : "empty"];

  // Rehab seed: the same walk that makes a customer quote makes a rehab
  // estimate. Quotes at this address first, then the newest others.
  const quoteOptions = useMemo(() => {
    const addr = draft.address.trim().toLowerCase();
    const list = jobs.filter((j) => !j.archived && (j.total || 0) > 0 && j.status !== "lead");
    const match = (p?: string) => !!addr && !!p && (p.toLowerCase().includes(addr) || addr.includes(p.toLowerCase()));
    return [...list]
      .sort((x, y) => Number(match(y.property)) - Number(match(x.property)) || (y.created_at || "").localeCompare(x.created_at || ""))
      .slice(0, 25);
  }, [jobs, draft.address]);

  const startProject = async () => {
    if (!draft.address.trim()) { showToast(t("flip.needAddress"), "warning"); return; }
    setSaving(true);
    const { id: _drop, ...row } = draft; // eslint-disable-line @typescript-eslint/no-unused-vars
    const created = await upsertFlipProject({ ...row, address: draft.address.trim(), status: draft.status || "analyzing" });
    setSaving(false);
    if (!created) return; // db.post already toasted why
    try { localStorage.removeItem(draftKey(user?.id)); } catch { /* */ }
    setActiveId(created.id);
    setDraft({ ...created, comps: created.comps ?? undefined });
    showToast(t("flip.started"));
  };

  const markBought = () => update({ status: "acquired", acquired_at: draft.acquired_at || new Date().toISOString() });

  // Status drives the holding clock: owning it starts the clock (if no buy
  // date yet), "sold" stops it, moving off "sold" restarts it.
  const changeStatus = (status: FlipStatus) => {
    const patch: Partial<FlipProject> = { status };
    const now = new Date().toISOString();
    if (OWNED.includes(status) && !draft.acquired_at) patch.acquired_at = now;
    if (status === "sold" && !draft.sold_at) patch.sold_at = now;
    if (status !== "sold" && draft.sold_at) patch.sold_at = null;
    update(patch);
  };

  const removeProject = async () => {
    if (!activeId) { setDraft({ ...NEW_DRAFT }); return; }
    const ok = await showConfirm(t("flip.deleteTitle"), draft.address, { confirmLabel: t("flip.delete"), danger: true });
    if (!ok) return;
    pendingRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    await deleteFlipProject(activeId);
    openProject(null);
  };

  const diff70 = a.maxBuy - (draft.purchase_price || 0);

  return (
    <div className="fi">
      <TopBar
        title={t("flip.title")}
        icon="trending"
        color="var(--flip-gold)"
        onBack={() => (window.history.length > 1 ? window.history.back() : setPage("more"))}
        backLabel={t("flip.back")}
        right={
          <button className="bo" onClick={() => openProject(null)} style={{ padding: "6px 12px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="add" size={14} /> {t("flip.new")}
          </button>
        }
      />

      {/* Project switcher */}
      {flipProjects.length > 0 && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 12, paddingBottom: 2 }}>
          <button onClick={() => openProject(null)} className="chip" style={{ flex: "none", border: `1px solid ${activeId === null ? "var(--flip-gold)" : "var(--color-border-dark-2)"}`, color: activeId === null ? "var(--flip-gold)" : "var(--color-dim)", background: "transparent" }}>
            {t("flip.newAnalysis")}
          </button>
          {flipProjects.map((f) => (
            <button key={f.id} onClick={() => openProject(f.id)} className="chip" style={{ flex: "none", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", border: `1px solid ${activeId === f.id ? "var(--flip-gold)" : "var(--color-border-dark-2)"}`, color: activeId === f.id ? "var(--flip-gold)" : "inherit", background: activeId === f.id ? "rgba(255,204,0,.10)" : "transparent" }}>
              {f.address}
            </button>
          ))}
        </div>
      )}

      {activeId && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: 3, borderRadius: 12, background: "var(--color-card-dark-2)", border: "1px solid var(--color-border-dark-2)", marginBottom: 12 }}>
          {([["deal", "calc", t("flip.viewDeal")], ["dash", "trending", t("flip.viewDash")]] as const).map(([k, icon, label]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              style={{ padding: "8px 6px", borderRadius: 9, fontSize: 14, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: view === k ? "rgba(255,204,0,.14)" : "transparent", color: view === k ? "var(--flip-gold)" : "var(--color-dim)", border: view === k ? "1px solid var(--flip-gold)" : "1px solid transparent" }}
            >
              <Icon name={icon} size={15} /> {label}
            </button>
          ))}
        </div>
      )}

      {activeId && view === "dash" ? (
        <FlipDashboard project={draft as FlipProject} setPage={setPage} />
      ) : (<>
      {/* Property */}
      <div className="section">
        <div className="seclabel"><Icon name="home" size={14} /> {t("flip.property")}</div>
        <input
          value={draft.address}
          onChange={(e) => update({ address: e.target.value })}
          placeholder={t("flip.addressPh")}
          style={{ marginTop: 6 }}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, margin: "8px 0 2px" }}>
          {(["beds", "baths", "sqft"] as const).map((k) => (
            <label key={k} className="ipill">
              <span>{t(`flip.${k}`)}</span>
              <div className="ipv">
                <input
                  type="number"
                  inputMode="decimal"
                  value={draft[k] ?? ""}
                  onChange={(e) => update({ [k]: e.target.value === "" ? null : Number(e.target.value) } as Partial<FlipProject>)}
                />
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Verdict hero */}
      <div className="cd mb" style={{ background: v.tint, border: `1px solid ${v.c}`, textAlign: "center", padding: "16px 14px" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "Oswald", fontWeight: 600, fontSize: 13, letterSpacing: ".12em", textTransform: "uppercase", color: v.c }}>
          <Icon name={v.icon} size={15} color={v.c} /> {t(hasNumbers && a.verdict === "warn" && !a.passes70 ? "flip.verdictWarn70" : v.label)}
        </div>
        <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 42, lineHeight: 1.1, marginTop: 4, color: v.c }}>
          {money(a.profit)}
        </div>
        <div style={{ fontSize: 13, color: "var(--color-dim)" }}>
          {t("flip.projectedProfit")} · {t("flip.roi")} {Math.round(a.roi * 100)}%
        </div>
      </div>

      {/* Derived cells */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
        {[
          { l: t("flip.allIn"), val: money(a.allIn) },
          { l: t("flip.cashIn"), val: money(a.cashIn) },
          { l: t("flip.roi"), val: `${Math.round(a.roi * 100)}%`, c: a.roi > 0 ? "var(--color-money)" : a.roi < 0 ? "var(--color-accent-red)" : undefined },
          { l: t("flip.arv"), val: money(draft.arv || 0) },
          { l: t("flip.netSale"), val: money(a.netSale) },
          { l: t("flip.sellingCosts"), val: money(a.selling) },
        ].map((c) => (
          <div key={c.l} className="cd" style={{ padding: "10px 6px", textAlign: "center", minWidth: 0 }}>
            <div style={{ fontSize: 10.5, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--color-dim)", lineHeight: 1.25 }}>{c.l}</div>
            <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 16, marginTop: 3, color: c.c }}>{c.val}</div>
          </div>
        ))}
      </div>

      {/* 70% rule strip */}
      <div className="section">
        <div className="drow">
          <span className="l">{t("flip.rule70")} <span style={{ fontSize: 12 }}>(ARV × {Math.round(RULE_70 * 100)}% − {t("flip.rehabShort")})</span></span>
          <span className="v" style={{ fontFamily: "Oswald", fontSize: 17 }}>{money(a.maxBuy)}</span>
        </div>
        {(draft.arv || 0) > 0 && <div className="drow">
          <span className="l">{a.passes70 ? t("flip.underMax") : t("flip.overMax")} {money(Math.abs(diff70))}</span>
          <span className="chip" style={{ color: a.passes70 ? "var(--color-money)" : "var(--color-accent-red)", background: a.passes70 ? "rgba(0,230,118,.12)" : "rgba(192,0,0,.14)" }}>
            <Icon name={a.passes70 ? "check" : "close"} size={12} /> {a.passes70 ? t("flip.passes") : t("flip.fails")}
          </span>
        </div>}
      </div>

      {/* Inputs */}
      <div className="section">
        <div className="seclabel"><Icon name="calc" size={14} /> {t("flip.numbers")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "6px 0 4px" }}>
          {FIELDS.map((f) => (
            <label key={f.key} className="ipill">
              <span>{t(f.label)}</span>
              <div className="ipv">
                {f.unit === "$" && <i>$</i>}
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={draft[f.key] ?? ""}
                  onChange={(e) => update({ [f.key]: e.target.value === "" ? 0 : Number(e.target.value) } as Partial<FlipProject>)}
                />
                {f.unit !== "$" && <i>{f.unit === "%" ? "%" : t("flip.mo")}</i>}
              </div>
            </label>
          ))}
        </div>
        {quoteOptions.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const j = jobs.find((x) => x.id === e.target.value);
              if (j) { update({ rehab_budget: Math.round(j.total || 0) }); showToast(t("flip.rehabFilled")); }
            }}
            style={{ marginTop: 4, fontSize: 14 }}
          >
            <option value="">{t("flip.fillFromQuote")}</option>
            {quoteOptions.map((j) => (
              <option key={j.id} value={j.id}>{j.property || j.client} — {money(j.total || 0)}</option>
            ))}
          </select>
        )}
      </div>

      <FlipComps
        comps={draft.comps}
        sqft={draft.sqft}
        onChange={(comps) => update({ comps })}
        onUseArv={(arv) => { update({ arv }); showToast(t("flip.arvFilled")); }}
      />

      {/* Cost breakdown */}
      <div className="section">
        <div className="seclabel"><Icon name="list" size={14} /> {t("flip.breakdown")}</div>
        {[
          { l: t("flip.purchase"), n: draft.purchase_price || 0 },
          { l: t("flip.rehab"), n: draft.rehab_budget || 0 },
          { l: `${t("flip.holding")} (${money(draft.holding_monthly || 0)} × ${draft.holding_months || 0} ${t("flip.mo")})`, n: a.holding },
          { l: t("flip.financing"), n: draft.financing_cost || 0 },
          { l: t("flip.contingency"), n: draft.contingency || 0 },
        ].map((r) => (
          <div key={r.l} className="drow"><span className="l">{r.l}</span><span className="v">{money(r.n)}</span></div>
        ))}
        <div className="drow"><span className="l" style={{ fontWeight: 600, color: "inherit" }}>{t("flip.allIn")}</span><span className="v" style={{ fontFamily: "Oswald", fontSize: 16 }}>{money(a.allIn)}</span></div>
        <div className="drow"><span className="l">{t("flip.arv")} − {t("flip.sellingCosts")} ({draft.selling_pct || 0}%)</span><span className="v">{money(a.netSale)}</span></div>
        <div className="drow"><span className="l" style={{ fontWeight: 600, color: "inherit" }}>{t("flip.projectedProfit")}</span><span className="v" style={{ fontFamily: "Oswald", fontSize: 16, color: v.c }}>{money(a.profit)}</span></div>
      </div>
      </>)}

      {/* Actions */}
      {activeId === null ? (
        <button className="bgold" onClick={startProject} disabled={saving} style={{ width: "100%", padding: 13, fontSize: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
          <Icon name="rocket" size={17} /> {saving ? t("flip.saving") : t("flip.start")}
        </button>
      ) : (
        <div className="section">
          <div className="seclabel"><Icon name="briefcase" size={14} /> {t("flip.project")}</div>
          <div className="drow">
            <span className="l">{t("flip.status")}</span>
            <select value={draft.status || "analyzing"} onChange={(e) => changeStatus(e.target.value as FlipStatus)} style={{ width: "auto", fontSize: 14, padding: "5px 10px" }}>
              {STATUSES.map((s) => <option key={s} value={s}>{t(`flip.st_${s}`)}</option>)}
            </select>
          </div>
          {draft.acquired_at ? (
            <div className="drow">
              <span className="l">{t("flip.boughtOn")}</span>
              <input type="date" value={toDateInput(draft.acquired_at)} max={toDateInput(new Date().toISOString())} onChange={(e) => { const d = fromDateInput(e.target.value); if (d) update({ acquired_at: d }); }} aria-label={t("flip.boughtOn")} style={{ width: "auto", fontSize: 14, padding: "5px 8px" }} />
            </div>
          ) : (
            <button className="bgold" onClick={markBought} style={{ width: "100%", margin: "8px 0 4px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Icon name="check" size={15} /> {t("flip.markBought")}
            </button>
          )}
          {draft.status === "sold" && (
            <>
              <div className="drow">
                <span className="l">{t("flip.soldOn")}</span>
                <input type="date" value={toDateInput(draft.sold_at)} onChange={(e) => { const d = fromDateInput(e.target.value); if (d) update({ sold_at: d }); }} aria-label={t("flip.soldOn")} style={{ width: "auto", fontSize: 14, padding: "5px 8px" }} />
              </div>
              <label className="ipill" style={{ margin: "6px 0 2px" }}>
                <span>{t("flip.soldPrice")}</span>
                <div className="ipv"><i>$</i><input type="number" inputMode="decimal" min={0} value={draft.sold_price ?? ""} onChange={(e) => update({ sold_price: e.target.value === "" ? null : Number(e.target.value) })} /></div>
              </label>
            </>
          )}
          <div style={{ fontSize: 12, color: "var(--color-dim)", padding: "6px 0 2px" }}>{t("flip.autosaves")}</div>
        </div>
      )}
      {/* Phase 2 hook: "Compare against another property" — render two
          analyzeFlip() results side by side from two flipProjects rows. */}
      <button onClick={removeProject} style={{ background: "none", color: "var(--color-dim)", fontSize: 13, margin: "12px auto 4px", display: "flex", alignItems: "center", gap: 5 }}>
        <Icon name={activeId ? "delete" : "refresh"} size={13} /> {activeId ? t("flip.delete") : t("flip.clear")}
      </button>
    </div>
  );
}
