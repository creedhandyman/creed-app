/**
 * Keep a customized work order in step with the quote it came from.
 *
 * QuoteForge holds the work order as its own array (`customWorkOrder`) once a
 * job has been saved or the Guide tab has been edited. Before this, those tasks
 * had no link back to their quote line, so editing a line in the Quote tab
 * (its text, hours, notes, condition, trade) or deleting it never reached the
 * work order — and save then wrote that stale copy into `rooms.workOrder`,
 * which is what WorkVision's Tasks tab and the Jobs work-order screen show.
 *
 * Each task now carries `itemId` (the quote line's RoomItem.id, stable across
 * validateQuote / reloads) plus a session-only `src` snapshot of the line
 * values it was last synced from. `syncWorkOrder` is a three-way merge:
 *   - a field the QUOTE changed since `src` → copied onto the task;
 *   - a field only the Guide tab changed → kept (the quote didn't touch it);
 *   - the line was deleted → its task is dropped;
 *   - a line added since the work order was loaded/customized → task appended;
 *   - hand-added custom tasks → left alone;
 *   - legacy tasks saved before the link existed → re-linked by text match and
 *     refreshed from their line once (this heals already-stale jobs).
 * Lines present at load with no task (the user removed it on purpose) stay
 * absent: callers pass them in `known`.
 */
import { makeGuide, priFromCondition, type GuideStep, type GuideStepSrc } from "./parser";
import type { Room } from "./types";

const FIELDS = ["room", "detail", "action", "pri", "hrs"] as const;

const norm = (s?: string) => (s || "").toLowerCase().trim();

/** Every line id in the quote — seed for `known` when a work order is loaded. */
export function quoteItemIds(rooms: Room[]): Set<string> {
  const ids = new Set<string>();
  for (const r of rooms) for (const it of r.items) if (it.id) ids.add(it.id);
  return ids;
}

/**
 * Returns the synced work order, or null when nothing changed (so a React
 * functional update can return the same array and skip a re-render).
 */
export function syncWorkOrder(steps: GuideStep[], rooms: Room[], known: Set<string>): GuideStep[] | null {
  const items = new Map<string, GuideStepSrc>();
  const order: { id: string; room: string; detail: string }[] = [];
  for (const r of rooms) {
    for (const it of r.items) {
      if (!it.id) continue;
      items.set(it.id, {
        room: r.name,
        detail: it.detail,
        action: it.comment,
        pri: priFromCondition(it.condition),
        hrs: it.laborHrs,
      });
      order.push({ id: it.id, room: r.name, detail: it.detail });
    }
  }

  const linked = new Set<string>();
  for (const s of steps) if (s.itemId && items.has(s.itemId)) linked.add(s.itemId);

  // Legacy re-link: exact (trade, text) first, then a loose same-trade
  // contains-match (validateQuote's canonical detail rewrite can shift the
  // text a little between saves). Each line links to at most one task.
  const adopt = (s: GuideStep): string | undefined => {
    const d = norm(s.detail);
    if (!d) return undefined;
    const free = order.filter((o) => !linked.has(o.id));
    const exact = free.find((o) => norm(o.room) === norm(s.room) && norm(o.detail) === d);
    if (exact) return exact.id;
    const loose = free.find((o) => {
      if (norm(o.room) !== norm(s.room)) return false;
      const od = norm(o.detail);
      return !!od && (od.includes(d) || d.includes(od));
    });
    return loose?.id;
  };

  let changed = false;
  const out: GuideStep[] = [];
  for (const s of steps) {
    if (s.itemId) {
      const cur = items.get(s.itemId);
      if (!cur) {
        // Line deleted from the quote (or replaced by a fresh parse) → drop.
        changed = true;
        continue;
      }
      if (!s.src) {
        // First sight of this link this session: record the baseline only, so
        // any Guide-tab customization already on the task survives.
        out.push({ ...s, src: cur });
        changed = true;
        continue;
      }
      let next = s;
      for (const f of FIELDS) {
        if (cur[f] !== s.src[f]) next = { ...next, [f]: cur[f] };
      }
      if (next !== s) {
        out.push({ ...next, src: cur });
        changed = true;
      } else {
        out.push(s);
      }
      continue;
    }
    if (!s.custom) {
      const id = adopt(s);
      if (id) {
        const cur = items.get(id)!;
        linked.add(id);
        // The quote is the source of truth for what the task is and how long
        // it takes; keep a hand-written instruction if the task had one.
        out.push({ ...s, ...cur, action: s.action || cur.action, itemId: id, src: cur });
        changed = true;
        continue;
      }
    }
    out.push(s);
  }

  // Lines added since the work order was loaded/customized get a task, in the
  // trade-workflow order makeGuide uses.
  if (order.some((o) => !linked.has(o.id) && !known.has(o.id))) {
    for (const g of makeGuide(rooms).steps) {
      if (!g.itemId || linked.has(g.itemId) || known.has(g.itemId)) continue;
      out.push({ ...g, src: items.get(g.itemId) });
      linked.add(g.itemId);
      changed = true;
    }
  }

  return changed ? out : null;
}
