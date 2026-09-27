/**
 * Pure line-item text rules shared by the quote parser's validateQuote and
 * the approval fingerprint (approval.ts). Kept free of imports so the public
 * /status bundle and the approve API route can use them without pulling in
 * parser.ts (and its Supabase / localStorage dependencies).
 *
 * Why shared: reopening a saved quote in QuoteForge re-runs validateQuote,
 * which rewrites some line details and zeroes supplies-line hours. The
 * approval fingerprint must see a saved quote and the same quote reopened as
 * IDENTICAL, so it canonicalizes with exactly these rules — one copy, so the
 * two can't drift apart.
 */

// The canonical 7 trade buckets (re-exported by parser.ts, which has always
// been its public home).
export const TRADE_CATEGORY_LIST = ["Plumbing", "Electrical", "Carpentry", "HVAC", "Painting", "Flooring", "General"] as const;

/**
 * A materials-only "supplies" line ("Whole Property — Painting Supplies"):
 * its labor is burned during the per-room lines, so validateQuote zeroes its
 * hours rather than double-bill them.
 */
export function isSuppliesOnlyLine(detail: string): boolean {
  const lc = String(detail ?? "").toLowerCase();
  return /\bsupplies\b/.test(lc) && !/install|repair|replace|patch|paint(?:ing)?\s+(?:wall|ceiling|room|trim|door|baseboard)/.test(lc);
}

// Trade names the AI sometimes emits as a line's LOCATION prefix — the 7
// canonical ones plus legacy buckets. "Exterior" / "Appliances" are NOT here:
// they're real zInspector area names ("Exterior — Repaint awning").
const TRADE_LOC_PREFIXES = [...TRADE_CATEGORY_LIST, "Safety", "Compliance", "Cleaning/Hauling"];
const TRADE_LOC_RUN = new RegExp(`^(?:(?:${TRADE_LOC_PREFIXES.join("|")})\\s*[—\\-]\\s*)+`, "i");

/**
 * validateQuote's location normalization of a line's `detail`, given the name
 * of the room/bucket it sits in:
 *   1. A bare detail (no " — " / " - " location separator, not starting with a
 *      trade name) gets the room name prefixed: "Replace faucet" in "Kitchen"
 *      → "Kitchen — Replace faucet".
 *   2. A detail whose location is a TRADE name ("Painting — General
 *      Supplies", "Plumbing — Replace faucet", even repeated) gets that run
 *      replaced by "Whole Property — ", since a trade isn't a place.
 * Idempotent — a normalized detail comes back unchanged.
 */
export function canonicalDetail(detail: string, roomName: string): string {
  let d = String(detail ?? "");
  const roomPrefix = String(roomName ?? "").replace(/\s*[:\/].*/g, "").trim();
  const alreadyHasRoom = TRADE_CATEGORY_LIST.some((t) => d.toLowerCase().startsWith(t.toLowerCase()));
  if (!alreadyHasRoom && !d.includes(" — ") && !d.includes(" - ") && roomPrefix) {
    d = `${roomPrefix} — ${d}`;
  }
  const lc = d.toLowerCase();
  const tradeAsLocation = TRADE_LOC_PREFIXES.some(
    (t) => lc.startsWith(t.toLowerCase() + " —") || lc.startsWith(t.toLowerCase() + " -"),
  );
  if (tradeAsLocation) d = d.replace(TRADE_LOC_RUN, "Whole Property — ");
  return d;
}
