"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Icon } from "./Icon";
import { t } from "@/lib/i18n";

type Preset = "month" | "lastMonth" | "year" | "lastYear" | "all" | "custom";
type Files = { invoices: string; payments: string; expenses: string; customers: string };

const p2 = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

function presetRange(p: Preset): { from: string; to: string } {
  const n = new Date();
  const y = n.getFullYear(), m = n.getMonth();
  if (p === "month") return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  if (p === "lastMonth") return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
  if (p === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (p === "lastYear") return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  return { from: "", to: "" };
}

function download(name: string, text: string) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function QuickBooksExportSheet({ onClose }: { onClose: () => void }) {
  const showToast = useStore((s) => s.showToast);
  const [preset, setPreset] = useState<Preset>("month");
  const [custom, setCustom] = useState(presetRange("month"));
  const [busy, setBusy] = useState<keyof Files | null>(null);

  const range = preset === "custom" ? custom : presetRange(preset);
  const stamp = preset === "all" ? "all-time" : `${range.from}_to_${range.to}`;

  const get = async (key: keyof Files) => {
    if (preset === "custom" && (!custom.from || !custom.to || custom.from > custom.to)) {
      showToast(t("qb.badRange"), "error");
      return;
    }
    setBusy(key);
    try {
      const res = await apiFetch("/api/export/quickbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(range),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || res.statusText);
      download(`creed-${key}-${stamp}.csv`, (data as Files)[key]);
    } catch (e) {
      showToast(`${t("qb.failed")}: ${e instanceof Error ? e.message : ""}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const presets: { id: Preset; label: string }[] = [
    { id: "month", label: t("qb.thisMonth") },
    { id: "lastMonth", label: t("qb.lastMonth") },
    { id: "year", label: t("qb.thisYear") },
    { id: "lastYear", label: t("qb.lastYear") },
    { id: "all", label: t("qb.allTime") },
    { id: "custom", label: t("qb.custom") },
  ];
  const files: { key: keyof Files; label: string; icon: string }[] = [
    { key: "invoices", label: t("qb.invoices"), icon: "receipt" },
    { key: "payments", label: t("qb.payments"), icon: "download" },
    { key: "expenses", label: t("qb.expenses"), icon: "receipt" },
    { key: "customers", label: t("qb.customers"), icon: "download" },
  ];

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet cd" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ fontFamily: "Oswald", fontSize: 18, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icon name="download" size={18} /> {t("qb.title")}
          </h3>
          <button className="bo" onClick={onClose} style={{ padding: "4px 10px" }} aria-label={t("common.close")}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <p style={{ fontSize: 14, opacity: 0.8, marginBottom: 12 }}>{t("qb.intro")}</p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {presets.map((p) => (
            <button key={p.id} className={preset === p.id ? "bb" : "bo"} onClick={() => setPreset(p.id)} style={{ padding: "6px 12px", fontSize: 14 }}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="g2 mb">
            <label style={{ fontSize: 13 }}>{t("qb.from")}
              <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            </label>
            <label style={{ fontSize: 13 }}>{t("qb.to")}
              <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </label>
          </div>
        )}

        <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
          {files.map((f) => (
            <button key={f.key} className="bb" disabled={busy !== null} onClick={() => get(f.key)}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: busy && busy !== f.key ? 0.6 : 1 }}>
              <Icon name={f.icon} size={16} /> {busy === f.key ? t("qb.preparing") : f.label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 12, opacity: 0.65, marginTop: 12 }}>{t("qb.hint")}</p>
      </div>
    </div>
  );
}
