"use client";
/**
 * Ops → Settings: the materials sales-tax rate per ZIP (looked up
 * automatically the first time a quote uses a ZIP — lib/material-tax.ts).
 * The owner can correct a rate, add one, or remove one; an owner-set rate is
 * never replaced by a lookup.
 */
import { useState } from "react";
import { Icon } from "./Icon";
import { zipTaxMap, MAX_SANE_RATE, type ZipTaxMap } from "@/lib/material-tax";

export default function ZipTaxRates({ raw, save }: { raw: unknown; save: (u: Record<string, unknown>) => Promise<void> }) {
  const map = zipTaxMap(raw);
  const zips = Object.keys(map).sort();
  const [zip, setZip] = useState("");
  const [rate, setRate] = useState("");

  const put = async (next: ZipTaxMap) => save({ material_tax_by_zip: next });
  const setOne = async (z: string, r: number) => {
    if (!/^\d{5}$/.test(z) || !(r >= 0 && r <= MAX_SANE_RATE)) return;
    await put({ ...map, [z]: { rate: r, place: map[z]?.place, source: "owner", at: new Date().toISOString() } });
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <label className="sl">Material sales tax by ZIP</label>
      <div className="dim" style={{ fontSize: 13, margin: "2px 0 6px" }}>
        Filled in automatically from each job&apos;s ZIP (current local rate). Tap a rate to correct it.
      </div>
      {zips.length === 0 && <div className="dim" style={{ fontSize: 13, marginBottom: 6 }}>No ZIPs yet — they appear as you quote jobs.</div>}
      {zips.map((z) => (
        <div key={z} className="drow" style={{ gap: 8 }}>
          <span style={{ minWidth: 0 }}>
            <b>{z}</b>
            <span className="dim" style={{ fontSize: 12.5 }}>
              {map[z].place ? ` · ${map[z].place}` : ""} · {map[z].source === "owner" ? "set by you" : "looked up"}
            </span>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <input
              type="number" inputMode="decimal" step="0.001" min="0" max={MAX_SANE_RATE}
              key={`${z}-${map[z].rate}`} defaultValue={map[z].rate}
              onBlur={(e) => { const r = parseFloat(e.target.value); if (r !== map[z].rate) void setOne(z, r); }}
              style={{ width: 72 }} aria-label={`Tax rate for ${z}`}
            />
            <span style={{ fontSize: 13 }}>%</span>
            <button
              onClick={() => { const next = { ...map }; delete next[z]; void put(next); }}
              aria-label={`Remove ${z}`}
              style={{ background: "none", color: "var(--color-accent-red)", display: "inline-flex", padding: 2 }}
            >
              <Icon name="close" size={14} />
            </button>
          </span>
        </div>
      ))}
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <input value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" placeholder="ZIP" style={{ width: 90 }} />
        <input value={rate} onChange={(e) => setRate(e.target.value)} type="number" inputMode="decimal" step="0.001" placeholder="Rate %" style={{ width: 90 }} />
        <button
          className="bo"
          disabled={!/^\d{5}$/.test(zip) || !(parseFloat(rate) >= 0)}
          onClick={async () => { await setOne(zip, parseFloat(rate)); setZip(""); setRate(""); }}
          style={{ fontSize: 13, padding: "4px 12px" }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
