/**
 * Apply an AI Assist response (add / update / remove) to the quote's rooms.
 *
 * Moved out of QuoteForge so the Good-Better-Best rules can be enforced (and
 * tested) in code instead of trusted to the model. On a big tiered quote the
 * AI used to rewrite option memberships on lines the request wasn't about —
 * e.g. dropping eight unrelated lines out of Better, which left Better
 * cheaper than Base.
 *
 * SCOPE: when the owner points AI Assist at ONE option, only that option can
 * change, whatever the AI sends back:
 *   - add       → the new line goes in that option only;
 *   - remove    → the line leaves that option (deleted only if it was in no
 *                 other option);
 *   - update    → a line in that option alone is edited in place; a line
 *                 shared with other options is FORKED: the edited copy goes in
 *                 this option, the original stays untouched in the others;
 *   - membership changes to any other option are ignored (counted as blocked).
 * Unscoped ("All options") applies the response as given, with tiersAdd /
 * tiersRemove deltas so the AI never has to restate a line's whole set.
 */
import type { Room, RoomItem, Material } from "./types";
import { itemTiers, TIER_KEYS, type TierKey } from "./tiers";

export type AssistAdd = {
  trade?: string; detail: string; condition?: string; comment?: string;
  laborHrs?: number; materials?: Material[]; sqft?: number; tiers?: unknown;
};
export type AssistPatch = Partial<Omit<RoomItem, "tiers">> & {
  trade?: string; sqft?: number; tiers?: unknown; tiersAdd?: unknown; tiersRemove?: unknown;
};
export type AssistOps = {
  add?: AssistAdd[];
  update?: { key: string; patch: AssistPatch }[];
  remove?: { key: string }[];
};
export type AssistResult = {
  rooms: Room[];
  /** lines whose option membership was set or changed */
  tiersTouched: number;
  /** shared lines copied into the scoped option instead of edited for all */
  forked: number;
  /** operations dropped because they'd have changed another option */
  blocked: number;
};

const CONTENT_FIELDS = ["detail", "comment", "condition", "laborHrs", "materials", "sqft"] as const;

/** Valid option keys in Base→Best order, or undefined if none/invalid. */
export function cleanTiers(v: unknown): TierKey[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const set = TIER_KEYS.filter((k) => v.includes(k));
  return set.length ? set : undefined;
}

const order = (s: Set<TierKey>) => TIER_KEYS.filter((k) => s.has(k));

export function applyAssistOps(
  rooms: Room[],
  ops: AssistOps,
  opts: {
    scope?: TierKey | null;
    newId: () => string;
    /** Options for an unscoped add the AI didn't assign — the option the owner
     *  is organizing. Absent = legacy "in every option". */
    defaultAddTiers?: TierKey[] | null;
  },
): AssistResult {
  const scope = opts.scope ?? null;
  let tiersTouched = 0, forked = 0, blocked = 0;
  // Deep-enough copy: rooms + item arrays (items replaced, never mutated).
  const next: Room[] = rooms.map((r) => ({ ...r, items: [...r.items] }));
  const find = (key: string) => {
    for (const r of next) {
      const ii = r.items.findIndex((it) => it.id === key);
      if (ii >= 0) return { r, ii };
    }
    return null;
  };
  const putInTrade = (trade: string, item: RoomItem) => {
    const target = next.find((r) => r.name === trade);
    if (target) target.items.push(item);
    else next.push({ name: trade, items: [item] });
  };

  // REMOVE first, so an update to a removed key no-ops instead of resurrecting it.
  const removeKeys = new Set((ops.remove || []).map((r) => r.key));
  for (const key of removeKeys) {
    const pos = find(key);
    if (!pos) continue;
    const cur = pos.r.items[pos.ii];
    if (!scope) { pos.r.items.splice(pos.ii, 1); continue; }
    const ts = itemTiers(cur);
    if (!ts.includes(scope)) { blocked++; continue; }
    if (ts.length === 1) pos.r.items.splice(pos.ii, 1);
    else { pos.r.items[pos.ii] = { ...cur, tiers: ts.filter((t) => t !== scope) }; tiersTouched++; }
  }

  for (const u of ops.update || []) {
    if (removeKeys.has(u.key)) continue;
    const pos = find(u.key);
    if (!pos) continue;
    const cur = pos.r.items[pos.ii];
    const { trade: newTrade, tiers: rawSet, tiersAdd, tiersRemove, ...rest } = u.patch || {};
    const content: Partial<RoomItem> = {};
    for (const f of CONTENT_FIELDS) {
      if (f in rest && (rest as Record<string, unknown>)[f] !== undefined) {
        (content as Record<string, unknown>)[f] = (rest as Record<string, unknown>)[f];
      }
    }
    const hasContent = Object.keys(content).length > 0 || (!!newTrade && newTrade !== pos.r.name);

    // Membership the AI asked for, as a full set relative to the current one.
    const curSet = new Set(itemTiers(cur));
    let wanted: Set<TierKey> | null = null;
    const full = cleanTiers(rawSet);
    if (full) wanted = new Set(full);
    const add = cleanTiers(tiersAdd), rem = cleanTiers(tiersRemove);
    if (add || rem) {
      wanted = new Set(wanted ?? curSet);
      add?.forEach((t) => wanted!.add(t));
      rem?.forEach((t) => wanted!.delete(t));
    }

    const edited = (base: RoomItem): RoomItem => {
      const out = { ...base, ...content } as RoomItem;
      // A rewritten task is a new scope, not the AI's original estimate.
      if (typeof content.detail === "string" && content.detail !== base.detail) {
        delete (out as { aiHrs?: number }).aiHrs;
      }
      return out;
    };
    const place = (item: RoomItem) => {
      // same bucket unless the patch moves trades
      if (newTrade && newTrade !== pos.r.name) {
        pos.r.items.splice(pos.ii, 1);
        putInTrade(newTrade, item);
      } else {
        pos.r.items[pos.ii] = item;
      }
    };

    if (!scope) {
      let item = hasContent ? edited(cur) : cur;
      if (wanted) {
        if (wanted.size === 0) blocked++; // a line must stay in some option
        else if (order(wanted).join() !== order(curSet).join()) { item = { ...item, tiers: order(wanted) }; tiersTouched++; }
      }
      if (item !== cur || (newTrade && newTrade !== pos.r.name)) place(item);
      continue;
    }

    // ── Scoped: only `scope`'s bit may change. ──
    if (wanted) {
      const otherChanged = TIER_KEYS.some((t) => t !== scope && wanted!.has(t) !== curSet.has(t));
      if (otherChanged) blocked++;
    }
    const scopeWanted = wanted ? wanted.has(scope) : curSet.has(scope) || hasContent;
    const inScope = curSet.has(scope);

    if (!scopeWanted) {
      // Take the line out of this option only.
      if (!inScope) continue;
      if (curSet.size === 1) pos.r.items.splice(pos.ii, 1);
      else { pos.r.items[pos.ii] = { ...cur, tiers: order(new Set([...curSet].filter((t) => t !== scope))) }; tiersTouched++; }
      continue;
    }
    if (!hasContent) {
      // Membership only: bring the line into this option.
      if (!inScope) { pos.r.items[pos.ii] = { ...cur, tiers: order(new Set([...curSet, scope])) }; tiersTouched++; }
      continue;
    }
    if (inScope && curSet.size === 1) {
      place(edited(cur)); // this option's own line: edit in place
      continue;
    }
    // Shared (or other-option) line: fork an edited copy into this option and
    // leave the original exactly as it was for the others.
    const copy: RoomItem = { ...edited(cur), id: opts.newId(), tiers: [scope] };
    if (inScope) {
      pos.r.items[pos.ii] = { ...cur, tiers: order(new Set([...curSet].filter((t) => t !== scope))) };
    }
    putInTrade(newTrade || pos.r.name, copy);
    forked++;
    tiersTouched++;
  }

  for (const a of ops.add || []) {
    const tiers = scope ? [scope] : (cleanTiers(a.tiers) ?? cleanTiers(opts.defaultAddTiers));
    const item = {
      id: opts.newId(),
      detail: a.detail,
      condition: a.condition || "-",
      comment: a.comment || a.detail,
      laborHrs: a.laborHrs ?? 1,
      materials: a.materials?.length ? a.materials : [{ n: "Materials", c: 0 }],
      ...(a.sqft ? { sqft: a.sqft } : {}),
      ...(tiers ? { tiers } : {}),
    } as RoomItem;
    if (tiers) tiersTouched++;
    putInTrade(a.trade || "Carpentry", item);
  }

  return { rooms: next.filter((r) => r.items.length > 0), tiersTouched, forked, blocked };
}

/** Per-option line changes between two versions of a quote, e.g.
 *  "Base +2 · Better −5 · Best +3 −1" — shown after every Assist edit so a
 *  change to an option the owner didn't mean to touch is visible at once. */
export function optionDiffSummary(before: Room[], after: Room[], names: { better: string; best: string }): string {
  const sets = (rooms: Room[]) => {
    const m = new Map<TierKey, Map<string, string>>(TIER_KEYS.map((k) => [k, new Map()]));
    for (const r of rooms) for (const it of r.items) {
      const sig = JSON.stringify([it.detail, it.laborHrs, it.materials]);
      for (const t of itemTiers(it)) m.get(t)!.set(it.id, sig);
    }
    return m;
  };
  const a = sets(before), b = sets(after);
  const parts: string[] = [];
  for (const t of TIER_KEYS) {
    const was = a.get(t)!, now = b.get(t)!;
    let plus = 0, minus = 0, edited = 0;
    for (const [id, sig] of now) { if (!was.has(id)) plus++; else if (was.get(id) !== sig) edited++; }
    for (const id of was.keys()) if (!now.has(id)) minus++;
    if (plus || minus || edited) {
      const nm = t === "base" ? "Base" : names[t];
      parts.push(`${nm} ${[plus && `+${plus}`, minus && `−${minus}`, edited && `~${edited}`].filter(Boolean).join(" ")}`);
    }
  }
  return parts.join(" · ");
}
