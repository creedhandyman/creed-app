"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";

export default function Payroll() {
  const user = useStore((s) => s.user)!;
  const profiles = useStore((s) => s.profiles);
  const timeEntries = useStore((s) => s.timeEntries);
  const payHistory = useStore((s) => s.payHistory);
  const loadAll = useStore((s) => s.loadAll);

  const isOwner = user.role === "owner" || user.role === "manager";
  const [sel, setSel] = useState(user.id);
  const selUser = profiles.find((u) => u.id === sel) || user;

  const entries = timeEntries.filter(
    (e) => e.user_id === sel || (sel === user.id && !e.user_id && e.user_name === user.name)
  );
  const totalHrs = entries.reduce((s, e) => s + (e.hours || 0), 0);
  const totalPay = totalHrs * (selUser.rate || 55);

  // Group by job
  const byJob: Record<string, number> = {};
  entries.forEach((e) => {
    byJob[e.job || "General"] = (byJob[e.job || "General"] || 0) + (e.hours || 0);
  });

  const processPay = async () => {
    if (!entries.length) return;
    await db.post("pay_history", {
      user_id: sel,
      name: selUser.name,
      pay_date: new Date().toLocaleDateString(),
      hours: totalHrs,
      amount: totalPay,
      entries: entries.length,
    });
    alert(`Processed: ${selUser.name} — $${totalPay.toFixed(2)}`);
    loadAll();
  };

  const userPayHistory = payHistory.filter((p) => p.user_id === sel);

  return (
    <div className="fi">
      <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 14 }}>
        💰 Payroll
      </h2>

      {/* Employee selector */}
      {isOwner && (
        <div className="cd mb">
          <div className="row">
            <span className="dim" style={{ fontSize: 12 }}>Employee:</span>
            <select
              value={sel}
              onChange={(e) => setSel(e.target.value)}
              style={{ flex: 1 }}
            >
              {profiles.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} (${u.rate}/hr)
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div className="cd" style={{ textAlign: "center" }}>
          <div className="sl">Hours</div>
          <div className="sv" style={{ color: "var(--color-primary)" }}>{totalHrs.toFixed(1)}</div>
        </div>
        <div className="cd" style={{ textAlign: "center" }}>
          <div className="sl">Rate</div>
          <div className="sv">${selUser.rate || 55}/hr</div>
        </div>
        <div className="cd" style={{ textAlign: "center" }}>
          <div className="sl">Total</div>
          <div className="sv" style={{ color: "var(--color-success)" }}>${totalPay.toFixed(2)}</div>
        </div>
      </div>

      {/* By Job */}
      <div className="cd mb">
        <div className="row">
          <h4 style={{ fontSize: 13 }}>By Job</h4>
          <div style={{ flex: 1 }} />
          {isOwner && (
            <button
              className="bg"
              onClick={processPay}
              style={{ fontSize: 10, padding: "5px 12px" }}
            >
              Process Pay
            </button>
          )}
        </div>
        {Object.keys(byJob).length === 0 ? (
          <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>No time entries</p>
        ) : (
          Object.entries(byJob).map(([job, hrs]) => (
            <div
              key={job}
              className="sep"
              style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}
            >
              <span>{job}</span>
              <span>
                {hrs.toFixed(1)}h →{" "}
                <span style={{ color: "var(--color-success)" }}>
                  ${(hrs * (selUser.rate || 55)).toFixed(2)}
                </span>
              </span>
            </div>
          ))
        )}
      </div>

      {/* Payment History */}
      {userPayHistory.length > 0 && (
        <div className="cd">
          <h4 style={{ fontSize: 13, marginBottom: 6 }}>Payment History</h4>
          {userPayHistory.map((p) => (
            <div
              key={p.id}
              className="sep"
              style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}
            >
              <span>{p.pay_date}</span>
              <span>{(p.hours || 0).toFixed(1)}h</span>
              <span style={{ color: "var(--color-success)" }}>${(p.amount || 0).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
