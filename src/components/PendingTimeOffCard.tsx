"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { Icon } from "./Icon";
import type { TimeOffKind, TimeOffRequest } from "@/lib/types";

/** Coerce anything to a finite number for safe .toFixed. */
function num(x: unknown): number {
  const n = typeof x === "number" ? x : parseFloat(String(x ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compact admin notification surface for time-off requests. Renders
 * only for owners/managers and only when there is at least one pending
 * request — the rest of the time it stays out of the way. Approve/deny
 * are inline; once acted on the row disappears.
 */
export default function PendingTimeOffCard() {
  const user = useStore((s) => s.user);
  const timeOffRequests = useStore((s) => s.timeOffRequests) ?? [];
  const loadAll = useStore((s) => s.loadAll);

  const isAdmin = user?.role === "owner" || user?.role === "manager";
  const pending = timeOffRequests
    .filter((r) => r && r.status === "pending")
    .sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));

  if (!user || !isAdmin || pending.length === 0) return null;

  return (
    <div className="cd mb" style={{ borderLeft: "3px solid var(--color-warning)" }}>
      <h4 style={{ fontSize: 13, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="bell" size={14} color="var(--color-warning)" />
        Pending Time Off ({pending.length})
      </h4>
      {pending.map((r) => (
        <PendingRow key={r.id} req={r} actor={user.name} onChange={loadAll} />
      ))}
    </div>
  );
}

function PendingRow({
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
