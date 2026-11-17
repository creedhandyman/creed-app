"use client";
/**
 * Import a customer's material spec (docs/claude/customer-material-specs.md):
 * a CSV / Excel sheet, a PDF, or pasted text → items → REVIEW → save.
 * A sheet with recognizable headers maps straight across (no AI); anything
 * else goes to /api/specs/extract. Nothing is saved until the owner taps
 * Save on the review table. Owner/manager only (the card hides it otherwise,
 * RLS enforces it).
 */
import { useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";
import { cleanDrafts, parseCsv, rowsToDrafts, rowsToText, type SpecDraft } from "@/lib/spec-import";
import { createSpec, saveDrafts, type MaterialSpec } from "@/lib/material-spec-client";

const PDF_INLINE_MAX = 3_000_000;

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

const fileToBase64 = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || "").replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

export default function MaterialSpecImport({ customerId, customerName, specs, initialSpecId, onClose, onSaved }: Props) {
  const showToast = useStore((s) => s.showToast);
  const [stage, setStage] = useState<Stage>("source");
  const [target, setTarget] = useState<string>(initialSpecId || "new");
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [newName, setNewName] = useState(`${customerName} spec`);
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [status, setStatus] = useState("");
  const [drafts, setDrafts] = useState<SpecDraft[]>([]);
  const [keep, setKeep] = useState<boolean[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [source, setSource] = useState("");
  const [usedAi, setUsedAi] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const ai = async (body: Record<string, unknown>): Promise<{ items: SpecDraft[]; notes: string[] }> => {
    setStatus(t("spec.reading"));
    setUsedAi(true);
    const res = await apiFetch("/api/specs/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data?.error || t("spec.readFailed"));
    return { items: cleanDrafts(data.items), notes: Array.isArray(data.notes) ? data.notes : [] };
  };

  /** Sheet rows → drafts: straight across when the headers are clear, else the AI. */
  const fromRows = async (rows: string[][]) => {
    const mapped = rowsToDrafts(rows);
    if (mapped.mapped && mapped.drafts.length) {
      setUsedAi(false);
      return { items: mapped.drafts, notes: [] as string[] };
    }
    return ai({ text: rowsToText(rows) });
  };

  const read = async () => {
    setStage("working");
    try {
      let out: { items: SpecDraft[]; notes: string[] };
      if (file) {
        const ext = (file.name.split(".").pop() || "").toLowerCase();
        setSource(file.name);
        if (ext === "xls") throw new Error(t("spec.xlsOld"));
        if (ext === "csv" || file.type === "text/csv") {
          out = await fromRows(parseCsv(await file.text()));
        } else if (ext === "xlsx") {
          setStatus(t("spec.openingSheet"));
          const { readXlsx } = await import("@/lib/xlsx-read");
          let rows: string[][];
          try { rows = await readXlsx(file); } catch { throw new Error(t("spec.xlsxFailed")); }
          out = await fromRows(rows);
        } else if (ext === "pdf" || file.type === "application/pdf") {
          if (file.size <= PDF_INLINE_MAX) {
            out = await ai({ pdfBase64: await fileToBase64(file), fileName: file.name });
          } else {
            setStatus(t("spec.openingPdf"));
            const { readPdf } = await import("@/lib/parser");
            const text = await readPdf(file);
            if (!text.trim()) throw new Error(t("spec.pdfNoText"));
            out = await ai({ text, fileName: file.name });
          }
        } else {
          out = await ai({ text: await file.text(), fileName: file.name });
        }
      } else {
        setSource(t("spec.sourcePasted"));
        const rows = parseCsv(pasted);
        out = rows.length > 1 && rows[0].length > 1 ? await fromRows(rows) : await ai({ text: pasted });
      }
      if (!out.items.length) throw new Error(t("spec.noneFound"));
      setDrafts(out.items);
      setKeep(out.items.map(() => true));
      setNotes(out.notes);
      setStage("review");
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("spec.readFailed"), "error");
      setStage("source");
    } finally {
      setStatus("");
    }
  };

  const edit = (i: number, patch: Partial<SpecDraft>) =>
    setDrafts((d) => d.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  const chosen = useMemo(() => drafts.filter((_, i) => keep[i] && drafts[i].name.trim()), [drafts, keep]);
  const priceNeeded = chosen.filter((d) => d.unit_price == null).length;

  const save = async () => {
    if (!chosen.length) return;
    setSaving(true);
    let spec = specs.find((s) => s.id === target) || null;
    if (!spec) spec = await createSpec(customerId, newName, source || null);
    if (!spec) { setSaving(false); return; }
    const n = await saveDrafts(spec, chosen, target === "new" ? "add" : mode);
    setSaving(false);
    if (n > 0) {
      showToast(t("spec.saved").replace("{n}", String(n)), "success");
      onSaved();
    }
  };

  const num = (v: string): number | null => {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return v.trim() && Number.isFinite(n) && n >= 0 ? n : null;
  };
  const cell: React.CSSProperties = { fontSize: 14, padding: "6px 8px", minWidth: 0, width: "100%" };

  return (
    <div className="sheet-overlay" onClick={() => !saving && stage !== "working" && onClose()}>
      <div className="cd sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: stage === "review" ? 980 : 520, paddingTop: 20, maxHeight: "92dvh", overflowY: "auto" }}>
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
              accept=".csv,.xlsx,.xls,.pdf,.txt,text/csv,application/pdf,text/plain"
              style={{ display: "none" }}
              onChange={(e) => { setFile(e.target.files?.[0] || null); }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <button type="button" className="bo" onClick={() => fileRef.current?.click()} style={{ width: "auto", fontSize: 14, padding: "8px 12px" }}>
                <Icon name="upload" size={14} /> {t("spec.chooseFile")}
              </button>
              <span className="dim" style={{ fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {file ? file.name : t("spec.fileKinds")}
              </span>
              {file && (
                <button type="button" className="bo" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }} style={{ width: "auto", fontSize: 13, padding: "4px 8px" }} aria-label={t("spec.clearFile")}>
                  <Icon name="close" size={13} />
                </button>
              )}
            </div>

            {!file && (
              <>
                <label className="sl">{t("spec.pasteLabel")}</label>
                <textarea
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  rows={6}
                  placeholder={t("spec.pastePlaceholder")}
                  style={{ width: "100%", fontSize: 14, marginBottom: 12 }}
                />
              </>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button className="bo" onClick={onClose} style={{ flex: 1 }}>{t("spec.cancel")}</button>
              <button className="bb" disabled={!file && pasted.trim().length < 3} onClick={read} style={{ flex: 1 }}>
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
              {(usedAi ? t("spec.reviewBodyAi") : t("spec.reviewBodySheet")).replace("{n}", String(drafts.length))}
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

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {drafts.map((d, i) => (
                <div key={i} style={{
                  border: "1px solid var(--color-border-dark)", borderRadius: 8, padding: 8,
                  opacity: keep[i] ? 1 : 0.45,
                }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                    <input type="checkbox" checked={!!keep[i]} onChange={(e) => setKeep((k) => k.map((x, j) => (j === i ? e.target.checked : x)))} aria-label={t("spec.keepRow")} />
                    <input value={d.name} onChange={(e) => edit(i, { name: e.target.value })} style={{ ...cell, fontWeight: 600 }} placeholder={t("spec.f.name")} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 6 }}>
                    <input value={d.brand || ""} onChange={(e) => edit(i, { brand: e.target.value || null })} style={cell} placeholder={t("spec.f.brand")} />
                    <input value={d.model || ""} onChange={(e) => edit(i, { model: e.target.value || null })} style={cell} placeholder={t("spec.f.model")} />
                    <input value={d.category || ""} onChange={(e) => edit(i, { category: e.target.value || null })} style={cell} placeholder={t("spec.f.category")} />
                    <input value={d.store || ""} onChange={(e) => edit(i, { store: e.target.value || null })} style={cell} placeholder={t("spec.f.store")} />
                    <input value={d.unit || ""} onChange={(e) => edit(i, { unit: e.target.value || null })} style={cell} placeholder={t("spec.f.unit")} />
                    <input
                      defaultValue={d.unit_price == null ? "" : String(d.unit_price)}
                      onBlur={(e) => edit(i, { unit_price: num(e.target.value) })}
                      inputMode="decimal"
                      style={{ ...cell, borderColor: d.unit_price == null ? "var(--color-warning)" : undefined }}
                      placeholder={t("spec.f.priceNeeded")}
                    />
                    <input value={d.pack_label || ""} onChange={(e) => edit(i, { pack_label: e.target.value || null })} style={cell} placeholder={t("spec.f.packLabel")} />
                    <input
                      defaultValue={d.pack_size == null ? "" : String(d.pack_size)}
                      onBlur={(e) => { const n = num(e.target.value); edit(i, { pack_size: n && n > 0 ? n : null }); }}
                      inputMode="decimal" style={cell} placeholder={t("spec.f.packSize")}
                    />
                    <input
                      defaultValue={d.coverage == null ? "" : String(d.coverage)}
                      onBlur={(e) => { const n = num(e.target.value); edit(i, { coverage: n && n > 0 ? n : null }); }}
                      inputMode="decimal" style={cell} placeholder={t("spec.f.coverage")}
                    />
                    <input value={d.coverage_unit || ""} onChange={(e) => edit(i, { coverage_unit: e.target.value || null })} style={cell} placeholder={t("spec.f.coverageUnit")} />
                  </div>
                  {(d.companions.length > 0 || d.notes) && (
                    <div className="dim" style={{ fontSize: 12.5, marginTop: 6 }}>
                      {d.companions.length > 0 && <div>{t("spec.companionsLine")}: {d.companions.map((c) => `${c.qty} ${c.name} / ${c.per}`).join(", ")}</div>}
                      {d.notes && <div>{d.notes}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>

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
