"use client";
import { useState } from "react";
import Payroll from "./Payroll";
import Financials from "./Financials";

export default function Operations({ setPage }: { setPage: (p: string) => void }) {
  const [tab, setTab] = useState<"payroll" | "financials" | "troubleshoot">("payroll");

  return (
    <div className="fi">
      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 3, marginBottom: 14 }}>
        {[
          { id: "payroll" as const, label: "💰 Payroll" },
          { id: "financials" as const, label: "📊 Financials" },
          { id: "troubleshoot" as const, label: "🔧 Diagnose" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "6px 14px", borderRadius: 6, fontSize: 13,
              background: tab === t.id ? "var(--color-primary)" : "transparent",
              color: tab === t.id ? "#fff" : "#888", fontFamily: "Oswald",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "payroll" && <Payroll />}
      {tab === "financials" && <Financials setPage={setPage} />}
      {tab === "troubleshoot" && (
        <div>
          <button className="bb" onClick={() => setPage("troubleshoot")} style={{ width: "100%", padding: 14, fontSize: 15 }}>
            🔧 Open AI Troubleshooter
          </button>
        </div>
      )}
    </div>
  );
}
