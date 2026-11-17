"use client";
/**
 * "Material spec" on the customer page (docs/claude/customer-material-specs.md).
 * A commercial client's required products (Shaw carpet tile, Roppe base…).
 * When this customer's job is quoted, the AI uses these first and the quote
 * shows the spec names. Owner/manager only; hidden for everyone else (their
 * quotes still USE the spec).
 */
import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";
import MaterialSpecImport from "./MaterialSpecImport";
import {
  deleteSpec, deleteSpecItem, listSpecs, loadSpecItems, specItemCounts, updateSpec, updateSpecItem,
  type MaterialSpec,
} from "@/lib/material-spec-client";
import { specDisplayName, type SpecItem } from "@/lib/material-spec";
import { companionsToText, textToCompanions } from "@/lib/spec-import";
import type { Customer } from "@/lib/types";

const fmtDate = (s?: string) => {
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
};

export default function MaterialSpecCard({ customer }: { customer: Customer }) {
  const user = useStore((s) => s.user);
  const showConfirm = useStore((s) => s.showConfirm);
  const showToast = useStore((s) => s.showToast);
  const canEdit = user?.role === "owner" || user?.role === "manager";

  const [specs, setSpecs] = useState<MaterialSpec[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [missing, setMissing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [importFor, setImportFor] = useState<string | null>(null); // "new" or a spec id
  const [open, setOpen] = useState<MaterialSpec | null>(null);

  const reload = useCallback(async () => {
    const r = await listSpecs(customer.id);
    setSpecs(r.specs);
    setMissing(r.missing);
    setCounts(await specItemCounts(r.specs.map((s) => s.id)));
    setLoaded(true);
  }, [customer.id]);

  useEffect(() => { if (canEdit) void reload(); }, [canEdit, reload]);

  if (!canEdit || !loaded) return null;

  const toggleActive = async (s: MaterialSpec) => {
    if (await updateSpec(s.id, { active: !s.active })) {
      showToast(s.active ? t("spec.turnedOff") : t("spec.turnedOn"), "success");
      void reload();
    }
  };

  return (
    <div className="cd mb">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <h4 style={{ fontSize: 15, margin: 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="package" size={15} color="var(--color-primary)" /> {t("spec.title")}
        </h4>
        {!missing && (
          <button className="bo" onClick={() => setImportFor("new")} style={{ width: "auto", fontSize: 13.5, padding: "5px 10px" }}>
            <Icon name="upload" size={13} /> {t("spec.import")}
          </button>
        )}
      </div>

      {missing ? (
        <p className="dim" style={{ fontSize: 13, margin: 0 }}>{t("spec.notSetUp")}</p>
      ) : specs.length === 0 ? (
        <p className="dim" style={{ fontSize: 13, margin: 0, lineHeight: 1.45 }}>{t("spec.empty").replace("{name}", customer.name)}</p>
      ) : (
        <>
          <p className="dim" style={{ fontSize: 13, margin: "0 0 8px", lineHeight: 1.45 }}>{t("spec.explain")}</p>
          {specs.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--color-border-dark)" }}>
              <button
                onClick={() => setOpen(s)}
                style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, color: "inherit", cursor: "pointer" }}
              >
                <div style={{ fontSize: 14.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                <div className="dim" style={{ fontSize: 12.5 }}>
                  {t("spec.itemsLine").replace("{n}", String(counts[s.id] || 0)).replace("{date}", fmtDate(s.updated_at || s.created_at))}
                </div>
              </button>
              <button
                onClick={() => toggleActive(s)}
                style={{
                  fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", borderRadius: 99, padding: "3px 10px", flexShrink: 0,
                  background: "transparent", cursor: "pointer",
                  color: s.active ? "var(--color-success)" : "var(--color-dim)",
                  border: `1px solid ${s.active ? "var(--color-success)" : "var(--color-dim)"}`,
                }}
                aria-label={s.active ? t("spec.turnOff") : t("spec.turnOn")}
              >
                {s.active ? t("spec.active") : t("spec.off")}
              </button>
              <span style={{ color: "var(--color-dim)", display: "inline-flex" }}><Icon name="next" size={14} /></span>
            </div>
          ))}
        </>
      )}

      {importFor && (
        <MaterialSpecImport
          customerId={customer.id}
          customerName={customer.name}
          specs={specs}
          initialSpecId={importFor === "new" ? undefined : importFor}
          onClose={() => setImportFor(null)}
          onSaved={() => { setImportFor(null); void reload(); }}
        />
      )}

      {open && (
        <SpecEditor
          spec={open}
          onClose={() => { setOpen(null); void reload(); }}
          onImport={() => { const id = open.id; setOpen(null); setImportFor(id); }}
          onDeleted={() => { setOpen(null); void reload(); }}
          showConfirm={showConfirm}
        />
      )}
    </div>
  );
}

/** One spec's items: rename, edit an item, delete an item, delete the spec. */
function SpecEditor({ spec, onClose, onImport, onDeleted, showConfirm }: {
  spec: MaterialSpec;
  onClose: () => void;
  onImport: () => void;
  onDeleted: () => void;
  showConfirm: (title: string, message: string) => Promise<boolean>;
}) {
  const showToast = useStore((s) => s.showToast);
  const [items, setItems] = useState<SpecItem[] | null>(null);
  const [name, setName] = useState(spec.name);
  const [editing, setEditing] = useState<SpecItem | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => setItems(await loadSpecItems([spec.id])), [spec.id]);
  useEffect(() => { void load(); }, [load]);

  const saveName = async () => {
    if (name.trim() && name.trim() !== spec.name) await updateSpec(spec.id, { name: name.trim() });
  };
  const removeSpec = async () => {
    if (!(await showConfirm(t("spec.deleteTitle"), t("spec.deleteBody").replace("{name}", spec.name)))) return;
    if (await deleteSpec(spec.id)) { showToast(t("spec.deleted"), "success"); onDeleted(); }
  };

  const shown = (items || []).filter((it) => {
    const s = q.trim().toLowerCase();
    return !s || `${it.name} ${it.brand || ""} ${it.model || ""} ${it.category || ""}`.toLowerCase().includes(s);
  });

  return (
    <div className="sheet-overlay" onClick={() => { void saveName(); onClose(); }}>
      <div className="cd sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, paddingTop: 20, maxHeight: "92dvh", overflowY: "auto" }}>
        <label className="sl">{t("spec.specName")}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} style={{ width: "100%", marginBottom: 10, fontWeight: 600 }} />

        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          <button className="bo" onClick={onImport} style={{ width: "auto", fontSize: 13.5, padding: "6px 10px" }}><Icon name="upload" size={13} /> {t("spec.importMore")}</button>
          <button className="bo" onClick={removeSpec} style={{ width: "auto", fontSize: 13.5, padding: "6px 10px", color: "var(--color-accent-red)", borderColor: "var(--color-accent-red)" }}>
            <Icon name="delete" size={13} /> {t("spec.deleteSpec")}
          </button>
        </div>

        {(items?.length || 0) > 8 && (
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("spec.search")} style={{ width: "100%", marginBottom: 8 }} />
        )}

        {items === null ? (
          <div className="dim" style={{ fontSize: 14, padding: 12 }}>…</div>
        ) : items.length === 0 ? (
          <div className="dim" style={{ fontSize: 14, padding: 12 }}>{t("spec.noItems")}</div>
        ) : (
          shown.map((it) => (
            <button
              key={it.id}
              onClick={() => setEditing(it)}
              style={{ display: "flex", width: "100%", gap: 8, alignItems: "center", textAlign: "left", background: "none", border: "none", borderTop: "1px solid var(--color-border-dark)", padding: "8px 0", color: "inherit", cursor: "pointer" }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{specDisplayName(it)}</span>
                <span className="dim" style={{ display: "block", fontSize: 12 }}>{[it.category, it.store].filter(Boolean).join(" · ")}</span>
              </span>
              <span style={{ fontFamily: "Oswald", fontSize: 14, flexShrink: 0, color: it.unit_price == null ? "var(--color-warning)" : undefined }}>
                {it.unit_price == null ? t("spec.noPrice") : `$${it.unit_price.toFixed(2)}${it.unit ? `/${it.unit}` : ""}`}
              </span>
            </button>
          ))
        )}

        <button className="bo" onClick={() => { void saveName(); onClose(); }} style={{ marginTop: 12 }}>{t("spec.done")}</button>

        {editing && (
          <ItemEditor
            item={editing}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); void load(); }}
            showConfirm={showConfirm}
          />
        )}
      </div>
    </div>
  );
}

function ItemEditor({ item, onClose, onSaved, showConfirm }: {
  item: SpecItem;
  onClose: () => void;
  onSaved: () => void;
  showConfirm: (title: string, message: string) => Promise<boolean>;
}) {
  const [f, setF] = useState({
    name: item.name, brand: item.brand || "", model: item.model || "", sku: item.sku || "", store: item.store || "",
    category: item.category || "", unit: item.unit || "", unit_price: item.unit_price == null ? "" : String(item.unit_price),
    pack_label: item.pack_label || "", pack_size: item.pack_size == null ? "" : String(item.pack_size),
    coverage: item.coverage == null ? "" : String(item.coverage), coverage_unit: item.coverage_unit || "",
    keywords: (item.keywords || []).join(", "), notes: item.notes || "",
    companions: companionsToText(item.companions || []),
  });
  const [busy, setBusy] = useState(false);
  const num = (v: string, positive = false) => {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return v.trim() && Number.isFinite(n) && (positive ? n > 0 : n >= 0) ? n : null;
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const txt = (v: string) => v.trim() || null;

  const save = async () => {
    if (!f.name.trim()) return;
    setBusy(true);
    const ok = await updateSpecItem(item.id, {
      name: f.name.trim(), brand: txt(f.brand), model: txt(f.model), sku: txt(f.sku), store: txt(f.store),
      category: txt(f.category), unit: txt(f.unit), unit_price: num(f.unit_price),
      pack_label: txt(f.pack_label), pack_size: num(f.pack_size, true),
      coverage: num(f.coverage, true), coverage_unit: txt(f.coverage_unit),
      keywords: f.keywords.split(/[,;]/).map((k) => k.trim()).filter(Boolean).slice(0, 12),
      notes: txt(f.notes),
      companions: textToCompanions(f.companions),
    });
    setBusy(false);
    if (ok) onSaved();
  };
  const remove = async () => {
    if (!(await showConfirm(t("spec.deleteItemTitle"), item.name))) return;
    setBusy(true);
    const ok = await deleteSpecItem(item.id);
    setBusy(false);
    if (ok) onSaved();
  };

  const field = (k: keyof typeof f, label: string, mode?: "decimal") => (
    <div>
      <label className="sl">{label}</label>
      <input value={f[k]} onChange={set(k)} inputMode={mode} style={{ width: "100%" }} />
    </div>
  );

  return (
    <div className="sheet-overlay" onClick={() => !busy && onClose()}>
      <div className="cd sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, paddingTop: 20, maxHeight: "92dvh", overflowY: "auto" }}>
        <h3 style={{ fontFamily: "Oswald", fontSize: 18, textTransform: "uppercase", marginBottom: 8 }}>{t("spec.editItem")}</h3>
        {field("name", t("spec.f.name"))}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
          {field("brand", t("spec.f.brand"))}
          {field("model", t("spec.f.model"))}
          {field("category", t("spec.f.category"))}
          {field("store", t("spec.f.store"))}
          {field("sku", t("spec.f.sku"))}
          {field("unit", t("spec.f.unit"))}
          {field("unit_price", t("spec.f.price"), "decimal")}
          {field("pack_label", t("spec.f.packLabel"))}
          {field("pack_size", t("spec.f.packSize"), "decimal")}
          {field("coverage", t("spec.f.coverage"), "decimal")}
          {field("coverage_unit", t("spec.f.coverageUnit"))}
        </div>
        <div style={{ marginTop: 6 }}>{field("keywords", t("spec.f.keywords"))}</div>
        <div style={{ marginTop: 6 }}>{field("notes", t("spec.f.notes"))}</div>
        <div style={{ marginTop: 6 }}>
          <label className="sl">{t("spec.f.companions")}</label>
          <textarea value={f.companions} onChange={set("companions")} rows={2} placeholder={t("spec.companionsPlaceholder")} style={{ width: "100%", fontSize: 14 }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="bo" disabled={busy} onClick={remove} style={{ flex: 1, color: "var(--color-accent-red)", borderColor: "var(--color-accent-red)" }}>{t("spec.delete")}</button>
          <button className="bo" disabled={busy} onClick={onClose} style={{ flex: 1 }}>{t("spec.cancel")}</button>
          <button className="bg" disabled={busy || !f.name.trim()} onClick={save} style={{ flex: 1 }}>{busy ? "…" : t("spec.save")}</button>
        </div>
      </div>
    </div>
  );
}
