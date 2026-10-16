"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { searchMaterials } from "@/lib/materials-db";
import type { Material } from "@/lib/types";

/**
 * Materials editor for ONE quote line (= one work-order task), opened from the
 * MAT cell in QuoteForge's line list. A bottom sheet with one card per
 * material: full-width name (with type-ahead from the curated MATERIALS_DB),
 * a −/+ quantity stepper, unit price and line total. Replaces the cramped
 * 4-tiny-inputs-per-row modal.
 *
 * Math stays the same as before: editing qty or unit price sets
 * total = qty × unit; typing a total directly back-solves the unit price.
 * Blank rows are dropped on close; a line always keeps at least one
 * material row (the "Materials $0" placeholder), as the old editor did.
 */
interface Props {
  title: string;
  materials: Material[];
  darkMode: boolean;
  onChange: (mats: Material[]) => void;
  onClose: () => void;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function MaterialsSheet({ title, materials, darkMode, onChange, onClose }: Props) {
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const [pendingFocus, setPendingFocus] = useState<number | null>(null);
  const nameRefs = useRef<(HTMLInputElement | null)[]>([]);

  const surface = darkMode ? "#12121a" : "#fff";
  const card = darkMode ? "#191924" : "#f5f6f9";
  const border = darkMode ? "#262634" : "#dcdfe6";
  const ink = darkMode ? "#e8e8f0" : "#1a1a2a";

  // The placeholder row a line gets when it has no real materials.
  const isPlaceholder = (m: Material) => (m.n === "Materials" || !m.n.trim()) && !m.c;
  const rows = materials.length === 1 && isPlaceholder(materials[0]) && materials[0].n === "Materials" ? [] : materials;
  const total = rows.reduce((s, m) => s + (Number(m.c) || 0), 0);

  useEffect(() => {
    if (pendingFocus !== null) {
      nameRefs.current[pendingFocus]?.focus();
      setPendingFocus(null);
    }
  }, [pendingFocus, rows.length]);

  const setRow = (i: number, next: Material) => {
    const mats = [...rows];
    mats[i] = next;
    onChange(mats);
  };

  const setQty = (i: number, q: number) => {
    const next: Material = { ...rows[i], qty: Math.max(0, round2(q)) };
    if (next.unitPrice !== undefined) next.c = round2((next.qty || 0) * next.unitPrice);
    setRow(i, next);
  };

  const setUnit = (i: number, raw: string) => {
    const next: Material = { ...rows[i] };
    if (raw === "") { delete next.unitPrice; setRow(i, next); return; }
    const u = parseFloat(raw) || 0;
    const q = next.qty && next.qty > 0 ? next.qty : 1;
    next.unitPrice = u;
    next.qty = q;
    next.c = round2(q * u);
    setRow(i, next);
  };

  const setTotal = (i: number, raw: string) => {
    const c = raw === "" ? 0 : parseFloat(raw) || 0;
    const next: Material = { ...rows[i], c };
    if (next.qty && next.qty > 0) next.unitPrice = round2(c / next.qty);
    setRow(i, next);
  };

  const add = () => {
    onChange([...rows, { n: "", qty: 1, c: 0 }]);
    setPendingFocus(rows.length);
  };

  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));

  const close = () => {
    const kept = rows.filter((m) => m.n.trim() || Number(m.c) > 0);
    onChange(kept.length ? kept : [{ n: "Materials", c: 0 }]);
    onClose();
  };

  const query = focusIdx !== null ? (rows[focusIdx]?.n || "").trim() : "";
  const suggestions = useMemo(
    () => (query.length >= 2 ? searchMaterials(query).filter((m) => m.name.toLowerCase() !== query.toLowerCase()).slice(0, 5) : []),
    [query],
  );

  const pick = (i: number, name: string, price: number) => {
    const q = rows[i].qty && rows[i].qty! > 0 ? rows[i].qty! : 1;
    setRow(i, { ...rows[i], n: name, unitPrice: price, qty: q, c: round2(q * price) });
    setFocusIdx(null);
  };

  const fieldStyle: React.CSSProperties = {
    fontSize: 16, padding: "9px 10px", borderRadius: 9, border: `1px solid ${border}`,
    background: darkMode ? "#0d0d14" : "#fff", color: ink, width: "100%", minWidth: 0,
  };
  const stepBtn: React.CSSProperties = {
    width: 38, height: 40, borderRadius: 9, border: `1px solid ${border}`, background: "transparent",
    color: ink, fontSize: 20, lineHeight: 1, cursor: "pointer", flexShrink: 0,
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 199, background: "rgba(0,0,0,.5)" }} />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Materials"
        style={{
          position: "fixed", left: 0, right: 0, bottom: 0, margin: "0 auto", zIndex: 200,
          width: "100%", maxWidth: 520, maxHeight: "88dvh", display: "flex", flexDirection: "column",
          background: surface, color: ink, borderTop: `1px solid ${border}`, borderRadius: "18px 18px 0 0",
          boxShadow: "0 -10px 40px rgba(0,0,0,.45)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "12px 14px 10px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 17, letterSpacing: ".04em", textTransform: "uppercase" }}>Materials</div>
            <div className="dim" style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
          </div>
          <button onClick={close} aria-label="Close" className="iconbtn" style={{ flexShrink: 0 }}>
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* Rows */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 9 }}>
          {rows.length === 0 && (
            <div className="dim" style={{ textAlign: "center", fontSize: 14, padding: "18px 8px" }}>
              No materials on this line yet. Tap <b>Add material</b> below.
            </div>
          )}
          {rows.map((m, i) => (
            <div key={i} style={{ background: card, border: `1px solid ${border}`, borderRadius: 12, padding: 10 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", position: "relative" }}>
                <input
                  ref={(el) => { nameRefs.current[i] = el; }}
                  value={m.n}
                  placeholder="What material? e.g. GFCI outlet"
                  onFocus={() => setFocusIdx(i)}
                  onBlur={() => setTimeout(() => setFocusIdx((f) => (f === i ? null : f)), 150)}
                  onChange={(e) => setRow(i, { ...m, n: e.target.value })}
                  style={{ ...fieldStyle, flex: 1 }}
                />
                <button onClick={() => remove(i)} aria-label={`Remove ${m.n || "material"}`} style={{ ...stepBtn, color: "var(--color-accent-red)", fontSize: 16 }}>
                  <Icon name="delete" size={16} />
                </button>
              </div>
              {focusIdx === i && suggestions.length > 0 && (
                <div style={{ marginTop: 6, border: `1px solid ${border}`, borderRadius: 9, overflow: "hidden" }}>
                  {suggestions.map((s) => (
                    <button
                      key={s.name}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(i, s.name, s.price)}
                      style={{ display: "flex", width: "100%", justifyContent: "space-between", gap: 8, padding: "9px 10px", background: darkMode ? "#0d0d14" : "#fff", border: 0, borderBottom: `1px solid ${border}`, color: ink, fontSize: 14, textAlign: "left", cursor: "pointer" }}
                    >
                      <span>{s.name}</span>
                      <span style={{ color: "var(--color-warning)", fontFamily: "Oswald" }}>${s.price}</span>
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
                <button style={stepBtn} aria-label="Less" onClick={() => setQty(i, Math.max(1, (m.qty || 1) - 1))}>−</button>
                <input
                  type="number"
                  inputMode="decimal"
                  aria-label="Quantity"
                  value={m.qty === undefined || m.qty === null ? "" : m.qty}
                  placeholder="1"
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => (e.target.value === "" ? setRow(i, (() => { const n = { ...m }; delete n.qty; return n; })()) : setQty(i, parseFloat(e.target.value) || 0))}
                  onBlur={() => { if (!m.qty || m.qty <= 0) setQty(i, 1); }}
                  style={{ ...fieldStyle, width: 52, flex: "0 0 52px", textAlign: "center", padding: "9px 4px" }}
                />
                <button style={stepBtn} aria-label="More" onClick={() => setQty(i, (m.qty || 1) + 1)}>+</button>
                <span className="dim" style={{ fontSize: 14 }}>×</span>
                <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
                  <span className="dim" style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", fontSize: 14 }}>$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    aria-label="Price each"
                    value={m.unitPrice === undefined || m.unitPrice === null ? "" : m.unitPrice}
                    placeholder="each"
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setUnit(i, e.target.value)}
                    style={{ ...fieldStyle, paddingLeft: 18, textAlign: "right" }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 7 }}>
                <span className="dim" style={{ fontSize: 12.5 }}>Line total</span>
                <div style={{ position: "relative", width: 110 }}>
                  <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "var(--color-warning)" }}>$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    aria-label="Line total"
                    value={m.c === 0 ? "" : m.c}
                    placeholder="0"
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setTotal(i, e.target.value)}
                    style={{ ...fieldStyle, paddingLeft: 18, textAlign: "right", color: "var(--color-warning)", fontFamily: "Oswald", fontSize: 17 }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "10px 12px calc(10px + env(safe-area-inset-bottom))", borderTop: `1px solid ${border}`, display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={add} className="bo" style={{ width: "100%", padding: "11px 0", fontSize: 15, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Icon name="add" size={16} /> Add material
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div className="dim" style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".06em" }}>Materials total</div>
              <div style={{ fontFamily: "Oswald", fontSize: 22, color: "var(--color-warning)", lineHeight: 1.1 }}>${total.toFixed(2)}</div>
            </div>
            <button onClick={close} className="bg" style={{ flex: 1, padding: "12px 0", fontSize: 16 }}>Done</button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
