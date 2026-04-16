"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import Payroll from "./Payroll";
import Financials from "./Financials";
import Clients from "./Clients";

function OpsSettings() {
  const org = useStore((s) => s.org);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);

  if (!org) return null;

  const refreshOrg = async () => {
    await loadAll();
    const orgs = await db.get("organizations", { id: org.id });
    if (orgs.length) useStore.getState().setOrg(orgs[0] as never);
  };

  const tradeRates: Record<string, number> = (() => {
    try { return org.trade_rates ? JSON.parse(org.trade_rates) : {}; } catch { return {}; }
  })();

  let licensed: string[] = [];
  try { licensed = org.licensed_trades ? JSON.parse(org.licensed_trades) : []; } catch { /* */ }

  return (
    <div>
      {/* Licensed Trades */}
      <div className="cd mb">
        <h4 style={{ fontSize: 14, marginBottom: 8 }}>🔑 Licensed Trades</h4>
        <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>AI will fully quote licensed trades instead of flagging for subcontractors.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {["Electrical", "Plumbing", "HVAC", "Roofing", "Gas Fitting", "Fire Protection", "Structural", "Asbestos/Mold"].map((trade) => {
            const isLicensed = licensed.includes(trade);
            return (
              <label
                key={trade}
                onClick={async () => {
                  const updated = isLicensed ? licensed.filter((t) => t !== trade) : [...licensed, trade];
                  await db.patch("organizations", org.id, { licensed_trades: JSON.stringify(updated) });
                  refreshOrg();
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "5px 8px",
                  borderRadius: 6, cursor: "pointer", fontSize: 12,
                  background: isLicensed ? "var(--color-success)15" : "transparent",
                  border: `1px solid ${isLicensed ? "var(--color-success)" : darkMode ? "#1e1e2e" : "#ddd"}`,
                }}
              >
                <span style={{ fontSize: 14, color: isLicensed ? "var(--color-success)" : "#555" }}>{isLicensed ? "☑" : "☐"}</span>
                {trade}
              </label>
            );
          })}
        </div>
      </div>

      {/* Quote Settings */}
      <div className="cd mb">
        <h4 style={{ fontSize: 14, marginBottom: 12 }}>📊 Quote Settings</h4>
        <div className="g2 mb">
          <div>
            <label className="sl">Markup %</label>
            <input type="number" key={`mk-${org.markup_pct}`} defaultValue={org.markup_pct || 0} min="0" step="1" placeholder="0" style={{ marginTop: 4 }}
              onBlur={async (e) => { await db.patch("organizations", org.id, { markup_pct: parseFloat(e.target.value) || 0 }); refreshOrg(); }} />
            <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>Applied to material costs</div>
          </div>
          <div>
            <label className="sl">Tax %</label>
            <input type="number" key={`tx-${org.tax_pct}`} defaultValue={org.tax_pct || 0} min="0" step="0.1" placeholder="0" style={{ marginTop: 4 }}
              onBlur={async (e) => { await db.patch("organizations", org.id, { tax_pct: parseFloat(e.target.value) || 0 }); refreshOrg(); }} />
            <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>Applied to quote total</div>
          </div>
        </div>
        <div className="g2">
          <div>
            <label className="sl">Trip Fee ($)</label>
            <input type="number" key={`tf-${org.trip_fee}`} defaultValue={org.trip_fee || 0} min="0" step="5" placeholder="0" style={{ marginTop: 4 }}
              onBlur={async (e) => { await db.patch("organizations", org.id, { trip_fee: parseFloat(e.target.value) || 0 }); refreshOrg(); }} />
            <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>Once per day on-site</div>
          </div>
        </div>
      </div>

      {/* Trade Rates */}
      <div className="cd">
        <h4 style={{ fontSize: 14, marginBottom: 8 }}>💰 Custom Rates by Trade</h4>
        <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>Set hourly rates per trade for quotes.</div>
        {["Plumbing", "Electrical", "Carpentry", "HVAC", "Painting", "Flooring", "General"].map((trade) => (
          <div key={trade} className="row" style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 12, width: 80 }}>{trade}</span>
            <span>$</span>
            <input type="number" key={`${trade}-${tradeRates[trade] || ""}`} defaultValue={tradeRates[trade] || ""} placeholder="55" min="0" step="1" style={{ width: 70, fontSize: 12 }}
              onBlur={async (e) => {
                const val = parseFloat(e.target.value);
                const updated = { ...tradeRates };
                if (val && val > 0) updated[trade] = val; else delete updated[trade];
                await db.patch("organizations", org.id, { trade_rates: JSON.stringify(updated) }); refreshOrg();
              }} />
            <span style={{ fontSize: 11 }}>/hr</span>
            {tradeRates[trade] && <span style={{ fontSize: 12, color: "var(--color-success)" }}>✓</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Operations({ setPage }: { setPage: (p: string) => void }) {
  const [tab, setTab] = useState<"payroll" | "financials" | "clients" | "settings">("payroll");

  return (
    <div className="fi">
      <div style={{ display: "flex", gap: 3, marginBottom: 14, overflowX: "auto" }}>
        {[
          { id: "payroll" as const, label: "💰 Payroll" },
          { id: "financials" as const, label: "📊 Financials" },
          { id: "clients" as const, label: "👥 Clients" },
          { id: "settings" as const, label: "⚙️ Settings" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "6px 12px", borderRadius: 6, fontSize: 12, whiteSpace: "nowrap",
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
      {tab === "settings" && <OpsSettings />}
    </div>
  );
}
