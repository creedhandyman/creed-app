"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { Icon } from "../Icon";
import type { TimeOffKind, TimeOffRequest } from "@/lib/types";

function num(x: unknown): number {
  const n = typeof x === "number" ? x : parseFloat(String(x ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * HR tab — single home for everything time-off-related.
 *
 * EVERYONE sees: the New Request form and their personal request history.
 * ADMINS additionally see: the pending-requests queue with inline
 * approve/deny.
 *
 * This used to be admin-only with the submission form living in personal
 * Settings → Time Off, which split the feature across two surfaces. The
 * Settings panel was retired in favor of one consolidated home here.
 */
export default function HR() {
  const user = useStore((s) => s.user);
  const timeOffRequests = useStore((s) => s.timeOffRequests) ?? [];
  const loadAll = useStore((s) => s.loadAll);
  const isAdmin = user?.role === "owner" || user?.role === "manager";

  if (!user) {
    return (
      <div className="cd">
        <p className="dim" style={{ fontSize: 12 }}>Sign in to manage time off.</p>
      </div>
    );
  }

  const myRequests = timeOffRequests
    .filter((r) => r && r.user_id === user.id)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  const pending = timeOffRequests
    .filter((r) => r && r.status === "pending")
    .sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));

  return (
    <div>
      <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 14, display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Icon name="worker" size={22} color="var(--color-primary)" />
        HR
      </h2>

      <NewRequestForm userId={user.id} userName={user.name} onSubmitted={loadAll} />

      <MyRequests requests={myRequests} />

      {isAdmin && (
        <div className="cd mb">
          <h4 style={{ fontSize: 13, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="bell" size={14} color="var(--color-warning)" />
            Pending Time Off ({pending.length})
          </h4>
          {pending.length === 0 ? (
            <p className="dim" style={{ fontSize: 12 }}>No pending requests.</p>
          ) : (
            pending.map((r) => (
              <RequestRow key={r.id} req={r} actor={user.name} onChange={loadAll} />
            ))
          )}
        </div>
      )}

      <p className="dim" style={{ fontSize: 11 }}>
        More HR features (employee notes, contacts, documents) coming soon.
      </p>
    </div>
  );
}

function NewRequestForm({
  userId, userName, onSubmitted,
}: {
  userId: string;
  userName: string;
  onSubmitted: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [kind, setKind] = useState<TimeOffKind>("vacation");
  const [hours, setHours] = useState("8");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Auto-compute hours when dates change — 8h × business days (Mon-Fri).
  // User can still override the number manually if they want a partial day.
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
      user_id: userId,
      user_name: userName,
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
      await onSubmitted();
    }
  };

  return (
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
                <option value="vacation">Vacation</option>
                <option value="personal">Personal</option>
                <option value="sick">Sick</option>
                <option value="unpaid">Unpaid</option>
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
            Your manager will review the request and approve or deny it.
          </p>
        </div>
      )}
    </div>
  );
}

function MyRequests({ requests }: { requests: TimeOffRequest[] }) {
  return (
    <div className="cd mb">
      <h4 style={{ fontSize: 13, marginBottom: 8 }}>Your Requests ({requests.length})</h4>
      {requests.length === 0 ? (
        <p className="dim" style={{ fontSize: 12 }}>No time-off requests yet.</p>
      ) : (
        requests.map((r) => (
          <div key={r.id} className="sep" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "6px 0", flexWrap: "wrap", gap: 6 }}>
            <div style={{ flex: "1 1 140px" }}>
              <span style={{ fontWeight: 600 }}>{kindLabel(r.kind)}</span>
              <span className="dim" style={{ marginLeft: 6 }}>{fmtRange(r.start_date, r.end_date)} · {num(r.hours).toFixed(0)}h</span>
              {r.reason && <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>&ldquo;{r.reason}&rdquo;</div>}
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
              {(r.status || "").toUpperCase()}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function RequestRow({
  req, actor, onChange,
}: {
  req: TimeOffRequest;
  actor: string;
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const decide = async (status: "approved" | "denied") => {
    setBusy(true);
    try {
      await db.patch("time_off_requests", req.id, {
        status,
        decided_by: actor,
        decided_at: new Date().toISOString(),
      });
      useStore.getState().showToast(`Request ${status}`, "success");
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sep" style={{ padding: "6px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, gap: 6, flexWrap: "wrap" }}>
        <div>
          <b>{req.user_name}</b>
          <span className="dim" style={{ marginLeft: 6 }}>— {kindLabel(req.kind)}</span>
        </div>
        <div className="dim" style={{ fontSize: 11, fontFamily: "Oswald" }}>
          {fmtRange(req.start_date, req.end_date)} · {num(req.hours).toFixed(0)}h
        </div>
      </div>
      {req.reason && (
        <div style={{ fontSize: 12, marginTop: 4, color: "#666" }}>&ldquo;{req.reason}&rdquo;</div>
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
