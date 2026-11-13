// Quote tier membership (Essential / Complete / Premium — was Good-Better-Best).
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
  void names; // names are fixed now (TIER_NAME); the param stays for callers
  const nm = (t: TierKey) => TIER_NAME[t];
  return ts.map(nm).join(" & ") + " only";
}

// ── Three-tier quoting (2026-11-12) ─────────────────────────────────────────
// Essential / Complete / Premium is THE way Creed quotes (it replaced the
// renameable Good-Better-Best option). The stored keys stay base/better/best
// so every saved quote, approval and work order keeps reading the same way;
// only the names are fixed. Tiers are CUMULATIVE: Essential = the must-fix
// items, Complete adds the recommended ones, Premium adds the upgrades. The AI
// tags each line's level while it builds the quote (aiParsePdf → `level`);
// the owner can move a line to another tier before sending.

export const TIER_NAME: Record<TierKey, string> = { base: "Essential", better: "Complete", best: "Premium" };
/** The tier the customer page highlights and the quote's headline price. */
export const RECOMMENDED_TIER: TierKey = "better";
export const tierName = (k: TierKey): string => TIER_NAME[k];
/** The fixed names in the old `{better, best}` shape some callers take. */
export const TIER_NAMES = { better: TIER_NAME.better, best: TIER_NAME.best } as const;

/** The AI's scope level for a line → the tier it starts in. Accepts the
 *  prompt's words (must-fix / recommended / upgrade) and the tier names. */
export function levelToTier(level: unknown): TierKey | null {
  const s = typeof level === "string" ? level.trim().toLowerCase() : "";
  if (!s) return null;
  if (/^(must|essential|required|base)/.test(s)) return "base";
  if (/^(recommend|complete|better|should)/.test(s)) return "better";
  if (/^(upgrade|premium|best|nice|optional)/.test(s)) return "best";
  return null;
}

/** The lowest tier a line is in — its "level" (Essential = in all three).
 *  A line in no tier reads as Premium so it never vanishes from the editor. */
export function itemLevel(item: TierItem): TierKey {
  const ts = itemTiers(item);
  return TIER_KEYS.find((k) => ts.includes(k)) ?? "best";
}

/** Membership for a line moved to `level` (cumulative: it's in that tier and
 *  every tier above it). */
export const tiersForLevel = (level: TierKey): TierKey[] => cumulativeTiers(level);

/** Stamp the AI's `level` as tier membership and drop the raw field. Lines
 *  without a level are must-fix (in every tier). */
export function applyAiLevels<I extends Record<string, unknown>>(item: I): Omit<I, "level"> & { tiers?: TierKey[] } {
  const { level, ...rest } = item as I & { level?: unknown };
  const t = levelToTier(level);
  return t ? { ...rest, tiers: tiersForLevel(t) } : rest;
}

/** Does this quote get three tiers? Small single-item jobs get one price, and
 *  so does a quote where every line is must-fix (three identical tiers say
 *  nothing). */
export function shouldOfferTiers(rooms: { items: TierItem[] }[]): boolean {
  const items = rooms.flatMap((r) => r.items || []);
  if (items.length < 2) return false;
  return items.some((it) => itemLevel(it) !== "base");
}

/** The tiers worth showing a customer: Essential always, and each higher tier
 *  only when it changes the scope of the one below it (Complete with nothing
 *  recommended would just repeat Essential's price). */
export function visibleTiers<T extends TierItem>(items: T[]): TierKey[] {
  return tierDeltas(items)
    .filter((d) => !d.prev || d.added.length > 0 || d.removed.length > 0)
    .map((d) => d.tier);
}

/** The price line a Send text uses for a tiered quote, e.g.
 *  "Essential $480 · Complete $725 (recommended) · Premium $1,040". A tier
 *  priced the same as the one below it is left out (it adds nothing). */
export function tierPriceLine(tt: Partial<Record<TierKey, unknown>> | null | undefined): string | null {
  if (!tt) return null;
  const fmt = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const parts: string[] = [];
  let prev: number | null = null;
  for (const k of TIER_KEYS) {
    const v = tt[k];
    if (typeof v !== "number" || !(v > 0)) continue;
    if (prev !== null && Math.abs(v - prev) < 0.005) continue;
    parts.push(`${TIER_NAME[k]} ${fmt(v)}${k === RECOMMENDED_TIER ? " (recommended)" : ""}`);
    prev = v;
  }
  return parts.length > 1 ? parts.join(" · ") : null;
}
