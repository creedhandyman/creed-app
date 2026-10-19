"use client";
/**
 * Scan → review → save a receipt for a job. Work Mode's "Scan receipt" opens
 * this; it's the same flow as the Jobs receipts screen (which works well):
 * every page is uploaded, ALL pages are scanned together as ONE receipt, the
 * AI's vendor / line items / grand total are shown for review, and Save
 * writes the receipt (with its pages) plus each priced item to
 * price_corrections so the quoting AI learns real supply costs.
 *
 * Work Mode used to save the receipt at $0 and scan it in the background:
 * the amount only came from summing item prices (never the receipt's total),
 * a scan with no items silently changed nothing, and nobody saw the result.
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { db } from "@/lib/supabase";
import { scanReceipt, receiptNote, learnFromReceipt, type ReceiptItem } from "@/lib/receipt-scan";
import { useStore } from "@/lib/store";
import { uploadReceiptPrivate } from "@/lib/receipt-storage";
import { pickReceiptPhoto, pickReceiptPhotos } from "@/lib/image";
import { t } from "@/lib/i18n";

type Item = ReceiptItem;
type Page = { path: string; url: string };

export default function ReceiptScanSheet({ job, initialFiles, onClose }: {
  job: { id: string; property?: string | null; trade?: string | null };
  /** photos already taken by the button that opened the sheet */
  initialFiles?: File[];
  onClose: () => void;
}) {
  const user = useStore((s) => s.user)!;
  const [pages, setPages] = useState<Page[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [vendor, setVendor] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [scanErr, setScanErr] = useState("");
  const started = useRef(false);

  const scan = async (urls: string[]) => {
    if (!urls.length) return;
    setScanning(true);
    setScanErr("");
    try {
      const scan = await scanReceipt(urls);
      setVendor(scan.vendor);
      setItems(scan.items);
      if (scan.total > 0) setAmount(scan.total.toFixed(2));
      const n = receiptNote(scan);
      if (n) setNote(n);
      if (!scan.items.length && !(scan.total > 0)) setScanErr(t("jobs.scannedReviewFields"));
    } catch (e) {
      setScanErr(`${t("jobs.scanFailedManual")} ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScanning(false);
    }
  };

  // Upload new pages, then re-scan the whole set as one receipt.
  const addPages = async (files: File[]) => {
    if (!files.length) return;
    setScanning(true);
    const up: Page[] = [];
    try {
      for (const f of files) up.push(await uploadReceiptPrivate(f, job.id));
    } catch (e) {
      setScanErr(`${t("wv.receiptUploadFailed")} ${e instanceof Error ? e.message : ""}`.trim());
    }
    if (!up.length) { setScanning(false); return; }
    const next = [...pages, ...up];
    setPages(next);
    await scan(next.map((p) => p.url));
  };

  useEffect(() => {
    if (started.current || !initialFiles?.length) return;
    started.current = true;
    void addPages(initialFiles);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removePage = (i: number) => {
    const next = pages.filter((_, idx) => idx !== i);
    setPages(next);
    if (next.length) void scan(next.map((p) => p.url));
    else { setItems([]); setVendor(""); }
  };

  const save = async () => {
    if (!note.trim()) { useStore.getState().showToast(t("jobs.enterReceiptNote"), "warning"); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { useStore.getState().showToast(t("jobs.enterValidAmount"), "warning"); return; }
    setSaving(true);
    try {
      const paths = pages.map((p) => p.path);
      const base = {
        job_id: job.id,
        org_id: user.org_id, // explicit — a missing org_id hides the row on refresh
        note: note.trim(),
        amount: Math.round(amt * 100) / 100,
        receipt_date: new Date().toLocaleDateString(),
        photo_url: paths[0] || "",
      };
      // `pages` may not be migrated — retry without it so the receipt still saves.
      let result = await db.post<{ id: string }>("receipts", paths.length > 1 ? { ...base, pages: paths } : base);
      if (!result && paths.length > 1) result = await db.post<{ id: string }>("receipts", base);
      if (!result) return; // db.post toasted why; keep the sheet so they can retry

      const learned = await learnFromReceipt({ vendor, items, total: amt }, job);

      await useStore.getState().loadAll();
      useStore.getState().showToast(
        `${t("jobs.receiptAdded")}${learned ? ` · ${learned} item${learned !== 1 ? "s" : ""} learned` : ""}`,
        "success",
      );
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const busy = scanning || saving;
  return (
    <div className="sheet-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div className="sheet cd" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ fontFamily: "Oswald", fontSize: 18, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icon name="receipt" size={18} /> {t("jobs.addReceipt")}
          </h3>
          <button className="bo" onClick={onClose} disabled={busy} style={{ padding: "4px 10px" }} aria-label={t("common.close")}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 7 }}>
          <button type="button" className="bo" disabled={busy} onClick={async () => { const f = await pickReceiptPhoto(true); if (f) void addPages([f]); }}
            style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 14, opacity: busy ? 0.5 : 1 }}>
            <Icon name="camera" size={15} /> {pages.length ? "Add page" : t("common.takePhoto")}
          </button>
          <button type="button" className="bo" disabled={busy} onClick={async () => { const fs = await pickReceiptPhotos(false); if (fs.length) void addPages(fs); }}
            style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 14, opacity: busy ? 0.5 : 1 }}>
            <Icon name="upload" size={15} /> {t("common.upload")}
          </button>
        </div>

        {pages.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {pages.map((p, i) => (
              <div key={p.path} style={{ position: "relative" }}>
                <img src={p.url} alt="" style={{ width: 46, height: 46, borderRadius: 7, objectFit: "cover", border: "1px solid var(--color-border-dark)" }} />
                <button onClick={() => removePage(i)} aria-label="Remove page" disabled={busy}
                  style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", background: "var(--color-accent-red)", color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                  <Icon name="close" size={10} color="#fff" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="dim" style={{ fontSize: 12.5, marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name={scanning ? "time" : "sparkle"} size={13} color={scanning ? "var(--color-warning)" : "var(--color-primary)"} />
          {scanning
            ? t("jobs.scanningReceipt")
            : pages.length > 1
              ? `${pages.length} pages — scanned as one receipt`
              : pages.length === 1
                ? "1 page · add more for a long receipt"
                : t("jobs.attachPhotoAutoScan")}
        </div>
        {scanErr && !scanning && <div style={{ fontSize: 12.5, color: "var(--color-warning)", marginTop: 6 }}>{scanErr}</div>}

        {items.length > 0 && !scanning && (
          <div style={{ marginTop: 10, border: "1px solid var(--color-border-dark)", borderRadius: 10, padding: "6px 10px", maxHeight: 220, overflowY: "auto" }}>
            {vendor && <div style={{ fontFamily: "Oswald", fontSize: 14, marginBottom: 4 }}>{vendor}</div>}
            {items.map((it, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, padding: "3px 0", borderTop: i ? "1px solid var(--color-border-dark)" : "none" }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {it.qty && it.qty > 1 ? `${it.qty} × ` : ""}{it.name || "Item"}
                </span>
                <span style={{ flexShrink: 0, fontFamily: "Oswald" }}>{typeof it.price === "number" ? `$${it.price.toFixed(2)}` : "—"}</span>
              </div>
            ))}
          </div>
        )}

        <div className="dim" style={{ fontSize: 12, marginTop: 10, marginBottom: 4 }}>Note</div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={scanning ? t("jobs.scanningShort") : t("jobs.noteVendor")} disabled={scanning} style={{ width: "100%" }} />
        <div className="dim" style={{ fontSize: 12, marginTop: 8, marginBottom: 4 }}>Total paid</div>
        <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$" disabled={scanning} style={{ width: "100%" }} />

        <button className="bg" onClick={save} disabled={busy} style={{ width: "100%", padding: 12, marginTop: 12, fontFamily: "Oswald", fontSize: 16 }}>
          {saving ? "Saving…" : scanning ? t("jobs.scanningShort") : `Save receipt${parseFloat(amount) > 0 ? ` · $${parseFloat(amount).toFixed(2)}` : ""}`}
        </button>
      </div>
    </div>
  );
}
