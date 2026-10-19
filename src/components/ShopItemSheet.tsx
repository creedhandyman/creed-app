"use client";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { searchMaterials } from "@/lib/materials-db";

/**
 * Add / edit ONE item on the work-mode shopping list (WorkVision → Guide).
 * Same feel as MaterialsSheet in the quote editor: bottom sheet, full-width
 * name with type-ahead from the materials list, −/+ quantity, price each,
 * and an editable total (qty × each; typing a total back-solves "each").
 * `c` stays the line TOTAL, as the shopping list and its $-left math expect.
 */
export interface ShopDraft { n: string; c: number; qty?: number; unitPrice?: number }

interface Props {
  item: ShopDraft | null;        // null = adding a new item
  darkMode: boolean;
  onSave: (item: ShopDraft) => void;
  onDelete?: () => void;         // edit mode only
  onClose: () => void;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function ShopItemSheet({ item, darkMode, onSave, onDelete, onClose }: Props) {
  const startQty = item?.qty && item.qty > 0 ? item.qty : 1;
  const [n, setN] = useState(item?.n || "");
  const [qty, setQty] = useState<number>(startQty);
  const [each, setEach] = useState<string>(
    item ? String(item.unitPrice ?? (item.c ? round2(item.c / startQty) : "")) : "",
  );
  const [total, setTotal] = useState<string>(item && item.c ? String(item.c) : "");
  const [focused, setFocused] = useState(!item);

  const surface = darkMode ? "#12121a" : "#fff";
  const border = darkMode ? "#262634" : "#dcdfe6";
  const ink = darkMode ? "#e8e8f0" : "#1a1a2a";
  const field: React.CSSProperties = {
    fontSize: 16, padding: "10px 11px", borderRadius: 9, border: `1px solid ${border}`,
    background: darkMode ? "#0d0d14" : "#fff", color: ink, width: "100%", minWidth: 0,
  };
  const stepBtn: React.CSSProperties = {
    width: 40, height: 42, borderRadius: 9, border: `1px solid ${border}`, background: "transparent",
    color: ink, fontSize: 20, lineHeight: 1, cursor: "pointer", flexShrink: 0,
  };

  const applyQty = (q: number) => {
    const nq = Math.max(1, round2(q));
    setQty(nq);
    const e = parseFloat(each);
    if (!isNaN(e)) setTotal(String(round2(nq * e)));
  };
  const applyEach = (raw: string) => {
    setEach(raw);
    const e = parseFloat(raw);
    setTotal(raw === "" || isNaN(e) ? "" : String(round2(qty * e)));
  };
  const applyTotal = (raw: string) => {
    setTotal(raw);
    const c = parseFloat(raw);
    if (!isNaN(c)) setEach(String(round2(c / qty)));
  };

  const query = n.trim();
  const suggestions = useMemo(
    () => (focused && query.length >= 2 ? searchMaterials(query).filter((m) => m.name.toLowerCase() !== query.toLowerCase()).slice(0, 5) : []),
    [focused, query],
  );

  const canSave = n.trim().length > 0;
  const save = () => {
    if (!canSave) return;
    const e = parseFloat(each);
    onSave({
      n: n.trim(),
      c: parseFloat(total) || 0,
      qty,
      ...(isNaN(e) ? {} : { unitPrice: e }),
    });
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,.5)" }} />
      <div
        role="dialog"
        aria-label={item ? "Edit shopping item" : "Add shopping item"}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed", left: 0, right: 0, bottom: 0, margin: "0 auto", zIndex: 1000,
          width: "100%", maxWidth: 520, maxHeight: "88dvh", overflowY: "auto",
          background: surface, color: ink, borderTop: `1px solid ${border}`, borderRadius: "18px 18px 0 0",
          boxShadow: "0 -10px 40px rgba(0,0,0,.45)",
          padding: "12px 14px calc(14px + env(safe-area-inset-bottom))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, fontFamily: "Oswald", fontWeight: 600, fontSize: 17, letterSpacing: ".04em", textTransform: "uppercase" }}>
            {item ? "Edit item" : "Add to shopping list"}
          </div>
          <button onClick={onClose} aria-label="Close" className="iconbtn"><Icon name="close" size={16} /></button>
        </div>

        <input
          value={n}
          autoFocus={!item}
          placeholder="What do you need? e.g. wax ring"
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onChange={(e) => setN(e.target.value)}
          style={field}
        />
        {suggestions.length > 0 && (
          <div style={{ marginTop: 6, border: `1px solid ${border}`, borderRadius: 9, overflow: "hidden" }}>
            {suggestions.map((s) => (
              <button
                key={s.name}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setN(s.name); setEach(String(s.price)); setTotal(String(round2(qty * s.price))); setFocused(false); }}
                style={{ display: "flex", width: "100%", justifyContent: "space-between", gap: 8, padding: "10px 11px", background: darkMode ? "#0d0d14" : "#fff", border: 0, borderBottom: `1px solid ${border}`, color: ink, fontSize: 14, textAlign: "left", textTransform: "none", fontFamily: "inherit", cursor: "pointer" }}
              >
                <span>{s.name}</span>
                <span style={{ color: "var(--color-warning)", fontFamily: "Oswald" }}>${s.price}</span>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
          <button style={stepBtn} aria-label="Less" onClick={() => applyQty(qty - 1)}>−</button>
          <input
            type="number" inputMode="decimal" aria-label="Quantity" value={qty}
            onFocus={(e) => e.target.select()}
            onChange={(e) => applyQty(parseFloat(e.target.value) || 1)}
            style={{ ...field, width: 56, flex: "0 0 56px", textAlign: "center", padding: "10px 4px" }}
          />
          <button style={stepBtn} aria-label="More" onClick={() => applyQty(qty + 1)}>+</button>
          <span className="dim" style={{ fontSize: 14 }}>×</span>
          <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
            <span className="dim" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 14 }}>$</span>
            <input
              type="number" inputMode="decimal" aria-label="Price each" value={each} placeholder="each"
              onFocus={(e) => e.target.select()}
              onChange={(e) => applyEach(e.target.value)}
              style={{ ...field, paddingLeft: 20, textAlign: "right" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <span className="dim" style={{ fontSize: 12.5 }}>Total</span>
          <div style={{ position: "relative", width: 120 }}>
            <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "var(--color-warning)" }}>$</span>
            <input
              type="number" inputMode="decimal" aria-label="Total" value={total} placeholder="0"
              onFocus={(e) => e.target.select()}
              onChange={(e) => applyTotal(e.target.value)}
              style={{ ...field, paddingLeft: 20, textAlign: "right", color: "var(--color-warning)", fontFamily: "Oswald", fontSize: 18 }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          {item && onDelete && (
            <button onClick={onDelete} className="bo" aria-label="Delete item" style={{ padding: "12px 14px", color: "var(--color-accent-red)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name="delete" size={16} /> Delete
            </button>
          )}
          <button onClick={save} disabled={!canSave} className="bg" style={{ flex: 1, padding: "12px 0", fontSize: 16, opacity: canSave ? 1 : 0.5 }}>
            {item ? "Save" : "Add to list"}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
