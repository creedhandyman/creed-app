"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { Icon } from "./Icon";
import type { TimeOffRequest, TimeOffKind } from "@/lib/types";

/**
 * Personal Time Off panel — rendered inside Settings so every user
 * (admin or employee) can submit their own request and see their own
 * balance + history. Admins also have the HR tab in Operations for
 * managing requests across the team; this panel is the personal side.
 */
export default function TimeOffSettings() {
  const user = useStore((s) => s.user)!;
  const profiles = useStore((s) => s.profiles);
  const timeOffRequests = useStore((s) => s.timeOffRequests);
  const loadAll = useStore((s) => s.loadAll);

  // Pull our own balances off the profiles list (server-of-truth). The
  // `user` object in the store is the auth user, which may not carry
  // the HR fields. The matching profile row does.
  const myProfile = profiles.find((p) => p.id === user.id);
  const ptoBalance = myProfile?.pto_balance_hrs ?? 0;
  const sickBalance = myProfile?.sick_balance_hrs ?? 0;

  const myRequests = timeOffRequests
    .filter((r) => r.user_id === user.id)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [kind, setKind] = useState<TimeOffKind>("vacation");
  const [hours, setHours] = useState("8");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Auto-compute hours when the user picks dates — 8h × business days
  // (Mon-Fri). User can still override the number manually.
  const recomputeHours = (s: string, e: string) => {
    if (!s || !e) return;
    const sd = new Date(s + "T00:00:00");
    const ed = new Date(e + "T00:00:00");
    if (isNaN(sd.getTime()) || isNaN(ed.getTime()) || ed < sd) return;
    let businessDays = 0;
    for (let d = new Date(sd); d <= ed; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) businessDays++;
    }
    setHours(String(businessDays * 8));
  };

  const submit = async () => {
    if (!start || !end) {
      useStore.getState().showToast("Pick start and end dates", "warning");
      return;
    }
    if (end < start) {
      useStore.getState().showToast("End date can't be before start", "warning");
      return;
    }
    const hoursNum = parseFloat(hours) || 0;
    if (hoursNum <= 0) {
      useStore.getState().showToast("Enter the hours requested", "warning");
      return;
    }
    setBusy(true);
    const result = await db.post<TimeOffRequest>("time_off_requests", {
      user_id: user.id,
      user_name: user.name,
      start_date: start,
      end_date: end,
      hours: hoursNum,
      kind,
      reason: reason.trim() || null,
      status: "pending",
    });
    setBusy(false);
    if (result !== null) {
      useStore.getState().showToast("Time-off request submitted", "success");
      setStart(today); setEnd(today); setKind("vacation"); setHours("8"); setReason("");
      setOpen(false);
      await loadAll();
    }
  };

  return (
    <div>
      {/* Balances */}
      <div className="cd mb">
        <h4 style={{ fontSize: 13, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="schedule" size={14} color="var(--color-primary)" />
          Your Balances
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="cd" style={{ textAlign: "center", padding: 12 }}>
            <div className="sl">PTO</div>
            <div className="sv" style={{ color: "var(--color-primary)" }}>{ptoBalance.toFixed(0)}h</div>
          </div>
          <div className="cd" style={{ textAlign: "center", padding: 12 }}>
            <div className="sl">Sick</div>
            <div className="sv" style={{ color: "var(--color-warning)" }}>{sickBalance.toFixed(0)}h</div>
          </div>
        </div>
      </div>

      {/* New request form (collapsible) */}
      <div className="cd mb">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h4 style={{ fontSize: 13 }}>Request Time Off</h4>
          <button
            className="bb"
            onClick={() => setOpen(!open)}
            style={{ fontSize: 12, padding: "4px 12px" }}
          >
            {open ? "Cancel" : "+ New Request"}
          </button>
        </div>
        {open && (
          <div style={{ marginTop: 10 }}>
            <div className="g2 mb">
              <div>
                <label style={{ fontSize: 10 }} className="dim">Start date</label>
                <input
                  type="date"
                  value={start}
                  onChange={(e) => { setStart(e.target.value); recomputeHours(e.target.value, end); }}
                  style={{ fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 10 }} className="dim">End date</label>
                <input
                  type="date"
                  value={end}
                  onChange={(e) => { setEnd(e.target.value); recomputeHours(start, e.target.value); }}
                  style={{ fontSize: 13 }}
                />
              </div>
            </div>
            <div className="g2 mb">
              <div>
                <label style={{ fontSize: 10 }} className="dim">Kind</label>
                <select value={kind} onChange={(e) => setKind(e.target.value as TimeOffKind)} style={{ fontSize: 13 }}>
                  <option value="vacation">Vacation (deducts PTO)</option>
                  <option value="personal">Personal (deducts PTO)</option>
                  <option value="sick">Sick (deducts Sick)</option>
                  <option value="unpaid">Unpaid (no deduction)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10 }} className="dim">Hours requested</label>
                <input
                  type="number"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  min="0"
                  step="0.5"
                  style={{ fontSize: 13 }}
                />
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 10 }} className="dim">Reason (optional)</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Out of town for a wedding"
                style={{ fontSize: 13 }}
              />
            </div>
            <button
              className="bg"
              onClick={submit}
              disabled={busy}
              style={{ width: "100%", fontSize: 13, padding: "6px 12px", opacity: busy ? 0.5 : 1 }}
            >
              {busy ? "Submitting..." : "Submit Request"}
            </button>
            <p className="dim" style={{ fontSize: 11, marginTop: 6 }}>
              Your manager will review the request and approve or deny it. Hours auto-deduct on approve.
            </p>
          </div>
        )}
      </div>

      {/* My requests */}
      <div className="cd">
        <h4 style={{ fontSize: 13, marginBottom: 8 }}>Your Requests ({myRequests.length})</h4>
        {myRequests.length === 0 ? (
          <p className="dim" style={{ fontSize: 12 }}>No time-off requests yet.</p>
        ) : (
          myRequests.map((r) => (
            <div key={r.id} className="sep" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "6px 0", flexWrap: "wrap", gap: 6 }}>
              <div style={{ flex: "1 1 140px" }}>
                <span style={{ fontWeight: 600 }}>{kindLabel(r.kind)}</span>
                <span className="dim" style={{ marginLeft: 6 }}>{fmtRange(r.start_date, r.end_date)} · {r.hours.toFixed(0)}h</span>
                {r.reason && <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>"{r.reason}"</div>}
              </div>
              <span style={{
                fontSize: 10,
                padding: "2px 8px",
                borderRadius: 8,
                background: r.status === "approved" ? "var(--color-success)22"
                          : r.status === "denied" ? "var(--color-accent-red)22"
                          : "var(--color-warning)22",
                color: r.status === "approved" ? "var(--color-success)"
                     : r.status === "denied" ? "var(--color-accent-red)"
                     : "var(--color-warning)",
                fontFamily: "Oswald",
                letterSpacing: ".05em",
              }}>
                {r.status.toUpperCase()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function kindLabel(kind: TimeOffKind): string {
  return kind === "vacation" ? "Vacation"
       : kind === "sick" ? "Sick"
       : kind === "personal" ? "Personal"
       : "Unpaid";
}

function fmtRange(start: string, end: string): string {
  if (!start) return "";
  if (start === end) return fmt(start);
  return `${fmt(start)} → ${fmt(end)}`;
}

function fmt(d: string): string {
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return d; }
}
