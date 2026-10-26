/**
 * Guide shopping list order — shared by WorkVision's and QuoteForge's Guide
 * tabs.
 *
 * Editing a quote-derived item "adopts" an edited copy into customShop and
 * hides the original (removedGuideShop). The list used to be auto items then
 * every custom item, so an edited item jumped out of its trade section to the
 * bottom (with its trade header repeated). Now:
 *   - an edited copy (`replaces` = the original's key) takes the original's
 *     exact spot;
 *   - other custom items join the end of their own trade's section;
 *   - general / "added on site" / no-trade items go at the very bottom.
 */
export type GuideShopItem = {
  n: string; c: number; qty?: number; unitPrice?: number; room?: string; trade?: string;
  /** shopKey of the quote-derived item this edited copy stands in for */
  replaces?: string;
};

const GENERAL = new Set(["", "general", "added", "added on site", "custom"]);
const tradeOf = (s: GuideShopItem) => (s.trade || "").toLowerCase().trim();

export function orderShopList<A extends GuideShopItem, C extends GuideShopItem>(
  auto: A[],
  removed: string[],
  custom: C[],
  keyOf: (s: A | C) => string,
): (A | C)[] {
  type T = A | C;
  const used = new Set<C>();
  const out: T[] = [];
  for (const a of auto) {
    const k = keyOf(a);
    if (!removed.includes(k)) { out.push(a); continue; }
    const rep = custom.find((c) => c.replaces === k && !used.has(c));
    if (rep) { out.push(rep); used.add(rep); }
  }
  const other: T[] = [];
  const general: T[] = [];
  for (const c of custom) {
    if (used.has(c)) continue;
    const tr = tradeOf(c);
    if (GENERAL.has(tr)) { general.push(c); continue; }
    let j = -1;
    out.forEach((s, i) => { if (tradeOf(s) === tr) j = i; });
    if (j >= 0) out.splice(j + 1, 0, c);
    else other.push(c);
  }
  return [...out, ...other, ...general];
}
