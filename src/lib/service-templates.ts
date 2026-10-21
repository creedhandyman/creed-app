/**
 * Service templates ("the services we offer") — the pure rules behind
 * QuoteForge's From Template screen: grouping by category, search, order,
 * and dropping a service's lines into a quote that's already open.
 *
 * A template row = name + template_rooms (stringified Room[], same shape as
 * jobs.rooms) + optional category / sort_order / favorite (migration
 * `service_templates_organize`; rows from before it have none of them, which
 * reads as "Other", order 0, not starred).
 */
import type { Room } from "./types";

export interface ServiceTemplate {
  id: string;
  org_id: string;
  name: string;
  template_rooms: string;
  category?: string | null;
  sort_order?: number | null;
  favorite?: boolean | null;
  created_at?: string;
}

export const OTHER_CATEGORY = "Other";

export function categoryOf(t: Pick<ServiceTemplate, "category">): string {
  return (t.category || "").trim() || OTHER_CATEGORY;
}

export function parseTemplateRooms(t: Pick<ServiceTemplate, "template_rooms">): Room[] {
  try {
    const r = JSON.parse(t.template_rooms);
    return Array.isArray(r) ? (r as Room[]) : [];
  } catch {
    return [];
  }
}

/** Line count, labor hours and raw (pre-markup/tax) materials of a service. */
export function templateStats(rooms: Room[]): { items: number; hrs: number; mat: number } {
  let items = 0, hrs = 0, mat = 0;
  for (const r of rooms) {
    for (const it of r.items || []) {
      items++;
      hrs += Number(it.laborHrs) || 0;
      for (const m of it.materials || []) mat += Number(m.c) || 0; // c = line total
    }
  }
  return { items, hrs: Math.round(hrs * 100) / 100, mat: Math.round(mat * 100) / 100 };
}

/** Every category in use, A→Z, "Other" last. */
export function templateCategories(list: ServiceTemplate[]): string[] {
  const set = new Set(list.map(categoryOf));
  return [...set].sort((a, b) =>
    a === OTHER_CATEGORY ? 1 : b === OTHER_CATEGORY ? -1 : a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** Order inside a category: sort_order, then name. */
export function compareTemplates(a: ServiceTemplate, b: ServiceTemplate): number {
  const d = (a.sort_order ?? 0) - (b.sort_order ?? 0);
  return d || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** Search matches the name, the category, or any line's text. */
export function matchesTemplate(t: ServiceTemplate, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (t.name.toLowerCase().includes(q) || categoryOf(t).toLowerCase().includes(q)) return true;
  return parseTemplateRooms(t).some((r) =>
    (r.name || "").toLowerCase().includes(q) ||
    (r.items || []).some((it) => (it.detail || "").toLowerCase().includes(q)));
}

export interface TemplateGroup { category: string; items: ServiceTemplate[] }

/**
 * The From Template list: a "Favorites" group first (starred services, also
 * still listed in their own category), then one group per category A→Z with
 * "Other" last. `filter` = a category name, "favorites", or "" for all.
 */
export function groupTemplates(list: ServiceTemplate[], query = "", filter = ""): TemplateGroup[] {
  const hits = list.filter((t) => matchesTemplate(t, query));
  const groups: TemplateGroup[] = [];
  const favs = hits.filter((t) => t.favorite).sort(compareTemplates);
  if (favs.length && (!filter || filter === "favorites")) groups.push({ category: "Favorites", items: favs });
  if (filter === "favorites") return groups;
  for (const cat of templateCategories(hits)) {
    if (filter && filter !== cat) continue;
    groups.push({ category: cat, items: hits.filter((t) => categoryOf(t) === cat).sort(compareTemplates) });
  }
  return groups;
}

/**
 * Move a service one step up/down inside its category. Returns the rows whose
 * sort_order must change ({id, sort_order}) — the whole category is renumbered
 * 0..n so legacy rows (all 0) get a stable order the first time.
 */
export function moveTemplate(list: ServiceTemplate[], id: string, dir: -1 | 1): { id: string; sort_order: number }[] {
  const t = list.find((x) => x.id === id);
  if (!t) return [];
  const cat = categoryOf(t);
  const inCat = list.filter((x) => categoryOf(x) === cat).sort(compareTemplates);
  const i = inCat.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= inCat.length) return [];
  [inCat[i], inCat[j]] = [inCat[j], inCat[i]];
  return inCat
    .map((x, n) => ({ id: x.id, sort_order: n, was: x.sort_order ?? 0 }))
    .filter((x) => x.sort_order !== x.was)
    .map(({ id: xid, sort_order }) => ({ id: xid, sort_order }));
}

/** sort_order for a service joining `category` (after the ones already there). */
export function nextSortOrder(list: ServiceTemplate[], category: string, exceptId?: string): number {
  const cat = category.trim() || OTHER_CATEGORY;
  const orders = list.filter((x) => x.id !== exceptId && categoryOf(x) === cat).map((x) => x.sort_order ?? 0);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

/**
 * Add a service's lines to the quote on screen. Lines join the area with the
 * same name (case-insensitive) or a new area at the end. Every added line
 * gets a FRESH id — line ids link work-order tasks to quote lines, and the
 * same service added twice (or the template it came from) must not share them.
 */
export function appendTemplateRooms(current: Room[], add: Room[], newId: () => string): Room[] {
  const out = current.map((r) => ({ ...r, items: [...r.items] }));
  for (const r of add) {
    const items = (r.items || []).map((it) => ({ ...it, id: newId() }));
    if (!items.length) continue;
    const key = (r.name || "").trim().toLowerCase();
    const hit = out.find((x) => (x.name || "").trim().toLowerCase() === key);
    if (hit) hit.items.push(...items);
    else out.push({ ...r, items });
  }
  return out;
}

/** A typed category, spelled like an existing one when it matches ignoring
 *  case ("plumbing" joins "Plumbing"); "" = Other. */
export function canonCategory(list: ServiceTemplate[], raw: string): string {
  const v = raw.trim().replace(/\s+/g, " ");
  if (!v || v.toLowerCase() === OTHER_CATEGORY.toLowerCase()) return "";
  return list.map(categoryOf).find((c) => c.toLowerCase() === v.toLowerCase()) || v;
}
