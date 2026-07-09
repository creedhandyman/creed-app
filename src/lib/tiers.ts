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
