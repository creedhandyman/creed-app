"use client";
/**
 * QuoteForge's service list ("the services we offer"). Two uses:
 *  - mode "start" (the From Template screen): search, filter by category /
 *    favorites, tap a service to start a quote from it, and organize the list
 *    — rename, category, star, move up/down, duplicate, edit lines, delete.
 *  - mode "add" (a sheet inside the quote editor): tap a service to drop its
 *    lines into the quote on screen. No organizing there.
 * The rules (grouping, order, search) are pure in lib/service-templates.ts.
 */
import { useMemo, useState } from "react";
import { Icon } from "./Icon";
import { db } from "@/lib/supabase";
import { useStore } from "@/lib/store";
import {
  groupTemplates, templateCategories, templateStats, parseTemplateRooms, moveTemplate,
  nextSortOrder, categoryOf, canonCategory, OTHER_CATEGORY, type ServiceTemplate,
} from "@/lib/service-templates";

const VIOLET = "var(--color-violet)";

export default function ServiceTemplates({ templates, reload, onPick, onEditLines, onNew, mode = "start" }: {
  templates: ServiceTemplate[];
  reload: () => Promise<void> | void;
  onPick: (tpl: ServiceTemplate) => void;
  onEditLines?: (tpl: ServiceTemplate) => void;
  onNew?: () => void;
  mode?: "start" | "add";
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [manage, setManage] = useState<{ tpl: ServiceTemplate; name: string; category: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const cats = useMemo(() => templateCategories(templates), [templates]);
  const hasFavs = templates.some((t) => t.favorite);
  const groups = useMemo(() => groupTemplates(templates, query, filter), [templates, query, filter]);
  const organize = mode === "start";

  const toggleFav = async (tpl: ServiceTemplate) => {
    if (await db.patch("service_templates", tpl.id, { favorite: !tpl.favorite })) await reload();
  };
  const move = async (tpl: ServiceTemplate, dir: -1 | 1) => {
    const changes = moveTemplate(templates, tpl.id, dir);
    if (!changes.length) return;
    setBusy(true);
    try {
      for (const c of changes) if (!(await db.patch("service_templates", c.id, { sort_order: c.sort_order }))) break;
      await reload();
    } finally { setBusy(false); }
  };
  const saveManage = async () => {
    if (!manage) return;
    const name = manage.name.trim();
    if (!name) { useStore.getState().showToast("Name the service", "warning"); return; }
    const category = canonCategory(templates, manage.category);
    const patch: Record<string, unknown> = { name, category: category || null };
    // Changing category = join the end of the new one.
    if ((category || OTHER_CATEGORY) !== categoryOf(manage.tpl)) patch.sort_order = nextSortOrder(templates, category, manage.tpl.id);
    setBusy(true);
    try {
      if (await db.patch("service_templates", manage.tpl.id, patch)) { await reload(); setManage(null); }
    } finally { setBusy(false); }
  };
  const duplicate = async (tpl: ServiceTemplate) => {
    setBusy(true);
    try {
      const res = await db.post("service_templates", {
        org_id: tpl.org_id, name: `${tpl.name} (copy)`, template_rooms: tpl.template_rooms,
        category: tpl.category || null, sort_order: nextSortOrder(templates, tpl.category || ""),
      });
      if (res) { await reload(); setManage(null); useStore.getState().showToast("Service copied", "success"); }
    } finally { setBusy(false); }
  };
  const remove = async (tpl: ServiceTemplate) => {
    if (!await useStore.getState().showConfirm("Delete service", `Delete "${tpl.name}"?`, { confirmLabel: "Delete", danger: true })) return;
    await db.del("service_templates", tpl.id);
    setManage(null);
    await reload();
  };

  const chip = (key: string, label: React.ReactNode) => (
    <button key={key} type="button" onClick={() => setFilter(filter === key ? "" : key)}
      style={{
        flexShrink: 0, fontSize: 12.5, fontWeight: 600, padding: "5px 11px", borderRadius: 99, cursor: "pointer",
        display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
        color: filter === key ? "#fff" : "var(--color-dim)",
        background: filter === key ? "rgba(157,78,221,.55)" : "transparent",
        border: `1px solid ${filter === key ? "rgba(157,78,221,.8)" : "var(--color-border-dark)"}`,
      }}>{label}</button>
  );

  if (!templates.length) {
    return (
      <div className="cd" style={{ textAlign: "center", padding: 22 }}>
        <Icon name="briefcase" size={28} color="var(--color-dim)" />
        <p className="dim" style={{ fontSize: 14, marginTop: 8 }}>
          No services yet. {organize ? <>Tap <b>New service</b> to set up one you offer, or build a quote and tap <b>Save as template</b>.</> : "Save a quote as a template, or add services from QuoteForge → From Template."}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ position: "relative", marginBottom: 8 }}>
        <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", display: "inline-flex" }}>
          <Icon name="search" size={15} color="var(--color-dim)" />
        </span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search services or line items"
          style={{ width: "100%", paddingLeft: 32, boxSizing: "border-box" }} />
      </div>
      {(cats.length > 1 || hasFavs) && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 6 }}>
          {chip("", "All")}
          {hasFavs && chip("favorites", <><Icon name="star" size={12} color="#f5b400" /> Favorites</>)}
          {cats.map((c) => chip(c, c))}
        </div>
      )}

      {groups.length === 0 && <p className="dim" style={{ fontSize: 13.5, textAlign: "center", padding: 14 }}>No services match.</p>}

      {groups.map((g) => (
        <div key={g.category} style={{ marginBottom: 10 }}>
          <div className="seclabel" style={{ display: "flex", alignItems: "center", gap: 6, margin: "6px 2px" }}>
            {g.category === "Favorites" ? <Icon name="star" size={12} color="#f5b400" /> : <Icon name="folder" size={12} color={VIOLET} />}
            {g.category} <span className="dim" style={{ fontWeight: 400 }}>· {g.items.length}</span>
          </div>
          {g.items.map((tpl, i) => {
            const s = templateStats(parseTemplateRooms(tpl));
            const inCat = g.category !== "Favorites";
            return (
              <div key={`${g.category}-${tpl.id}`} onClick={() => onPick(tpl)} className="cd" role="button"
                style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "10px 11px", marginBottom: 6 }}>
                {organize ? (
                  <button type="button" aria-label={tpl.favorite ? "Unstar" : "Star"} onClick={(e) => { e.stopPropagation(); void toggleFav(tpl); }}
                    style={{ background: "none", border: "none", padding: 4, cursor: "pointer", display: "inline-flex", flexShrink: 0 }}>
                    <Icon name="star" size={18} color={tpl.favorite ? "#f5b400" : "var(--color-border-dark)"} strokeWidth={tpl.favorite ? 2.6 : 1.75} />
                  </button>
                ) : (
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(157,78,221,.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon name={mode === "add" ? "add" : "briefcase"} size={16} color={VIOLET} />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 15.5, letterSpacing: ".3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tpl.name}</div>
                  <div className="dim" style={{ fontSize: 12.5, marginTop: 1 }}>
                    {s.items} item{s.items === 1 ? "" : "s"}{s.hrs > 0 ? ` · ${s.hrs}h labor` : ""}{s.mat > 0 ? ` · $${Math.round(s.mat)} materials` : ""}
                  </div>
                </div>
                {organize && inCat && (
                  <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
                    <button type="button" aria-label="Move up" disabled={busy || i === 0} onClick={(e) => { e.stopPropagation(); void move(tpl, -1); }}
                      style={{ background: "none", border: "none", padding: "1px 4px", cursor: "pointer", opacity: i === 0 ? 0.25 : 1, display: "inline-flex" }}>
                      <Icon name="collapse" size={15} color="var(--color-dim)" />
                    </button>
                    <button type="button" aria-label="Move down" disabled={busy || i === g.items.length - 1} onClick={(e) => { e.stopPropagation(); void move(tpl, 1); }}
                      style={{ background: "none", border: "none", padding: "1px 4px", cursor: "pointer", opacity: i === g.items.length - 1 ? 0.25 : 1, display: "inline-flex" }}>
                      <Icon name="expand" size={15} color="var(--color-dim)" />
                    </button>
                  </div>
                )}
                {organize && (
                  <button type="button" aria-label="Manage service" onClick={(e) => { e.stopPropagation(); setManage({ tpl, name: tpl.name, category: tpl.category || "" }); }}
                    style={{ background: "none", border: "none", padding: 5, cursor: "pointer", display: "inline-flex", flexShrink: 0 }}>
                    <Icon name="edit" size={15} color="var(--color-dim)" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {manage && (
        <div className="sheet-overlay" onClick={() => { if (!busy) setManage(null); }}>
          <div className="sheet cd" onClick={(e) => e.stopPropagation()}>
            <h4 style={{ fontSize: 16, marginBottom: 10, display: "flex", alignItems: "center", gap: 7 }}>
              <Icon name="briefcase" size={16} color={VIOLET} /> Service
            </h4>
            <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>Name</div>
            <input value={manage.name} onChange={(e) => setManage({ ...manage, name: e.target.value })} style={{ width: "100%", marginBottom: 10 }} />
            <CategoryField value={manage.category} onChange={(category) => setManage({ ...manage, category })} categories={cats} />
            <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
              {onEditLines && (
                <button type="button" className="bo" disabled={busy} onClick={() => { const tpl = manage.tpl; setManage(null); onEditLines(tpl); }}
                  style={{ flex: "1 1 30%", fontSize: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                  <Icon name="list" size={14} /> Edit lines
                </button>
              )}
              <button type="button" className="bo" disabled={busy} onClick={() => duplicate(manage.tpl)}
                style={{ flex: "1 1 30%", fontSize: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <Icon name="layers" size={14} /> Duplicate
              </button>
              <button type="button" className="bo" disabled={busy} onClick={() => remove(manage.tpl)}
                style={{ flex: "1 1 30%", fontSize: 13, color: "var(--color-accent-red)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <Icon name="delete" size={14} color="var(--color-accent-red)" /> Delete
              </button>
            </div>
            <div className="row" style={{ gap: 6, marginTop: 12 }}>
              <button className="bo" disabled={busy} onClick={() => setManage(null)} style={{ flex: 1 }}>Cancel</button>
              <button className="bb" disabled={busy} onClick={saveManage} style={{ flex: 1 }}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      {organize && onNew && (
        <button type="button" onClick={onNew} className="bo"
          style={{ width: "100%", marginTop: 4, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Icon name="add" size={15} /> New service
        </button>
      )}
    </div>
  );
}

/** Category input + one-tap chips of the categories already in use. */
export function CategoryField({ value, onChange, categories }: { value: string; onChange: (v: string) => void; categories: string[] }) {
  const picks = categories.filter((c) => c !== OTHER_CATEGORY);
  return (
    <div>
      <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>Category</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. Plumbing, Doors, Drywall (blank = Other)" style={{ width: "100%" }} />
      {picks.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
          {picks.map((c) => (
            <button key={c} type="button" onClick={() => onChange(c)}
              style={{
                fontSize: 12, padding: "3px 9px", borderRadius: 99, cursor: "pointer",
                color: value.trim().toLowerCase() === c.toLowerCase() ? "#fff" : "var(--color-dim)",
                background: value.trim().toLowerCase() === c.toLowerCase() ? "rgba(157,78,221,.55)" : "transparent",
                border: "1px solid var(--color-border-dark)",
              }}>{c}</button>
          ))}
        </div>
      )}
    </div>
  );
}
