"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import Payroll from "./Payroll";
import Financials from "./Financials";
import Clients from "./Clients";
import TeamSettings from "../TeamSettings";
import BillingSettings from "../BillingSettings";
import BrandingSettings from "../BrandingSettings";
import { Icon, type IconName } from "../Icon";
import { t } from "@/lib/i18n";

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
      {/* Branding & Business Info — logo, name, phone, address, license # */}
      <BrandingSettings />

      {/* Licensed Trades */}
      <div className="cd mb">
        <h4 style={{ fontSize: 14, marginBottom: 8 }}>🔑 {t("ops.licensedTrades")}</h4>
        <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>{t("ops.licensedHelp")}</div>
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
        <h4 style={{ fontSize: 14, marginBottom: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="trending" size={16} color="var(--color-primary)" />
          {t("ops.quoteSettings")}
        </h4>
        <div className="g2 mb">
          <div>
            <label className="sl">{t("ops.markup")}</label>
            <input type="number" key={`mk-${org.markup_pct}`} defaultValue={org.markup_pct || 0} min="0" step="1" placeholder="0" style={{ marginTop: 4 }}
              onBlur={async (e) => { await db.patch("organizations", org.id, { markup_pct: parseFloat(e.target.value) || 0 }); refreshOrg(); }} />
            <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{t("ops.markupHelp")}</div>
          </div>
          <div>
            <label className="sl">{t("ops.tax")}</label>
            <input type="number" key={`tx-${org.tax_pct}`} defaultValue={org.tax_pct || 0} min="0" step="0.1" placeholder="0" style={{ marginTop: 4 }}
              onBlur={async (e) => { await db.patch("organizations", org.id, { tax_pct: parseFloat(e.target.value) || 0 }); refreshOrg(); }} />
            <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{t("ops.taxHelp")}</div>
          </div>
        </div>
        <div className="g2">
          <div>
            <label className="sl">{t("ops.tripFee")}</label>
            <input type="number" key={`tf-${org.trip_fee}`} defaultValue={org.trip_fee || 0} min="0" step="5" placeholder="0" style={{ marginTop: 4 }}
              onBlur={async (e) => { await db.patch("organizations", org.id, { trip_fee: parseFloat(e.target.value) || 0 }); refreshOrg(); }} />
            <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{t("ops.tripFeeHelp")}</div>
          </div>
        </div>
      </div>

      {/* Trade Rates */}
      <div className="cd">
        <h4 style={{ fontSize: 14, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="money" size={16} color="var(--color-primary)" />
          {t("ops.customRates")}
        </h4>
        <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>{t("ops.customRatesHelp")}</div>
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

type OpsTab = "payroll" | "financials" | "clients" | "team" | "billing" | "settings";

export default function Operations({ setPage }: { setPage: (p: string) => void }) {
  const [tab, setTab] = useState<OpsTab>("payroll");

  const tabs: { id: OpsTab; label: string; icon: IconName }[] = [
    { id: "payroll",    label: t("ops.payroll"),    icon: "money" },
    { id: "financials", label: t("ops.financials"), icon: "trending" },
    { id: "clients",    label: t("ops.clients"),    icon: "clients" },
    { id: "team",       label: t("ops.team"),       icon: "worker" },
    { id: "billing",    label: t("ops.billing"),    icon: "receipt" },
    { id: "settings",   label: t("ops.settings"),   icon: "settings" },
  ];

  return (
    <div className="fi">
      <div style={{ display: "flex", gap: 3, marginBottom: 14, overflowX: "auto" }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                fontSize: 12,
                whiteSpace: "nowrap",
                background: active ? "var(--color-primary)" : "transparent",
                color: active ? "#fff" : "#888",
                fontFamily: "Oswald",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon name={t.icon} size={14} strokeWidth={active ? 2 : 1.75} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "payroll" && <Payroll />}
      {tab === "financials" && <Financials setPage={setPage} />}
      {tab === "clients" && <Clients setPage={setPage} />}
      {tab === "team" && <TeamSettings />}
      {tab === "billing" && <BillingSettings />}
      {tab === "settings" && <OpsSettings />}
    </div>
  );
}
