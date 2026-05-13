"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { Icon } from "../Icon";
import type { TimeOffRequest, TimeOffKind } from "@/lib/types";

/**
 * HR admin panel — lives inside Operations as a sub-tab. Owners and
 * managers manage time-off requests (approve/deny), see everyone's
 * PTO / sick balance at a glance, and credit hours when needed.
 *
 * v1 covers time-off + balance. Follow-ups flagged in the commit:
 * employee notes (kudos/warnings), emergency contacts, document
 * uploads, onboarding checklists.
 */
export default function HR() {
  const user = useStore((s) => s.user)!;
  const profiles = useStore((s) => s.profiles);
  const timeOffRequests = useStore((s) => s.timeOffRequests);
  const loadAll = useStore((s) => s.loadAll);
  const isOwner = user.role === "owner" || user.role === "manager";

  // Non-admins shouldn't reach this view via Operations gating, but
  // belt-and-suspenders: render a read-only message if they somehow do.
  if (!isOwner) {
    return (
      <div className="cd">
        <p className="dim" style={{ fontSize: 13 }}>
          HR management is restricted to owners and managers. Submit your own time-off request from Settings → Time Off.
        </p>
      </div>
    );
  }

  const pending = timeOffRequests
    .filter((r) => r.status === "pending")
    .sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));
  const upcoming = timeOffRequests
    .filter((r) => r.status === "approved" && (r.end_date || "") >= new Date().toISOString().slice(0, 10))
    .sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));
  const past = timeOffRequests
    .filter((r) => (r.status === "approved" && (r.end_date || "") < new Date().toISOString().slice(0, 10)) || r.status === "denied")
    .sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""))
    .slice(0, 20);

  return (
    <div>
      <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 14, display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Icon name="worker" size={22} color="var(--color-primary)" />
        HR
      </h2>

      {/* Pending requests — top of the page so they're the first thing
          an admin sees on the HR tab. */}
      <div className="cd mb">
        <h4 style={{ fontSize: 13, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="bell" size={14} color="var(--color-warning)" />
          Pending Time-Off Requests ({pending.length})
        </h4>
        {pending.length === 0 ? (
          <p className="dim" style={{ fontSize: 12 }}>No pending requests.</p>
        ) : (
          pending.map((r) => (
            <RequestRow key={r.id} req={r} actor={user.name} profiles={profiles} onChange={loadAll} />
          ))
        )}
      </div>

      {/* Team PTO balances + adjust */}
      <div className="cd mb">
        <h4 style={{ fontSize: 13, marginBottom: 8 }}>Team Balances</h4>
        {profiles.length === 0 ? (
          <p className="dim" style={{ fontSize: 12 }}>No employees yet.</p>
        ) : (
          profiles.map((p) => (
            <BalanceRow key={p.id} profile={p} onChange={loadAll} />
          ))
        )}
        <p className="dim" style={{ fontSize: 11, marginTop: 6 }}>
          PTO / sick hours auto-deduct on approve. Use ± to credit or adjust.
        </p>
      </div>

      {/* Upcoming approved time off */}
      <div className="cd mb">
        <h4 style={{ fontSize: 13, marginBottom: 8 }}>Upcoming Time Off ({upcoming.length})</h4>
        {upcoming.length === 0 ? (
          <p className="dim" style={{ fontSize: 12 }}>No upcoming approved time off.</p>
        ) : (
          upcoming.map((r) => (
            <div key={r.id} className="sep" style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span>{r.user_name} <span className="dim">— {kindLabel(r.kind)}</span></span>
              <span>{fmtRange(r.start_date, r.end_date)} <span className="dim">({r.hours.toFixed(0)}h)</span></span>
            </div>
          ))
        )}
      </div>

      {/* History */}
      <div className="cd">
        <h4 style={{ fontSize: 13, marginBottom: 8 }}>Recent History</h4>
        {past.length === 0 ? (
          <p className="dim" style={{ fontSize: 12 }}>No history yet.</p>
        ) : (
          past.map((r) => (
            <div key={r.id} className="sep" style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span>
                {r.user_name} <span className="dim">— {kindLabel(r.kind)}</span>
                <span style={{
                  marginLeft: 6,
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 8,
                  background: r.status === "approved" ? "var(--color-success)22" : "var(--color-accent-red)22",
                  color: r.status === "approved" ? "var(--color-success)" : "var(--color-accent-red)",
                  fontFamily: "Oswald",
                }}>
                  {r.status.toUpperCase()}
                </span>
              </span>
              <span>{fmtRange(r.start_date, r.end_date)} <span className="dim">({r.hours.toFixed(0)}h)</span></span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RequestRow({
  req, actor, profiles, onChange,
}: {
  req: TimeOffRequest;
  actor: string;
  profiles: { id: string; name: string; pto_balance_hrs?: number; sick_balance_hrs?: number }[];
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const profile = profiles.find((p) => p.id === req.user_id);

  // Compute the post-decision balance preview so the admin sees what
  // approval will do before clicking. Negative previews are flagged
  // visually but not blocked — admins can choose to grant unpaid /
  // overdraw if needed.
  const balanceKey = req.kind === "sick" ? "sick_balance_hrs" : req.kind === "unpaid" ? null : "pto_balance_hrs";
  const currentBalance = balanceKey && profile ? (profile[balanceKey] ?? 0) : null;
  const afterBalance = currentBalance !== null ? currentBalance - req.hours : null;
  const wouldOverdraw = afterBalance !== null && afterBalance < 0;

  const decide = async (status: "approved" | "denied") => {
    setBusy(true);
    try {
      await db.patch("time_off_requests", req.id, {
        status,
        decided_by: actor,
        decided_at: new Date().toISOString(),
      });
      // Deduct from balance on approve (skip for unpaid — that's the whole point).
      if (status === "approved" && balanceKey && profile && req.hours > 0) {
        const next = Math.max(0, (currentBalance ?? 0) - req.hours);
        await db.patch("profiles", req.user_id, { [balanceKey]: next });
      }
      useStore.getState().showToast(`Request ${status}`, "success");
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sep" style={{ padding: "6px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
        <div>
          <b>{req.user_name}</b>
          <span className="dim" style={{ marginLeft: 6 }}>— {kindLabel(req.kind)}</span>
        </div>
        <div className="dim" style={{ fontSize: 11, fontFamily: "Oswald" }}>
          {fmtRange(req.start_date, req.end_date)} · {req.hours.toFixed(0)}h
        </div>
      </div>
      {req.reason && (
        <div style={{ fontSize: 12, marginTop: 4, color: "#666" }}>"{req.reason}"</div>
      )}
      {balanceKey !== null && (
        <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
          Balance: {(currentBalance ?? 0).toFixed(0)}h →{" "}
          <span style={{ color: wouldOverdraw ? "var(--color-accent-red)" : "var(--color-success)" }}>
            {(afterBalance ?? 0).toFixed(0)}h
          </span>
          {wouldOverdraw && (
            <span style={{ color: "var(--color-accent-red)", marginLeft: 6 }}>
              ⚠ overdraw — will clamp to 0
            </span>
          )}
        </div>
      )}
      <div className="row" style={{ marginTop: 6, gap: 6 }}>
        <button
          className="bg"
          onClick={() => decide("approved")}
          disabled={busy}
          style={{ fontSize: 11, padding: "4px 12px" }}
        >
          {busy ? "..." : "✓ Approve"}
        </button>
        <button
          className="br"
          onClick={() => decide("denied")}
          disabled={busy}
          style={{ fontSize: 11, padding: "4px 12px" }}
        >
          {busy ? "..." : "✕ Deny"}
        </button>
      </div>
    </div>
  );
}

function BalanceRow({
  profile, onChange,
}: {
  profile: { id: string; name: string; pto_balance_hrs?: number; sick_balance_hrs?: number };
  onChange: () => Promise<void>;
}) {
  const [pto, setPto] = useState(profile.pto_balance_hrs ?? 0);
  const [sick, setSick] = useState(profile.sick_balance_hrs ?? 0);
  const [dirty, setDirty] = useState(false);

  const save = async () => {
    await db.patch("profiles", profile.id, {
      pto_balance_hrs: pto,
      sick_balance_hrs: sick,
    });
    useStore.getState().showToast(`Balances updated for ${profile.name}`, "success");
    setDirty(false);
    await onChange();
  };

  return (
    <div className="sep" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "6px 0", gap: 8, flexWrap: "wrap" }}>
      <b style={{ flex: "1 1 120px" }}>{profile.name}</b>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span className="dim" style={{ fontSize: 11 }}>PTO</span>
        <input
          type="number"
          value={pto}
          onChange={(e) => { setPto(parseFloat(e.target.value) || 0); setDirty(true); }}
          min="0"
          step="1"
          style={{ width: 56, fontSize: 12, padding: "2px 4px", textAlign: "right" }}
        />
        <span className="dim" style={{ fontSize: 11 }}>h</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span className="dim" style={{ fontSize: 11 }}>Sick</span>
        <input
          type="number"
          value={sick}
          onChange={(e) => { setSick(parseFloat(e.target.value) || 0); setDirty(true); }}
          min="0"
          step="1"
          style={{ width: 56, fontSize: 12, padding: "2px 4px", textAlign: "right" }}
        />
        <span className="dim" style={{ fontSize: 11 }}>h</span>
      </div>
      <button
        className="bb"
        onClick={save}
        disabled={!dirty}
        style={{
          fontSize: 11,
          padding: "3px 10px",
          opacity: dirty ? 1 : 0.4,
          cursor: dirty ? "pointer" : "default",
        }}
      >
        Save
      </button>
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
