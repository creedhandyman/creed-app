"use client";
/**
 * A SAVED receipt, opened again (Jobs → Receipts → tap a receipt): the store,
 * the date, every item the scan read with its price, and the total paid.
 * Read-only. A receipt saved before items were kept (or entered by hand with a
 * photo) offers to read them from its photo; that only fills in the item
 * list, never the note or the amount.
 */
import { useState } from "react";
import { Icon } from "./Icon";
import { db } from "@/lib/supabase";
import { useStore } from "@/lib/store";
import { scanReceipt } from "@/lib/receipt-scan";
import { storedItems } from "@/lib/receipt-lines";
import { isPrivatePath, signReceiptPaths } from "@/lib/receipt-storage";
import type { Receipt } from "@/lib/types";
import { t } from "@/lib/i18n";

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;

export default function ReceiptItemsSheet({ receipt, onViewPhoto, onClose }: {
  receipt: Receipt;
  /** Opens the receipt's photo; omitted when it has none. */
  onViewPhoto?: () => void;
  onClose: () => void;
}) {
  const [reading, setReading] = useState(false);
  const items = storedItems(receipt.items);
  const paths = (receipt.pages && receipt.pages.length ? receipt.pages : [receipt.photo_url]).filter(Boolean);

  const readFromPhoto = async () => {
    setReading(true);
    try {
      const signed = await signReceiptPaths(paths);
      const urls = paths.map((p) => (isPrivatePath(p) ? signed[p] : p)).filter(Boolean);
      if (!urls.length) { useStore.getState().showToast(t("jobs.receiptReadNone"), "warning"); return; }
      const scan = await scanReceipt(urls);
      const kept = storedItems(scan.items);
      if (!kept.length) { useStore.getState().showToast(t("jobs.receiptReadNone"), "warning"); return; }
      await db.patch("receipts", receipt.id, { items: kept, vendor: scan.vendor.slice(0, 80) || null });
      await useStore.getState().loadAll();
    } catch (e) {
      useStore.getState().showToast(`${t("jobs.receiptReadNone")} ${e instanceof Error ? e.message : ""}`.trim(), "warning");
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="sheet-overlay" onClick={() => { if (!reading) onClose(); }}>
      <div className="sheet cd" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
          <h3 style={{ fontFamily: "Oswald", fontSize: 18, display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Icon name="receipt" size={18} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{receipt.vendor || t("jobs.receiptSingular")}</span>
          </h3>
          <button className="bo" onClick={onClose} disabled={reading} style={{ padding: "4px 10px", flexShrink: 0 }} aria-label={t("common.close")}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="dim" style={{ fontSize: 13 }}>
          {receipt.receipt_date}
          {items.length ? ` · ${items.length} ${items.length === 1 ? t("jobs.receiptItemOne") : t("jobs.receiptItemMany")}` : ""}
        </div>

        {items.length > 0 ? (
          <div style={{ marginTop: 10, border: "1px solid var(--color-border-dark)", borderRadius: 10, padding: "4px 12px" }}>
            {items.map((it, i) => {
              const title = it.product || it.name || t("jobs.receiptItemOne");
              const printed = it.product && it.name && it.name !== it.product ? it.name : "";
              const each = typeof it.price === "number" && it.qty && it.qty > 1 ? `${money(it.price / it.qty)} ea` : "";
              const sub = [printed, it.sku ? `${t("jobs.receiptItemNo")}${it.sku}` : "", each].filter(Boolean).join(" · ");
              return (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: i ? "1px solid var(--color-border-dark)" : "none" }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 14.5, display: "block", overflowWrap: "anywhere" }}>
                      {it.qty && it.qty > 1 ? `${it.qty} × ` : ""}{title}
                    </span>
                    {sub && <span className="dim" style={{ fontSize: 12.5, display: "block", overflowWrap: "anywhere" }}>{sub}</span>}
                  </span>
                  <span style={{ flexShrink: 0, fontFamily: "Oswald", fontSize: 15 }}>{typeof it.price === "number" ? money(it.price) : "—"}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ marginTop: 12, fontSize: 14.5 }}>
            {receipt.note && <div style={{ marginBottom: 8, overflowWrap: "anywhere" }}>{receipt.note}</div>}
            <div className="dim" style={{ fontSize: 13.5 }}>{t("jobs.receiptNoItems")}</div>
            {paths.length > 0 && (
              <button className="bb" onClick={readFromPhoto} disabled={reading} style={{ width: "100%", marginTop: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: reading ? 0.6 : 1 }}>
                <Icon name="sparkle" size={15} /> {reading ? t("jobs.receiptReadingItems") : t("jobs.receiptReadItems")}
              </button>
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 12 }}>
          <span className="dim" style={{ fontSize: 13.5 }}>{t("jobs.receiptTotalPaid")}</span>
          <span style={{ fontFamily: "Oswald", fontSize: 19, color: "var(--color-success)" }}>{money(receipt.amount || 0)}</span>
        </div>

        {onViewPhoto && (
          <button className="bo" onClick={onViewPhoto} style={{ width: "100%", marginTop: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Icon name="photo" size={15} /> {t("jobs.receiptViewPhoto")}
          </button>
        )}
      </div>
    </div>
  );
}
