// Good-Better-Best tier membership.
//
// Historically each quote line carried a single `tier` and the three options
// were CUMULATIVE (base ⊆ better ⊆ best): a tier's scope was every item at or
// below its rank. That can't express mutually-exclusive options — e.g. a shed
// pad quoted as a gravel base (Good/Better) vs. a poured concrete slab (Best
// only), where Best must EXCLUDE the gravel.
//
// The model is now per-item MEMBERSHIP: `tiers` is the explicit set of options
// a line appears in. Legacy items (only `tier`, no `tiers`) fall back to the
// cumulative interpretation so pre-membership quotes render identically.

export type TierKey = "base" | "better" | "best";
export const TIER_KEYS: readonly TierKey[] = ["base", "better", "best"];
const RANK: Record<TierKey, number> = { base: 0, better: 1, best: 2 };

type TierItem = { tiers?: TierKey[] | null; tier?: string | null };

/** Cumulative tier set for a legacy single-tier tag (base ∈ all three,
 *  better ∈ better+best, best ∈ best only). */
export function cumulativeTiers(tier?: string | null): TierKey[] {
  const r = RANK[tier as TierKey] ?? 0;
  return TIER_KEYS.filter((k) => r <= RANK[k]);
}

/** The set of options a line item belongs to — explicit membership when set,
 *  else the legacy cumulative fallback. */
export function itemTiers(item: TierItem): TierKey[] {
  if (Array.isArray(item?.tiers)) {
    return item.tiers.filter((t): t is TierKey => (TIER_KEYS as readonly string[]).includes(t));
  }
  return cumulativeTiers(item?.tier);
}

/** Is a line item part of the given option? */
export function itemInTier(item: TierItem, tier: TierKey): boolean {
  if (Array.isArray(item?.tiers)) return item.tiers.includes(tier);
  return (RANK[item?.tier as TierKey] ?? 0) <= RANK[tier];
}

/** What sets an option apart from the one before it (Better vs Base, Best vs
 *  Better), so the customer sees the DIFFERENCE instead of three near-identical
 *  lists. Base has no previous option: everything is `added`. */
export type TierDelta<T> = { tier: TierKey; prev: TierKey | null; items: T[]; added: T[]; removed: T[] };
export function tierDeltas<T extends TierItem>(items: T[]): TierDelta<T>[] {
  return TIER_KEYS.map((tier, i) => {
    const inThis = items.filter((it) => itemInTier(it, tier));
    if (i === 0) return { tier, prev: null, items: inThis, added: inThis, removed: [] };
    const prev = TIER_KEYS[i - 1];
    return {
      tier,
      prev,
      items: inThis,
      added: inThis.filter((it) => !itemInTier(it, prev)),
      removed: items.filter((it) => itemInTier(it, prev) && !itemInTier(it, tier)),
    };
  });
}

/** Materials-only "supplies" lines (no labor, priced materials) that two or
 *  more options share although that trade's work differs between them — e.g.
 *  one paint-supplies line shared by a touch-up Base and a full-repaint Best,
 *  which under-buys paint for Best or over-charges Base. Each option should
 *  carry its own supplies line sized to its own scope. */
export function sharedSuppliesLines<
  I extends TierItem & { detail: string; laborHrs: number; materials: { c: number }[] },
>(rooms: { name: string; items: I[] }[]): I[] {
  const out: I[] = [];
  for (const r of rooms) {
    for (const it of r.items) {
      const mat = it.materials.reduce((s, m) => s + (m.c || 0), 0);
      if ((it.laborHrs || 0) > 0 || mat <= 0) continue;
      const shared = itemTiers(it);
      if (shared.length < 2) continue;
      // The trade's real work differs across the options this line spans.
      const differs = r.items.some((o) =>
        o !== it && (o.laborHrs || 0) > 0 && shared.some((t) => itemInTier(o, t)) && !shared.every((t) => itemInTier(o, t)),
      );
      if (differs) out.push(it);
    }
  }
  return out;
}

/** Short customer-facing label for which options a line belongs to, or null
 *  when it's in all three (no tag needed). */
export function tierMembershipLabel(item: TierItem, names: { better: string; best: string }): string | null {
  const ts = itemTiers(item);
  if (ts.length === 3) return null;
  if (ts.length === 0) return "Not in any option";
  const nm = (t: TierKey) => (t === "base" ? "Base" : names[t]);
  return ts.map(nm).join(" & ") + " only";
}
