// Tier builder (2026-11-14). When a quote has 2+ lines but every line is
// must-fix, the three tiers all cost the same — the customer would see three
// identical prices. This asks the AI for what a good contractor would ADD for
// Complete (recommended) and Premium (upgrades) on top of the existing scope,
// or for a plain "too small to tier" answer. It never changes, removes or
// re-prices the existing lines.
//
// Pure: the prompt and the reply parsing. The API call lives in
// tier-build-client.ts; QuoteForge merges the lines with applyAssistOps.

import type { AssistAdd } from "./assist-ops";
import type { Room } from "./types";
import { itemTiers, tiersForLevel, type TierKey } from "./tiers";

/** Most add-on lines one build may add (per level). */
export const MAX_TIER_ADDS_PER_LEVEL = 3;

/** Append the builder's lines (already validated on their own, caps ON) to
 *  the quote: into the room of the same name, else as a new room. Existing
 *  lines and rooms are untouched and keep their order. */
export function appendRooms(base: Room[], added: Room[]): Room[] {
  const out = base.map((r) => ({ ...r, items: [...r.items] }));
  for (const a of added) {
    const target = out.find((r) => r.name === a.name);
    if (target) target.items.push(...a.items);
    else out.push({ ...a, items: [...a.items] });
  }
  return out;
}

/** Is there anything a customer could choose between? (a line outside Essential,
 *  or one Essential-only line Premium replaces) */
export function quoteHasTierSplit(rooms: { items: { tiers?: TierKey[] | null; tier?: string | null }[] }[]): boolean {
  return rooms.some((r) => (r.items || []).some((it) => itemTiers(it).length !== 3));
}

export const TIER_BUILD_ADDENDUM = `

## TIER BUILDER — OUTPUT FORMAT OVERRIDE

The user message lists an EXISTING quote whose lines are all must-fix (the Essential tier). The customer will be offered three cumulative tiers: Essential = the existing lines, Complete (recommended) = Essential + your "recommended" lines, Premium = Complete + your "upgrade" lines. Propose ONLY the extra lines. Never change, remove, repeat or re-price an existing line.

- "recommended": work a good contractor would advise doing at the same visit for THIS scope — it makes the work last, prevents a callback, or finishes the job properly (e.g. landscape fabric under a gravel bed, primer before paint, a new shutoff valve while the wall is open, sealing after grout).
- "upgrade": a better-than-needed version or a real nice-to-have. Price it ONLY for the extra — the material price difference plus any extra labor — never a second full copy of an existing line ("Upgrade border to cedar (+ over pine)", not "Build wood border").
- Up to ${MAX_TIER_ADDS_PER_LEVEL} recommended and up to ${MAX_TIER_ADDS_PER_LEVEL} upgrade lines, each genuine for this job — no padding, no unrelated work, no "inspect" lines. Follow every pricing / labor / material rule above. Use the same trade buckets and "Area — Task" detail style as the existing lines.
- If the scope is a small repair where nothing genuine exists to recommend or upgrade, return an empty "add" with "tooSmall": true and a one-sentence "reason" the contractor will read (e.g. "A single faucet swap — nothing worth adding.").

Return ONLY this JSON:
{"add":[{"trade":"Carpentry","detail":"Patio — Upgrade border to cedar","comment":"Lasts longer than pine in ground contact","condition":"-","laborHrs":0.5,"materials":[{"n":"Cedar 2x6 upgrade (difference)","c":60}],"level":"upgrade"}],"tooSmall":false,"reason":""}`;

/** The user message: the existing lines (read-only) and the job. */
export function tierBuildUserMessage(rooms: Room[], property: string): string {
  const lines = rooms.flatMap((r) =>
    (r.items || []).map((it) => ({
      trade: r.name,
      detail: it.detail,
      laborHrs: it.laborHrs,
      materials: (it.materials || []).map((m) => ({ n: m.n, c: m.c })),
    })),
  );
  return (
    `Property: ${property || "this property"}\n\n` +
    `EXISTING QUOTE LINES — all must-fix / Essential (${lines.length}), read-only:\n` +
    lines.map((l) => `- ${JSON.stringify(l)}`).join("\n") +
    `\n\nPropose the Complete (recommended) and Premium (upgrade) add-on lines, or say it's too small to tier. Return the JSON described in the TIER BUILDER section.`
  );
}

export interface TierBuildResult {
  /** Ready for applyAssistOps: tiers already set (recommended → Complete +
   *  Premium, upgrade → Premium only). */
  adds: AssistAdd[];
  tooSmall: boolean;
  reason: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** Parse the AI's reply. Anything malformed is dropped; a reply with no usable
 *  line reads as "too small" (with the AI's reason when it gave one). */
export function parseTierBuild(text: string): TierBuildResult {
  const match = text.match(/\{[\s\S]*\}/);
  let raw: { add?: unknown; tooSmall?: unknown; reason?: unknown } = {};
  try { raw = match ? JSON.parse(match[0]) : {}; } catch { raw = {}; }
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  const counts: Record<"better" | "best", number> = { better: 0, best: 0 };
  const adds: AssistAdd[] = [];
  for (const a of Array.isArray(raw.add) ? raw.add : []) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    const detail = typeof o.detail === "string" ? o.detail.trim() : "";
    const lvl = typeof o.level === "string" ? o.level.trim().toLowerCase() : "";
    const tier: "better" | "best" | null = /^recommend/.test(lvl) ? "better" : /^(upgrade|premium)/.test(lvl) ? "best" : null;
    if (!detail || !tier || counts[tier] >= MAX_TIER_ADDS_PER_LEVEL) continue;
    const materials = (Array.isArray(o.materials) ? o.materials : [])
      .map((m) => (m && typeof m === "object" ? (m as Record<string, unknown>) : null))
      .filter((m): m is Record<string, unknown> => !!m && typeof m.n === "string" && num(m.c) !== null)
      .map((m) => ({ n: String(m.n), c: num(m.c) as number }));
    const laborHrs = num(o.laborHrs) ?? 0;
    // A line that costs nothing changes no price — it can't make a tier.
    if (laborHrs <= 0 && materials.every((m) => m.c <= 0)) continue;
    counts[tier]++;
    adds.push({
      trade: typeof o.trade === "string" && o.trade.trim() ? o.trade.trim() : "General",
      detail,
      comment: typeof o.comment === "string" ? o.comment : "",
      condition: "-",
      laborHrs,
      materials,
      tiers: tiersForLevel(tier),
    });
  }
  return { adds, tooSmall: adds.length === 0, reason: adds.length ? "" : reason };
}
