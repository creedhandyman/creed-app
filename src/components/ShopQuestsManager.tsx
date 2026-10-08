"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { Icon } from "./Icon";
import {
  CUSTOM_QUEST_METRICS, parseQuestConfig, questCycleKey,
  type CustomQuest, type CustomQuestMetric,
} from "@/lib/quests";
import type { Organization } from "@/lib/types";

/**
 * Owner/manager editor for the shop's own quests ("Shop Quests" tier on the
 * Quests screen). Saved into organizations.quest_config `_custom` beside the
 * built-in toggles, so the shared quest engine (lib/quests) tracks progress
 * per tech per cycle and Payroll offers the bonus for approval like any other
 * quest. "manual" quests have no automatic tracking — the owner taps who did
 * it this cycle.
 */
interface Draft { id?: string; name: string; desc: string; metric: CustomQuestMetric; goal: string; bonus: string }
const EMPTY: Draft = { name: "", desc: "", metric: "jobs_completed", goal: "10", bonus: "50" };

export default function ShopQuestsManager({ cycleStart }: { cycleStart: Date }) {
  const user = useStore((s) => s.user)!;
  const org = useStore((s) => s.org);
  const profiles = useStore((s) => s.profiles);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = user.role === "owner" || user.role === "manager";
  if (!isAdmin || !org) return null;

  const { custom } = parseQuestConfig(org.quest_config);
  const cycleKey = questCycleKey(cycleStart);
  const toast = useStore.getState().showToast;
  const metricOf = (k: CustomQuestMetric) => CUSTOM_QUEST_METRICS.find((m) => m.key === k);

  // Read-modify-write from the FRESH row so a toggle in Settings → Quest
  // Bonuses (same JSON) made elsewhere isn't overwritten by a stale copy.
  const save = async (next: (list: CustomQuest[]) => CustomQuest[]) => {
    setBusy(true);
    try {
      const rows = await db.get<Organization>("organizations", { id: org.id });
      const fresh = rows[0] || org;
      const { config, custom: cur } = parseQuestConfig(fresh.quest_config);
      const updated = { ...config, _custom: next(cur) };
      if (!await db.patch("organizations", org.id, { quest_config: JSON.stringify(updated) })) return false;
      useStore.getState().setOrg({ ...fresh, quest_config: JSON.stringify(updated) });
      return true;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    const goal = Math.round(parseFloat(draft.goal));
    const bonus = Math.round(parseFloat(draft.bonus));
    if (!name) { toast("Give the quest a name", "warning"); return; }
    if (draft.metric !== "manual" && !(goal > 0)) { toast("Set a goal (how many)", "warning"); return; }
    if (!(bonus >= 0)) { toast("Set the bonus amount", "warning"); return; }
    const q: CustomQuest = {
      id: draft.id || crypto.randomUUID().slice(0, 8),
      name, desc: draft.desc.trim() || undefined,
      metric: draft.metric, goal: draft.metric === "manual" ? 1 : goal, bonus, enabled: true,
    };
    const ok = await save((list) => draft.id
      ? list.map((x) => (x.id === draft.id ? { ...x, ...q, enabled: x.enabled, done: x.done } : x))
      : [...list, q]);
    if (ok) { toast(draft.id ? "Quest updated" : "Quest added — your crew sees it now", "success"); setDraft(null); }
  };

  const crew = profiles.filter((p) => p.status !== "pending");

  return (
    <div className="cd mb" style={{ padding: 13, border: "1px solid rgba(157,78,221,.45)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "Oswald", fontWeight: 600, fontSize: 15, textTransform: "uppercase", letterSpacing: ".05em" }}>
          <Icon name="trophy" size={16} color="var(--color-violet)" /> Shop quests
        </div>
        {!draft && (
          <button className="bb" style={{ fontSize: 13, padding: "6px 12px", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }} onClick={() => setDraft({ ...EMPTY })}>
            <Icon name="add" size={13} /> New quest
          </button>
        )}
      </div>
      <div className="dim" style={{ fontSize: 12.5, marginBottom: 8 }}>
        Your own goals for the crew. Progress is tracked per person for this cycle, and finished quests show up in Payroll for you to approve the bonus.
      </div>

      {draft && (
        <div style={{ border: "1px solid var(--color-border-dark-2)", borderRadius: 12, padding: 11, marginBottom: 10 }}>
          <label className="sl">Quest name</label>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Truck Captain" maxLength={40} style={{ marginBottom: 8 }} />
          <label className="sl">Description <span className="dim">· optional</span></label>
          <input value={draft.desc} onChange={(e) => setDraft({ ...draft, desc: e.target.value })} placeholder="e.g. Keep your truck stocked and clean all month" maxLength={120} style={{ marginBottom: 8 }} />
          <label className="sl">What counts</label>
          <select value={draft.metric} onChange={(e) => setDraft({ ...draft, metric: e.target.value as CustomQuestMetric })} style={{ marginBottom: 8 }}>
            {CUSTOM_QUEST_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <div className="g2" style={{ marginBottom: 10 }}>
            {draft.metric !== "manual" ? (
              <div>
                <label className="sl">Goal ({metricOf(draft.metric)?.unit})</label>
                <input type="number" inputMode="numeric" min="1" value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} />
              </div>
            ) : (
              <div className="dim" style={{ fontSize: 12, alignSelf: "center" }}>You'll tap who earned it, below.</div>
            )}
            <div>
              <label className="sl">Bonus ($)</label>
              <input type="number" inputMode="numeric" min="0" value={draft.bonus} onChange={(e) => setDraft({ ...draft, bonus: e.target.value })} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="bo" style={{ flex: 1 }} onClick={() => setDraft(null)} disabled={busy}>Cancel</button>
            <button className="bg" style={{ flex: 2 }} onClick={submit} disabled={busy}>{busy ? "Saving…" : draft.id ? "Save changes" : "Add quest"}</button>
          </div>
        </div>
      )}

      {custom.length === 0 && !draft && (
        <div className="dim" style={{ fontSize: 13, padding: "4px 0" }}>No shop quests yet — tap New quest to make one.</div>
      )}

      {custom.map((q) => {
        const m = metricOf(q.metric);
        return (
          <div key={q.id} style={{ borderTop: "1px solid var(--color-border-dark)", padding: "9px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox" checked={q.enabled !== false} disabled={busy}
                aria-label={`${q.name} on/off`}
                onChange={() => { void save((list) => list.map((x) => (x.id === q.id ? { ...x, enabled: x.enabled === false } : x))); }}
                style={{ width: "auto", accentColor: "var(--color-violet)" }}
              />
              <div style={{ flex: 1, minWidth: 0, opacity: q.enabled === false ? 0.45 : 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{q.name} <span style={{ color: "#ffd76b", fontFamily: "Oswald" }}>${q.bonus}</span></div>
                <div className="dim" style={{ fontSize: 12 }}>
                  {q.metric === "manual" ? "Marked by you" : `${m?.label}: ${q.goal} ${m?.unit}`}{q.desc ? ` · ${q.desc}` : ""}
                </div>
              </div>
              <button className="iconbtn" aria-label={`Edit ${q.name}`} disabled={busy}
                onClick={() => setDraft({ id: q.id, name: q.name, desc: q.desc || "", metric: q.metric, goal: String(q.goal), bonus: String(q.bonus) })}>
                <Icon name="edit" size={15} />
              </button>
              <button className="iconbtn" aria-label={`Delete ${q.name}`} disabled={busy}
                onClick={async () => {
                  if (!await useStore.getState().showConfirm("Delete quest", `Delete "${q.name}"? Bonuses already paid stay paid.`)) return;
                  void save((list) => list.filter((x) => x.id !== q.id));
                }}>
                <Icon name="delete" size={15} />
              </button>
            </div>
            {q.metric === "manual" && q.enabled !== false && crew.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7, paddingLeft: 26 }}>
                <span className="dim" style={{ fontSize: 11.5, width: "100%" }}>Earned it this cycle — tap to mark:</span>
                {crew.map((p) => {
                  const mark = `${p.id}@${cycleKey}`;
                  const on = (q.done || []).includes(mark);
                  return (
                    <button key={p.id} disabled={busy}
                      onClick={() => { void save((list) => list.map((x) => x.id !== q.id ? x : { ...x, done: on ? (x.done || []).filter((d) => d !== mark) : [...(x.done || []), mark] })); }}
                      style={{ fontSize: 12.5, padding: "4px 10px", borderRadius: 99, cursor: "pointer", border: `1px solid ${on ? "var(--color-success)" : "var(--color-border-dark-2)"}`, background: on ? "rgba(0,204,102,.15)" : "transparent", color: on ? "var(--color-success)" : "inherit", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {on && <Icon name="check" size={12} />}{p.name.split(" ")[0]}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
