"use client";
import { useState } from "react";
import Recurring from "./Recurring";
import MembershipsPanel from "./MembershipsPanel";

/**
 * Ops → Recurring & Plans. Two related "set it and forget it" automations
 * under one tab: cadence-driven recurring JOBS, and auto-billed membership
 * service PLANS. A segmented toggle switches between them.
 */
export default function RecurringMemberships() {
  const [view, setView] = useState<"recurring" | "memberships">("recurring");
  return (
    <div>
      <div style={{ display: "flex", gap: 4, background: "#0d0d15", borderRadius: 10, padding: 3, marginBottom: 14, border: "1px solid var(--color-border-dark)" }}>
        {([
          { key: "recurring", label: "Recurring jobs" },
          { key: "memberships", label: "Memberships" },
        ] as const).map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            style={{
              flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 13.5,
              fontFamily: "Oswald, sans-serif", textTransform: "uppercase", letterSpacing: ".04em",
              background: view === v.key ? "var(--color-primary)" : "transparent",
              color: view === v.key ? "#fff" : "var(--color-dim)",
              border: "none", cursor: "pointer",
            }}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "recurring" ? <Recurring /> : <MembershipsPanel />}
    </div>
  );
}
