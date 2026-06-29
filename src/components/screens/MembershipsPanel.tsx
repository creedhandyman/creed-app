"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { Icon } from "../Icon";
import { INTERVAL_LABEL, VISIT_FREQ } from "@/lib/memberships";
import type { MembershipPlan, MembershipInterval } from "@/lib/types";

/**
 * Operations → Memberships. Owners define recurring service plans here; the
 * actual enrollment (Stripe-hosted card capture) happens per-customer in
 * CustomerDetail. Plans bill via a Stripe subscription on the org's connected
 * account, so a Stripe connection is required first.
 */
const BLANK = { name: "", price: "", interval: "monthly" as MembershipInterval, visits_per_year: 12, included: "" };

export default function MembershipsPanel() {
  const org = useStore((s) => s.org);
  const plans = useStore((s) => s.membershipPlans) ?? [];
  const memberships = useStore((s) => s.customerMemberships) ?? [];
  const loadAll = useStore((s) => s.loadAll);
  const showToast = useStore((s) => s.showToast);
  const showConfirm = useStore((s) => s.showConfirm);

  const [editing, setEditing] = useState<string | null>(null); // plan id, "new", or null
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  const connected = !!org?.stripe_connected || !!org?.stripe_account_id;
  const enrolledCount = (planId: string) =>
    memberships.filter((m) => m.plan_id === planId && m.status !== "cancelled").length;

  const startNew = () => { setForm(BLANK); setEditing("new"); };
  const startEdit = (p: MembershipPlan) => {
    let included = "";
    try { included = (p.included as { description?: string } | undefined)?.description || ""; } catch { /* */ }
    setForm({ name: p.name || "", price: String(p.price ?? ""), interval: p.interval || "monthly", visits_per_year: p.visits_per_year ?? 12, included });
    setEditing(p.id);
  };

  const save = async () => {
    const name = form.name.trim();
    const price = parseFloat(form.price);
    if (!name) { showToast("Enter a plan name", "warning"); return; }
    if (!(price > 0)) { showToast("Enter a price greater than 0", "warning"); return; }
    setSaving(true);
    const payload = {
      name,
      price,
      interval: form.interval,
      visits_per_year: form.visits_per_year,
      included: { description: form.included.trim() },
      is_active: true,
    };
    if (editing === "new") {
      await db.post("membership_plans", payload);
    } else if (editing) {
      // Stripe Prices are immutable — if price/interval changed, drop the
      // cached price id so a fresh Stripe Price is created on the next enroll.
      const prev = plans.find((p) => p.id === editing);
      const priceChanged = !!prev && (Number(prev.price) !== price || prev.interval !== form.interval);
      await db.patch("membership_plans", editing, { ...payload, ...(priceChanged ? { stripe_price_id: null } : {}) });
    }
    setSaving(false);
    setEditing(null);
    await loadAll();
    showToast("Plan saved", "success");
  };

  const toggleActive = async (p: MembershipPlan) => {
    await db.patch("membership_plans", p.id, { is_active: !p.is_active });
    await loadAll();
  };

  const remove = async (p: MembershipPlan) => {
    if (enrolledCount(p.id) > 0) {
      showToast("Customers are enrolled — deactivate instead of deleting", "warning");
      return;
    }
    if (!(await showConfirm("Delete plan", `Delete "${p.name}"? This can't be undone.`))) return;
    await db.del("membership_plans", p.id);
    await loadAll();
    showToast("Plan deleted", "success");
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8 }}>
        <span className="dim" style={{ fontSize: 13 }}>Recurring service plans customers can subscribe to.</span>
        {connected && editing === null && (
          <button className="bb" style={{ fontSize: 13, padding: "6px 12px", width: "auto", flexShrink: 0 }} onClick={startNew}>
            <Icon name="add" size={14} /> New plan
          </button>
        )}
      </div>

      {!connected && (
        <div className="cd mb" style={{ textAlign: "center", padding: 18 }}>
          <Icon name="receipt" size={22} color="var(--color-warning)" />
          <div style={{ fontSize: 14, marginTop: 8, fontWeight: 600 }}>Connect Stripe to sell memberships</div>
          <div className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>
            Memberships bill through your Stripe account. Connect it under Operations → Billing first.
          </div>
        </div>
      )}

      {connected && editing !== null && (
        <div className="cd mb">
          <h4 style={{ fontSize: 15, marginBottom: 10 }}>{editing === "new" ? "New plan" : "Edit plan"}</h4>
          <label className="sl" style={{ fontSize: 13 }}>Plan name</label>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. HVAC Comfort Plan" style={{ fontSize: 15, marginBottom: 8 }} />
          <div className="g2">
            <div>
              <label className="sl" style={{ fontSize: 13 }}>Price ($)</label>
              <input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} placeholder="19" style={{ fontSize: 15 }} />
            </div>
            <div>
              <label className="sl" style={{ fontSize: 13 }}>Billed</label>
              <select value={form.interval} onChange={(e) => setForm((f) => ({ ...f, interval: e.target.value as MembershipInterval }))} style={{ fontSize: 15 }}>
                {(["monthly", "quarterly", "annual"] as MembershipInterval[]).map((i) => <option key={i} value={i}>{INTERVAL_LABEL[i]}</option>)}
              </select>
            </div>
          </div>
          <label className="sl" style={{ fontSize: 13, marginTop: 8, display: "block" }}>Service visits</label>
          <select value={form.visits_per_year} onChange={(e) => setForm((f) => ({ ...f, visits_per_year: parseInt(e.target.value) }))} style={{ fontSize: 15, marginBottom: 8 }}>
            {VISIT_FREQ.map((v) => <option key={v.visits} value={v.visits}>{v.label} ({v.visits}/yr)</option>)}
          </select>
          <label className="sl" style={{ fontSize: 13, display: "block" }}>What each visit includes (optional)</label>
          <textarea value={form.included} onChange={(e) => setForm((f) => ({ ...f, included: e.target.value }))} placeholder="e.g. Full system tune-up, filter change, 15-point inspection" style={{ fontSize: 14, minHeight: 70, width: "100%" }} />
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button className="bg" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save plan"}</button>
            <button className="bo" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      {connected && plans.length === 0 && editing === null && (
        <div className="cd" style={{ textAlign: "center", padding: 22 }}>
          <div className="dim" style={{ fontSize: 14 }}>No plans yet. Create one to start enrolling customers.</div>
        </div>
      )}

      {connected && plans.map((p) => {
        const count = enrolledCount(p.id);
        return (
          <div key={p.id} className="cd mb" style={{ opacity: p.is_active ? 1 : 0.6 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
                <div className="dim" style={{ fontSize: 12.5, marginTop: 2 }}>
                  ${Number(p.price).toFixed(2)} · {INTERVAL_LABEL[p.interval]} · {p.visits_per_year} visit{p.visits_per_year === 1 ? "" : "s"}/yr
                </div>
                <div style={{ fontSize: 12, marginTop: 3, color: count > 0 ? "var(--color-money)" : "var(--color-dim)" }}>
                  {count} enrolled{!p.is_active ? " · inactive" : ""}
                </div>
              </div>
              <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                <button className="iconbtn" title={p.is_active ? "Deactivate" : "Activate"} onClick={() => toggleActive(p)}><Icon name={p.is_active ? "pause" : "start"} size={15} /></button>
                <button className="iconbtn" title="Edit" onClick={() => startEdit(p)}><Icon name="edit" size={15} /></button>
                <button className="iconbtn" title="Delete" onClick={() => remove(p)}><Icon name="delete" size={15} color="var(--color-accent-red)" /></button>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
