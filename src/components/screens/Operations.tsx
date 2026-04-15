"use client";
import { useState } from "react";
import Payroll from "./Payroll";
import Financials from "./Financials";
import Clients from "./Clients";

export default function Operations({ setPage }: { setPage: (p: string) => void }) {
  const [tab, setTab] = useState<"payroll" | "financials" | "clients">("payroll");

  return (
    <div className="fi">
      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 3, marginBottom: 14 }}>
        {[
          { id: "payroll" as const, label: "💰 Payroll" },
          { id: "financials" as const, label: "📊 Financials" },
          { id: "clients" as const, label: "👥 Clients" },
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
      {tab === "clients" && <Clients setPage={setPage} />}
    </div>
  );
}
