"use client";
/**
 * Import store purchase prices (lib/purchase-import.ts has the rules):
 * a Home Depot Pro / Lowe's purchase history export (CSV / XLSX), or receipt
 * PDFs / photos (read by /api/prices/extract) → REVIEW of every change →
 * save. Nothing is written until Save:
 *   - price history: every purchase line of the products kept,
 *   - the org's current price per product (newest purchase only; older
 *     files never overwrite a newer price),
 *   - customer spec items that match (SKU → model → brand + name): their
 *     unit_price + date + source. Unmatched materials are never touched.
 * Owner/manager only (callers hide it otherwise; RLS enforces it).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";
import { chunkPages, fileSizeLabel, parseCsv, specFileKind } from "@/lib/spec-import";
import {
  cleanPurchaseLines, currentPriceRow, historyRows, matchSpecItems, newestPerProduct, planPriceChanges, productKey,
  sheetToPurchases, specPricePatch, type PurchaseFormat, type PurchaseLine, type SpecPriceTarget, type StoredPrice,
} from "@/lib/purchase-import";
import { loadSpecTargets, loadStoredPrices, savePurchaseImport } from "@/lib/purchase-import-client";
import { dataUriToImg, fileToBase64, imageCalls, imagesBody, photoToImg, type Img } from "@/lib/file-read";
import { getOrgId } from "@/lib/supabase";

const PDF_INLINE_MAX = 3_000_000;
const CHUNK_CHARS = 40_000;
const MAX_SCAN_PAGES = 60;

type Stage = "source" | "working" | "review";
interface AiCall { body: Record<string, unknown>; label: string; source: string }

const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `$${n.toFixed(2)}`);

export default function PurchasePriceImport({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const showToast = useStore((s) => s.showToast);
  const [stage, setStage] = useState<Stage>("source");
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState("");
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [stored, setStored] = useState<StoredPrice[]>([]);
  const [targets, setTargets] = useState<SpecPriceTarget[]>([]);
  const [missing, setMissing] = useState(false);
  const [includeTools, setIncludeTools] = useState(false);
  const [offPrice, setOffPrice] = useState<Set<string>>(new Set());
  const [offSpec, setOffSpec] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const picked = Array.from(list);
    const ok = picked.filter((f) => { const k = specFileKind(f.name, f.type); return k && k !== "xls"; });
    if (ok.length < picked.length) showToast(t("pp.unsupported"), "error");
    setFiles((cur) => [...cur, ...ok]);
  };

  const callAi = async (body: Record<string, unknown>, source: string) => {
    const res = await apiFetch("/api/prices/extract", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data?.error || t("pp.readFailed"));
    return {
      lines: cleanPurchaseLines(data.lines, source),
      notes: Array.isArray(data.notes) ? (data.notes as string[]) : [],
    };
  };

  const formatNote = (format: PurchaseFormat, name: string) =>
    format === "orders" ? t("pp.ordersOnly").replace("{name}", name) : t("pp.unknownSheet").replace("{name}", name);

  const read = async () => {
    setStage("working");
    try {
      const direct: PurchaseLine[] = [];
      const calls: AiCall[] = [];
      const planNotes: string[] = [];
      const photos: Img[] = [];
      const textCalls = (text: string, source: string) => {
        const chunks = chunkPages([text], CHUNK_CHARS);
        chunks.forEach((c, i) => calls.push({
          body: { text: c.text, fileName: source, part: chunks.length > 1 ? `part ${i + 1} of ${chunks.length}` : undefined },
          label: chunks.length > 1 ? `${source} (${i + 1}/${chunks.length})` : source, source,
        }));
      };
      const fromRows = (rows: string[][], source: string, sheetName?: string) => {
        const r = sheetToPurchases(rows, source);
        if (r.format === "hd-items" || r.format === "items") { direct.push(...r.lines); return; }
        if (r.format === "orders") { planNotes.push(formatNote("orders", sheetName ? `${source} · ${sheetName}` : source)); return; }
        // Not a layout we know: let the AI read it.
        textCalls(rows.map((row) => row.join("\t")).join("\n"), source);
      };

      for (const file of files) {
        const kind = specFileKind(file.name, file.type);
        setStatus(t("pp.opening").replace("{name}", file.name));
        if (kind === "csv" || kind === "text") {
          const text = await file.text();
          const rows = parseCsv(text);
          if (rows.length > 1 && rows.some((r) => r.length > 2)) fromRows(rows, file.name);
          else textCalls(text, file.name);
        } else if (kind === "xlsx") {
          const { readXlsxSheets } = await import("@/lib/xlsx-read");
          let sheets: Array<{ name: string; rows: string[][] }>;
          try { sheets = await readXlsxSheets(file); } catch { throw new Error(t("pp.xlsxFailed")); }
          for (const sh of sheets) fromRows(sh.rows, file.name, sh.name);
        } else if (kind === "image") {
          photos.push(await photoToImg(file));
        } else if (kind === "pdf") {
          const { readPdfPages, renderPdfPages } = await import("@/lib/parser");
          let pages: string[] = [];
          try { pages = await readPdfPages(file); } catch { /* scan */ }
          const chars = pages.reduce((n, p) => n + p.trim().length, 0);
          const hasText = pages.length > 0 && (chars > 300 || chars >= 40 * pages.length);
          if (hasText && (chars > CHUNK_CHARS || file.size > PDF_INLINE_MAX)) {
            chunkPages(pages, CHUNK_CHARS).forEach((c) => {
              const pg = c.from === c.to ? `page ${c.from}` : `pages ${c.from}-${c.to}`;
              calls.push({ body: { text: c.text, fileName: file.name, part: `${pg} of ${pages.length}` }, label: `${file.name} · ${pg}`, source: file.name });
            });
          } else if (file.size <= PDF_INLINE_MAX) {
            calls.push({ body: { pdfBase64: await fileToBase64(file), fileName: file.name }, label: file.name, source: file.name });
          } else {
            const uris = await renderPdfPages(
              file, MAX_SCAN_PAGES, 2.0,
              (i, n) => setStatus(t("pp.preparingPage").replace("{i}", String(i)).replace("{n}", String(n))),
              false, { maxDim: 1700, jpeg: 0.7 },
            );
            if (pages.length > MAX_SCAN_PAGES) planNotes.push(t("pp.scanCut").replace("{n}", String(MAX_SCAN_PAGES)).replace("{name}", file.name));
            let first = 1;
            for (const group of imageCalls(uris.map(dataUriToImg))) {
              const last = first + group.length - 1;
              const pg = first === last ? `page ${first}` : `pages ${first}-${last}`;
              calls.push({ body: { images: imagesBody(group), fileName: file.name, part: pg }, label: `${file.name} · ${pg}`, source: file.name });
              first = last + 1;
            }
          }
        }
      }
      if (photos.length) {
        const groups = imageCalls(photos);
        groups.forEach((g, i) => calls.push({
          body: { images: imagesBody(g), fileName: "photo", part: groups.length > 1 ? `photo set ${i + 1} of ${groups.length}` : undefined },
          label: groups.length > 1 ? `${t("pp.photos")} (${i + 1}/${groups.length})` : t("pp.photos"),
          source: t("pp.photos"),
        }));
      }

      const all = [...direct];
      const allNotes = [...planNotes];
      for (let i = 0; i < calls.length; i++) {
        const c = calls[i];
        setStatus(t("pp.readingPart").replace("{name}", c.label).replace("{i}", String(i + 1)).replace("{n}", String(calls.length)));
        try {
          const r = await callAi(c.body, c.source);
          all.push(...r.lines);
          allNotes.push(...r.notes.map((n) => (calls.length > 1 ? `${c.label}: ${n}` : n)));
        } catch (e) {
          allNotes.push(t("pp.partFailed").replace("{name}", c.label).replace("{msg}", e instanceof Error ? e.message : t("pp.readFailed")));
        }
      }
      if (!all.length) throw new Error(allNotes[0] || t("pp.noneFound"));

      setStatus(t("pp.comparing"));
      const keys = Array.from(new Set(all.map(productKey)));
      const [sp, tg] = await Promise.all([loadStoredPrices(keys), loadSpecTargets()]);
      setStored(sp.prices);
      setMissing(sp.missing);
      setTargets(tg);
      setLines(all);
      setNotes(allNotes);
      setOffPrice(new Set());
      setOffSpec(new Set());
      setStage("review");
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("pp.readFailed"), "error");
      setStage("source");
    } finally {
      setStatus("");
    }
  };

  // What the review shows, from the current choices.
  const counts = useMemo(() => {
    const c = { item: 0, tool: 0, return: 0, fee: 0 };
    for (const l of lines) c[l.kind]++;
    return c;
  }, [lines]);
  const included = useMemo(() => lines.filter((l) => l.kind === "item" || (includeTools && l.kind === "tool")), [lines, includeTools]);
  const changes = useMemo(() => planPriceChanges(newestPerProduct(included), stored), [included, stored]);
  const matches = useMemo(() => matchSpecItems(targets, included), [targets, included]);
  const writable = changes.filter((c) => c.action === "new" || c.action === "update");
  const unchanged = changes.length - writable.length;
  const chosenPrices = writable.filter((c) => !offPrice.has(c.key));
  const specWritable = matches.filter((m) => !m.same);
  const chosenSpec = specWritable.filter((m) => !offSpec.has(m.item.id));

  useEffect(() => {
    // Older-than-current spec matches start unticked.
    setOffSpec((cur) => {
      const next = new Set(cur);
      for (const m of matches) if (m.older) next.add(m.item.id);
      return next;
    });
  }, [matches]);

  const filterText = q.trim().toLowerCase();
  const shownChanges = filterText ? writable.filter((c) => `${c.line.description} ${c.line.sku || ""} ${c.line.model || ""}`.toLowerCase().includes(filterText)) : writable;

  const save = async () => {
    const orgId = getOrgId() || "";
    setSaving(true);
    // History: every purchase line of products that weren't unticked.
    const keep = included.filter((l) => !offPrice.has(productKey(l)));
    const res = await savePurchaseImport({
      history: historyRows(keep, orgId),
      prices: chosenPrices.map((c) => currentPriceRow(c, orgId)),
      spec: chosenSpec.map((m) => ({ id: m.item.id, patch: specPricePatch(m) })),
    });
    setSaving(false);
    if (res.ok) {
      showToast(t("pp.saved").replace("{p}", String(res.prices)).replace("{s}", String(res.specItems)).replace("{h}", String(res.history)), "success");
      onSaved?.();
      onClose();
    }
  };

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };
  const lineMeta = (l: PurchaseLine) =>
    [l.store, l.sku ? `SKU ${l.sku}` : l.model ? `#${l.model}` : "", l.date, l.job || l.po ? `${t("pp.job")} ${l.job || l.po}` : ""].filter(Boolean).join(" · ");
  const row: React.CSSProperties = { display: "flex", gap: 8, alignItems: "flex-start", padding: "7px 0", borderTop: "1px solid var(--color-border-dark)", fontSize: 13.5 };

  return (
    <div className="sheet-overlay" onClick={() => !saving && stage !== "working" && onClose()}>
      <div className="cd sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: stage === "review" ? 900 : 540, paddingTop: 20, maxHeight: "92dvh", overflowY: "auto" }}>
        <h3 style={{ fontFamily: "Oswald", fontSize: 19, textTransform: "uppercase", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="receipt" size={18} color="var(--color-primary)" /> {t("pp.title")}
        </h3>

        {stage === "source" && (
          <>
            <p className="dim" style={{ fontSize: 14, margin: "0 0 12px", lineHeight: 1.45 }}>{t("pp.body")}</p>
            <input ref={fileRef} type="file" multiple accept=".csv,.xlsx,.pdf,.txt,image/*,application/pdf,text/csv" style={{ display: "none" }}
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
              <button type="button" className="bo" onClick={() => fileRef.current?.click()} style={{ width: "auto", fontSize: 14, padding: "8px 12px" }}>
                <Icon name="upload" size={14} /> {t("pp.chooseFiles")}
              </button>
              <button type="button" className="bo" onClick={() => camRef.current?.click()} style={{ width: "auto", fontSize: 14, padding: "8px 12px" }}>
                <Icon name="camera" size={14} /> {t("pp.photoReceipt")}
              </button>
            </div>
            <div className="dim" style={{ fontSize: 12.5, marginBottom: 8, lineHeight: 1.45 }}>{t("pp.kinds")}</div>
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} style={{ ...row, alignItems: "center" }}>
                <Icon name={specFileKind(f.name, f.type) === "image" ? "photo" : "doc"} size={14} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                <span className="dim" style={{ fontSize: 12 }}>{fileSizeLabel(f.size)}</span>
                <button type="button" className="bo" onClick={() => setFiles((cur) => cur.filter((_, k) => k !== i))} style={{ width: "auto", fontSize: 13, padding: "3px 7px" }} aria-label={t("pp.removeFile")}>
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="bo" onClick={onClose} style={{ flex: 1 }}>{t("pp.cancel")}</button>
              <button className="bb" disabled={!files.length} onClick={read} style={{ flex: 1 }}>
                <Icon name="ai" size={14} /> {t("pp.read")}
              </button>
            </div>
          </>
        )}

        {stage === "working" && (
          <div style={{ padding: "28px 0", textAlign: "center" }}>
            <div className="dim" style={{ fontSize: 15 }}>{status || t("pp.reading")}</div>
            <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>{t("pp.readingHint")}</div>
          </div>
        )}

        {stage === "review" && (
          <>
            <p className="dim" style={{ fontSize: 14, margin: "0 0 6px", lineHeight: 1.45 }}>
              {t("pp.summary").replace("{n}", String(lines.length)).replace("{p}", String(changes.length))
                .replace("{skip}", String(counts.return + counts.fee))}
            </p>
            {missing && <div style={{ fontSize: 13.5, color: "var(--color-accent-red)", marginBottom: 8 }}>{t("pp.notSetUp")}</div>}
            {counts.tool > 0 && (
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, marginBottom: 6 }}>
                <input type="checkbox" checked={includeTools} onChange={(e) => setIncludeTools(e.target.checked)} />
                {t("pp.includeTools").replace("{n}", String(counts.tool))}
              </label>
            )}
            {notes.length > 0 && (
              <ul style={{ fontSize: 13, margin: "0 0 10px", paddingLeft: 18, color: "var(--color-warning)" }}>
                {notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}

            <div className="sl" style={{ marginTop: 10 }}>{t("pp.priceSection").replace("{n}", String(writable.length))}</div>
            {unchanged > 0 && <div className="dim" style={{ fontSize: 12.5, marginBottom: 4 }}>{t("pp.unchanged").replace("{n}", String(unchanged))}</div>}
            {writable.length > 12 && (
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("pp.search")} style={{ width: "100%", margin: "4px 0 6px" }} />
            )}
            {shownChanges.length === 0 && <div className="dim" style={{ fontSize: 13.5, padding: "6px 0" }}>{t("pp.noPriceChanges")}</div>}
            {shownChanges.map((c) => (
              <label key={c.key} style={{ ...row, cursor: "pointer", opacity: offPrice.has(c.key) ? 0.5 : 1 }}>
                <input type="checkbox" checked={!offPrice.has(c.key)} onChange={() => toggle(offPrice, setOffPrice, c.key)} style={{ marginTop: 3 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block" }}>{c.line.description}</span>
                  <span className="dim" style={{ display: "block", fontSize: 12 }}>{lineMeta(c.line)}</span>
                </span>
                <span style={{ fontFamily: "Oswald", fontSize: 14, textAlign: "right", flexShrink: 0 }}>
                  {c.action === "new"
                    ? <><span style={{ fontSize: 11, color: "var(--color-success)", marginRight: 5 }}>{t("pp.new")}</span>{money(c.line.unit_price)}</>
                    : <><span className="dim">{money(c.old?.unit_price)}</span> → {money(c.line.unit_price)}</>}
                </span>
              </label>
            ))}

            <div className="sl" style={{ marginTop: 14 }}>{t("pp.specSection").replace("{n}", String(specWritable.length))}</div>
            {targets.length === 0 ? (
              <div className="dim" style={{ fontSize: 13.5, padding: "6px 0" }}>{t("pp.noSpecs")}</div>
            ) : specWritable.length === 0 ? (
              <div className="dim" style={{ fontSize: 13.5, padding: "6px 0" }}>{t("pp.noSpecMatches")}</div>
            ) : specWritable.map((m) => (
              <label key={m.item.id} style={{ ...row, cursor: "pointer", opacity: offSpec.has(m.item.id) ? 0.5 : 1 }}>
                <input type="checkbox" checked={!offSpec.has(m.item.id)} onChange={() => toggle(offSpec, setOffSpec, m.item.id)} style={{ marginTop: 3 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block" }}>
                    <b>{[m.item.brand, m.item.name, m.item.model].filter(Boolean).join(" ")}</b>
                    {m.item.customer_name && <span className="dim"> · {m.item.customer_name}</span>}
                  </span>
                  <span className="dim" style={{ display: "block", fontSize: 12 }}>
                    {t(`pp.by.${m.by}`)}: {m.line.description} · {lineMeta(m.line)}
                  </span>
                  {m.older && <span style={{ display: "block", fontSize: 12, color: "var(--color-warning)" }}>{t("pp.olderThanSpec")}</span>}
                </span>
                <span style={{ fontFamily: "Oswald", fontSize: 14, textAlign: "right", flexShrink: 0 }}>
                  <span className="dim">{money(m.item.unit_price)}</span> → {money(m.line.unit_price)}
                </span>
              </label>
            ))}

            <div style={{ display: "flex", gap: 8, position: "sticky", bottom: 0, background: "var(--color-card, inherit)", paddingTop: 10, marginTop: 10 }}>
              <button className="bo" disabled={saving} onClick={() => setStage("source")} style={{ flex: 1 }}>{t("pp.back")}</button>
              <button className="bg" disabled={saving || missing || (!chosenPrices.length && !chosenSpec.length && !included.length)} onClick={save} style={{ flex: 2 }}>
                {saving ? "…" : t("pp.save").replace("{p}", String(chosenPrices.length)).replace("{s}", String(chosenSpec.length))}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
