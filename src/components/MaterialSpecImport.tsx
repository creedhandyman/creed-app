"use client";
/**
 * Import a customer's material spec (docs/claude/customer-material-specs.md):
 * PDFs, spreadsheets (.xlsx every sheet / .csv), photos of a spec sheet, or
 * pasted text → items → REVIEW TABLE (edit / add / remove rows) → save.
 *
 * How each kind is read (lib/spec-import.ts has the pure rules):
 *   - sheets: a sheet with recognizable headers maps straight across (no AI);
 *     other sheets go to the AI as text, in chunks (`planSheets`).
 *   - PDFs with text: small ones go to the AI whole; long ones are read page
 *     by page and sent in chunks (`chunkPages`). Scanned PDFs: small ones go
 *     whole (the AI reads the scan), big ones are rendered to page images and
 *     sent a few pages at a time.
 *   - photos: shrunk, then sent a few at a time.
 * Every part's results are merged and de-duplicated (`mergeDrafts`).
 *
 * NOTHING is saved until the owner taps Save on the review table: then the
 * spec + its items are written, and only after that the original files are
 * uploaded to the private spec-files bucket and listed on the spec.
 * Owner/manager only (the card hides it otherwise, RLS enforces it).
 */
import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";
import {
  blankDraft, chunkPages, cleanDrafts, fileSizeLabel, mergeDrafts, parseCsv, planSheets,
  savableDrafts, specFileKind, SPEC_TRADES, type SpecDraft,
} from "@/lib/spec-import";
import { createSpec, saveDrafts, storeSpecFiles, type MaterialSpec } from "@/lib/material-spec-client";
import { dataUriToImg, fileToBase64, imageCalls, imagesBody, photoToImg, type Img } from "@/lib/file-read";

/** PDFs up to this size go to the AI whole (base64 must fit Vercel's body cap). */
const PDF_INLINE_MAX = 3_000_000;
/** A text PDF with more text than this is read in chunks instead. */
const CHUNK_CHARS = 40_000;
/** Scanned pages rendered for a big scanned PDF (the rest are noted). */
const MAX_SCAN_PAGES = 60;
interface Props {
  customerId: string;
  customerName: string;
  specs: MaterialSpec[];
  /** Pre-select an existing spec to add to / replace. */
  initialSpecId?: string;
  onClose: () => void;
  onSaved: () => void;
}

type Stage = "source" | "working" | "review";
interface Row { key: number; d: SpecDraft }
interface AiCall { body: Record<string, unknown>; label: string }

export default function MaterialSpecImport({ customerId, customerName, specs, initialSpecId, onClose, onSaved }: Props) {
  const showToast = useStore((s) => s.showToast);
  const [stage, setStage] = useState<Stage>("source");
  const [target, setTarget] = useState<string>(initialSpecId || "new");
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [newName, setNewName] = useState(`${customerName} spec`);
  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [usedAi, setUsedAi] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef(0);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const picked = Array.from(list);
    const bad = picked.filter((f) => !specFileKind(f.name, f.type));
    if (bad.length) showToast(t("spec.unsupported").replace("{name}", bad.map((f) => f.name).join(", ")), "error");
    setFiles((cur) => [...cur, ...picked.filter((f) => specFileKind(f.name, f.type))]);
  };

  const callAi = async (body: Record<string, unknown>): Promise<{ items: SpecDraft[]; notes: string[]; cut: boolean }> => {
    const res = await apiFetch("/api/specs/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data?.error || t("spec.readFailed"));
    return { items: cleanDrafts(data.items), notes: Array.isArray(data.notes) ? data.notes : [], cut: !!data.cut };
  };

  /** Turn every file (and the paste) into direct drafts + AI calls. */
  const plan = async (): Promise<{ direct: SpecDraft[]; calls: AiCall[]; notes: string[] }> => {
    const direct: SpecDraft[] = [];
    const calls: AiCall[] = [];
    const planNotes: string[] = [];
    const photos: Img[] = [];

    const textCalls = (text: string, fileName: string) => {
      const chunks = chunkPages([text], CHUNK_CHARS);
      chunks.forEach((c, i) => calls.push({
        body: { text: c.text, fileName, part: chunks.length > 1 ? `part ${i + 1} of ${chunks.length}` : undefined },
        label: chunks.length > 1 ? `${fileName || t("spec.sourcePasted")} (${i + 1}/${chunks.length})` : fileName || t("spec.sourcePasted"),
      }));
    };
    const sheetCalls = (sheets: Array<{ name: string; rows: string[][] }>, fileName: string) => {
      const p = planSheets(sheets, CHUNK_CHARS);
      direct.push(...p.drafts);
      p.aiTexts.forEach((text, i) => calls.push({
        body: { text, fileName, part: p.aiTexts.length > 1 ? `part ${i + 1} of ${p.aiTexts.length}` : undefined },
        label: p.aiTexts.length > 1 ? `${fileName} (${i + 1}/${p.aiTexts.length})` : fileName,
      }));
    };

    for (const file of files) {
      const kind = specFileKind(file.name, file.type);
      setStatus(t("spec.openingFile").replace("{name}", file.name));
      if (kind === "xls") throw new Error(t("spec.xlsOld"));
      if (kind === "csv") {
        sheetCalls([{ name: "", rows: parseCsv(await file.text()) }], file.name);
      } else if (kind === "text") {
        const text = await file.text();
        const r = parseCsv(text);
        if (r.length > 1 && r[0].length > 1) sheetCalls([{ name: "", rows: r }], file.name);
        else textCalls(text, file.name);
      } else if (kind === "xlsx") {
        const { readXlsxSheets } = await import("@/lib/xlsx-read");
        let sheets: Array<{ name: string; rows: string[][] }>;
        try { sheets = await readXlsxSheets(file); } catch { throw new Error(t("spec.xlsxFailed")); }
        sheetCalls(sheets, file.name);
      } else if (kind === "image") {
        photos.push(await photoToImg(file));
      } else if (kind === "pdf") {
        const { readPdfPages, renderPdfPages } = await import("@/lib/parser");
        let pages: string[] = [];
        try { pages = await readPdfPages(file); } catch { /* unreadable text layer: treat as a scan */ }
        const chars = pages.reduce((n, p) => n + p.trim().length, 0);
        const hasText = pages.length > 0 && (chars > 500 || chars >= 40 * pages.length);
        if (hasText && chars > CHUNK_CHARS) {
          // Long text PDF: page by page, in chunks.
          const chunks = chunkPages(pages, CHUNK_CHARS);
          chunks.forEach((c) => {
            const pg = c.from === c.to ? `page ${c.from}` : `pages ${c.from}-${c.to}`;
            calls.push({ body: { text: c.text, fileName: file.name, part: `${pg} of ${pages.length}` }, label: `${file.name} · ${pg}` });
          });
        } else if (file.size <= PDF_INLINE_MAX) {
          // Whole document in one call (keeps table layout; reads scans too).
          // If the AI runs out of room on it, the text is read in chunks instead.
          calls.push({ body: { pdfBase64: await fileToBase64(file), fileName: file.name, fallbackPages: hasText ? pages : undefined }, label: file.name });
        } else if (hasText) {
          const chunks = chunkPages(pages, CHUNK_CHARS);
          chunks.forEach((c) => {
            const pg = c.from === c.to ? `page ${c.from}` : `pages ${c.from}-${c.to}`;
            calls.push({ body: { text: c.text, fileName: file.name, part: `${pg} of ${pages.length}` }, label: `${file.name} · ${pg}` });
          });
        } else {
          // Big scanned PDF: render pages to images, a few per call.
          const uris = await renderPdfPages(
            file, MAX_SCAN_PAGES, 2.0,
            (i, n) => setStatus(t("spec.preparingPage").replace("{i}", String(i)).replace("{n}", String(n))),
            false, { maxDim: 1700, jpeg: 0.7 },
          );
          if (!uris.length) throw new Error(t("spec.pdfNoText"));
          if (pages.length > MAX_SCAN_PAGES) {
            planNotes.push(t("spec.scanCut").replace("{n}", String(MAX_SCAN_PAGES)).replace("{name}", file.name));
          }
          let first = 1;
          for (const group of imageCalls(uris.map(dataUriToImg))) {
            const last = first + group.length - 1;
            const pg = first === last ? `page ${first}` : `pages ${first}-${last}`;
            calls.push({
              body: { images: imagesBody(group), fileName: file.name, part: `${pg} of ${pages.length || uris.length}` },
              label: `${file.name} · ${pg}`,
            });
            first = last + 1;
          }
        }
      }
    }

    if (photos.length) {
      const groups = imageCalls(photos);
      groups.forEach((g, i) => calls.push({
        body: { images: imagesBody(g), part: groups.length > 1 ? `photo set ${i + 1} of ${groups.length}` : undefined },
        label: groups.length > 1 ? `${t("spec.photos")} (${i + 1}/${groups.length})` : t("spec.photos"),
      }));
    }

    if (pasted.trim()) {
      const r = parseCsv(pasted);
      if (r.length > 1 && r[0].length > 1) sheetCalls([{ name: "", rows: r }], t("spec.sourcePasted"));
      else textCalls(pasted, "");
    }
    return { direct, calls, notes: planNotes };
  };

  const read = async () => {
    setStage("working");
    try {
      const p = await plan();
      const lists: SpecDraft[][] = [p.direct];
      const allNotes = [...p.notes];
      let failures = 0;
      const many = p.calls.length > 1;
      for (let i = 0; i < p.calls.length; i++) {
        const c = p.calls[i];
        setStatus(many
          ? t("spec.readingPart").replace("{i}", String(i + 1)).replace("{n}", String(p.calls.length)).replace("{name}", c.label)
          : t("spec.reading"));
        const { fallbackPages, ...body } = c.body as { fallbackPages?: string[] } & Record<string, unknown>;
        try {
          let r = await callAi(body);
          if (r.cut && fallbackPages?.length) {
            // The whole PDF was too long for one answer: read its text in chunks.
            const chunks = chunkPages(fallbackPages, CHUNK_CHARS / 2);
            const parts: SpecDraft[][] = [];
            const partNotes: string[] = [];
            for (let k = 0; k < chunks.length; k++) {
              setStatus(t("spec.readingPart").replace("{i}", String(k + 1)).replace("{n}", String(chunks.length)).replace("{name}", c.label));
              const ch = chunks[k];
              const pg = ch.from === ch.to ? `page ${ch.from}` : `pages ${ch.from}-${ch.to}`;
              const rr = await callAi({ text: ch.text, fileName: body.fileName, part: `${pg} of ${fallbackPages.length}` });
              parts.push(rr.items);
              partNotes.push(...rr.notes);
            }
            r = { items: mergeDrafts(parts), notes: partNotes, cut: false };
          }
          lists.push(r.items);
          allNotes.push(...r.notes.map((n) => (many ? `${c.label}: ${n}` : n)));
        } catch (e) {
          failures++;
          allNotes.push(t("spec.partFailed").replace("{name}", c.label).replace("{msg}", e instanceof Error ? e.message : t("spec.readFailed")));
        }
      }
      if (p.calls.length && failures === p.calls.length && !p.direct.length) throw new Error(allNotes[allNotes.length - 1] || t("spec.readFailed"));
      const items = mergeDrafts(lists);
      if (!items.length) throw new Error(t("spec.noneFound"));
      setUsedAi(p.calls.length > 0);
      setRows(items.map((d) => ({ key: ++keyRef.current, d })));
      setNotes(allNotes);
      setStage("review");
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("spec.readFailed"), "error");
      setStage("source");
    } finally {
      setStatus("");
    }
  };

  const edit = (key: number, patch: Partial<SpecDraft>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, d: { ...r.d, ...patch } } : r)));
  const removeRow = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  const addRow = () => setRows((rs) => [...rs, { key: ++keyRef.current, d: blankDraft() }]);

  const chosen = savableDrafts(rows.map((r) => r.d));
  const priceNeeded = chosen.filter((d) => d.unit_price == null).length;

  const save = async () => {
    if (!chosen.length) return;
    setSaving(true);
    let spec = specs.find((s) => s.id === target) || null;
    const source = files.map((f) => f.name).join(", ").slice(0, 200) || (pasted.trim() ? t("spec.sourcePasted") : null);
    if (!spec) spec = await createSpec(customerId, newName, source);
    if (!spec) { setSaving(false); return; }
    const n = await saveDrafts(spec, chosen, target === "new" ? "add" : mode);
    if (n > 0) {
      // Only now, after the owner confirmed and the items are saved, keep the originals.
      if (files.length) {
        const r = await storeSpecFiles(spec, files);
        if (r.notSetUp) showToast(t("spec.filesNotSetUp"), "info");
        else if (r.failed.length) showToast(t("spec.filesFailed").replace("{names}", r.failed.join(", ")), "info");
      }
      showToast(t("spec.saved").replace("{n}", String(n)), "success");
      setSaving(false);
      onSaved();
      return;
    }
    setSaving(false);
  };

  const num = (v: string): number | null => {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return v.trim() && Number.isFinite(n) && n >= 0 ? n : null;
  };
  const cell: React.CSSProperties = { fontSize: 14, padding: "6px 8px", minWidth: 0, width: "100%" };
  const lab: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 2, fontSize: 11, color: "var(--color-dim)", minWidth: 0 };
  const txt = (key: number, field: keyof SpecDraft, label: string, value: string | null, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label style={lab}>
      {label}
      <input value={value || ""} onChange={(e) => edit(key, { [field]: e.target.value || null } as Partial<SpecDraft>)} style={cell} {...extra} />
    </label>
  );
  const numIn = (key: number, field: "unit_price" | "pack_size" | "coverage", label: string, value: number | null, warn = false) => (
    <label style={lab}>
      {label}
      <input
        defaultValue={value == null ? "" : String(value)}
        onBlur={(e) => {
          const n = num(e.target.value);
          edit(key, { [field]: field === "unit_price" ? n : n && n > 0 ? n : null } as Partial<SpecDraft>);
        }}
        inputMode="decimal"
        style={{ ...cell, borderColor: warn ? "var(--color-warning)" : undefined }}
        placeholder={warn ? t("spec.f.priceNeeded") : undefined}
      />
    </label>
  );

  return (
    <div className="sheet-overlay" onClick={() => !saving && stage !== "working" && onClose()}>
      <div className="cd sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: stage === "review" ? 1080 : 540, paddingTop: 20, maxHeight: "92dvh", overflowY: "auto" }}>
        <h3 style={{ fontFamily: "Oswald", fontSize: 19, textTransform: "uppercase", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="package" size={18} color="var(--color-primary)" /> {t("spec.importTitle")}
        </h3>

        {stage === "source" && (
          <>
            <p className="dim" style={{ fontSize: 14, margin: "0 0 12px", lineHeight: 1.45 }}>{t("spec.importBody").replace("{name}", customerName)}</p>

            {specs.length > 0 && (
              <>
                <label className="sl">{t("spec.saveInto")}</label>
                <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: "100%", marginBottom: 8 }}>
                  <option value="new">{t("spec.newSpec")}</option>
                  {specs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {target !== "new" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
                    <button type="button" className={mode === "add" ? "bb" : "bo"} onClick={() => setMode("add")} style={{ fontSize: 14, padding: "8px 6px" }}>{t("spec.modeAdd")}</button>
                    <button type="button" className={mode === "replace" ? "bb" : "bo"} onClick={() => setMode("replace")} style={{ fontSize: 14, padding: "8px 6px" }}>{t("spec.modeReplace")}</button>
                  </div>
                )}
              </>
            )}
            {target === "new" && (
              <>
                <label className="sl">{t("spec.specName")}</label>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} style={{ width: "100%", marginBottom: 10 }} />
              </>
            )}

            <label className="sl">{t("spec.fileLabel")}</label>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.xlsx,.xls,.csv,.txt,.tsv,image/*,application/pdf,text/csv,text/plain"
              style={{ display: "none" }}
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
            />
            <input
              ref={camRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
              <button type="button" className="bo" onClick={() => fileRef.current?.click()} style={{ width: "auto", fontSize: 14, padding: "8px 12px" }}>
                <Icon name="upload" size={14} /> {t("spec.chooseFile")}
              </button>
              <button type="button" className="bo" onClick={() => camRef.current?.click()} style={{ width: "auto", fontSize: 14, padding: "8px 12px" }}>
                <Icon name="camera" size={14} /> {t("spec.takePhoto")}
              </button>
            </div>
            <div className="dim" style={{ fontSize: 12.5, marginBottom: 8 }}>{t("spec.fileKinds")}</div>
            {files.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, padding: "4px 0", borderTop: "1px solid var(--color-border-dark)" }}>
                    <Icon name={specFileKind(f.name, f.type) === "image" ? "photo" : "doc"} size={14} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    <span className="dim" style={{ fontSize: 12 }}>{fileSizeLabel(f.size)}</span>
                    <button type="button" className="bo" onClick={() => setFiles((cur) => cur.filter((_, k) => k !== i))} style={{ width: "auto", fontSize: 13, padding: "3px 7px" }} aria-label={t("spec.clearFile")}>
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <label className="sl">{t("spec.pasteLabel")}</label>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={files.length ? 3 : 6}
              placeholder={t("spec.pastePlaceholder")}
              style={{ width: "100%", fontSize: 14, marginBottom: 12 }}
            />

            <div style={{ display: "flex", gap: 8 }}>
              <button className="bo" onClick={onClose} style={{ flex: 1 }}>{t("spec.cancel")}</button>
              <button className="bb" disabled={!files.length && pasted.trim().length < 3} onClick={read} style={{ flex: 1 }}>
                <Icon name="ai" size={14} /> {t("spec.readButton")}
              </button>
            </div>
          </>
        )}

        {stage === "working" && (
          <div style={{ padding: "28px 0", textAlign: "center" }}>
            <div className="dim" style={{ fontSize: 15 }}>{status || t("spec.reading")}</div>
            <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>{t("spec.readingHint")}</div>
          </div>
        )}

        {stage === "review" && (
          <>
            <p className="dim" style={{ fontSize: 14, margin: "0 0 8px", lineHeight: 1.45 }}>
              {(usedAi ? t("spec.reviewBodyAi") : t("spec.reviewBodySheet")).replace("{n}", String(rows.length))}
            </p>
            {priceNeeded > 0 && (
              <div style={{ fontSize: 13.5, color: "var(--color-warning)", marginBottom: 8 }}>
                {t("spec.priceNeededCount").replace("{n}", String(priceNeeded))}
              </div>
            )}
            {notes.length > 0 && (
              <ul style={{ fontSize: 13, margin: "0 0 10px", paddingLeft: 18, color: "var(--color-warning)" }}>
                {notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}

            <datalist id="spec-trades">{SPEC_TRADES.map((tr) => <option key={tr} value={tr} />)}</datalist>
            <div role="table" aria-label={t("spec.title")} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
              {rows.map(({ key, d }, i) => (
                <div role="row" key={key} style={{ border: "1px solid var(--color-border-dark)", borderRadius: 8, padding: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 6 }}>
                    <span className="dim" style={{ fontSize: 12, width: 22, textAlign: "right", paddingBottom: 9, flexShrink: 0 }}>{i + 1}</span>
                    <label style={{ ...lab, flex: 1 }}>
                      {t("spec.f.name")}
                      <input
                        value={d.name}
                        onChange={(e) => edit(key, { name: e.target.value })}
                        style={{ ...cell, fontWeight: 600, borderColor: d.name.trim() ? undefined : "var(--color-accent-red)" }}
                        autoFocus={!d.name && i === rows.length - 1}
                      />
                    </label>
                    <button type="button" className="bo" onClick={() => removeRow(key)} aria-label={t("spec.removeRow")} title={t("spec.removeRow")}
                      style={{ width: "auto", padding: "7px 9px", color: "var(--color-accent-red)", borderColor: "var(--color-accent-red)", flexShrink: 0 }}>
                      <Icon name="delete" size={14} />
                    </button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(128px, 1fr))", gap: 6 }}>
                    {txt(key, "brand", t("spec.f.brand"), d.brand)}
                    {txt(key, "model", t("spec.f.model"), d.model)}
                    {txt(key, "sku", t("spec.f.sku"), d.sku)}
                    {txt(key, "trade", t("spec.f.trade"), d.trade, { list: "spec-trades" })}
                    {txt(key, "category", t("spec.f.category"), d.category)}
                    {txt(key, "store", t("spec.f.store"), d.store)}
                    {txt(key, "unit", t("spec.f.unit"), d.unit)}
                    {numIn(key, "unit_price", t("spec.f.price"), d.unit_price, d.unit_price == null)}
                    {txt(key, "pack_label", t("spec.f.packLabel"), d.pack_label)}
                    {numIn(key, "pack_size", t("spec.f.packSize"), d.pack_size)}
                    {numIn(key, "coverage", t("spec.f.coverage"), d.coverage)}
                    {txt(key, "coverage_unit", t("spec.f.coverageUnit"), d.coverage_unit)}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 6, marginTop: 6 }}>
                    <label style={lab}>
                      {t("spec.f.keywords")}
                      <input
                        defaultValue={d.keywords.join(", ")}
                        onBlur={(e) => edit(key, { keywords: e.target.value.split(/[,;]/).map((k) => k.trim()).filter(Boolean).slice(0, 12) })}
                        style={cell}
                      />
                    </label>
                    {txt(key, "notes", t("spec.f.notes"), d.notes)}
                  </div>
                  {d.companions.length > 0 && (
                    <div className="dim" style={{ fontSize: 12.5, marginTop: 6 }}>
                      {t("spec.companionsLine")}: {d.companions.map((c) => `${c.qty} ${c.name} / ${c.per}`).join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button type="button" className="bo" onClick={addRow} style={{ marginBottom: 12 }}>
              <Icon name="add" size={14} /> {t("spec.addRow")}
            </button>

            <div style={{ display: "flex", gap: 8, position: "sticky", bottom: 0, background: "var(--color-card, inherit)", paddingTop: 8 }}>
              <button className="bo" disabled={saving} onClick={() => setStage("source")} style={{ flex: 1 }}>{t("spec.back")}</button>
              <button className="bg" disabled={saving || !chosen.length} onClick={save} style={{ flex: 2 }}>
                {saving ? "…" : t("spec.saveN").replace("{n}", String(chosen.length))}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
