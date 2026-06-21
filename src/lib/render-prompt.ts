import type { Room, RoomItem } from "@/lib/types";

/**
 * Build an AI-render prompt from a quote's line items.
 *
 * The line items read like work orders ("R&R fill valve, set closet bolts").
 * Feeding those verbatim makes a bad image prompt, so we translate only the
 * VISIBLE scope (paint, floors, fixtures, blinds…) into render language and
 * silently drop the hidden / plumbing-internals / safety items. The caller
 * surfaces `usedCount` / `skipped` so the owner trusts what it did, and the
 * box stays fully editable before Generate.
 */

// Map a line item to a SHORT visual instruction, or nothing if it isn't
// visible in a beauty shot. Keyword match runs over `${detail} ${comment}`.
const VISUAL_RULES: { test: RegExp; phrase: string }[] = [
  { test: /\b(lvp|luxury vinyl|vinyl plank|laminate|flooring|floor|hardwood|carpet|tile floor)\b/, phrase: "replace flooring with light-gray wide-plank luxury vinyl" },
  { test: /\b(paint|repaint|wall|drywall|patch|primer)\b/,                      phrase: "repaint walls a clean off-white" },
  { test: /\b(ceiling|popcorn)\b/,                                              phrase: "smooth, freshly painted white ceiling" },
  { test: /\b(blind|shade|window covering|curtain)\b/,                          phrase: "install new white window blinds" },
  { test: /\b(door|six-panel|6-panel|slab)\b/,                                  phrase: "new painted six-panel interior doors" },
  { test: /\b(vanity|sink cabinet)\b/,                                          phrase: "new bathroom vanity" },
  { test: /\b(cabinet|cupboard)\b/,                                             phrase: "refinished cabinets" },
  { test: /\b(countertop|counter top|laminate top)\b/,                          phrase: "new countertops" },
  { test: /\b(backsplash|tile)\b/,                                              phrase: "tiled backsplash" },
  { test: /\b(light fixture|lighting|ceiling fan|chandelier|sconce)\b/,         phrase: "new modern light fixture" },
  { test: /\b(outlet cover|switch plate|cover plate)\b/,                        phrase: "clean white outlet and switch covers" },
  { test: /\b(baseboard|trim|casing|crown)\b/,                                  phrase: "crisp white baseboards and trim" },
  { test: /\b(mirror|medicine cabinet)\b/,                                      phrase: "new bathroom mirror" },
  { test: /\b(faucet|fixture)\b.*\b(sink|tub|shower)\b/,                        phrase: "new chrome plumbing fixtures" },
];

function itemPhrases(it: RoomItem): string[] {
  const hay = `${it.detail} ${it.comment}`.toLowerCase();
  return VISUAL_RULES.filter((r) => r.test.test(hay)).map((r) => r.phrase);
}

export function buildRenderPrompt(rooms: Room[], onlyRoom?: string): {
  prompt: string; usedCount: number; skipped: number;
} {
  const scoped = onlyRoom ? rooms.filter((r) => r.name === onlyRoom) : rooms;
  const items = scoped.flatMap((r) => r.items);
  const phrases = new Set<string>();
  let used = 0;
  for (const it of items) {
    const p = itemPhrases(it);
    if (p.length) { used++; p.forEach((x) => phrases.add(x)); }
  }
  const skipped = items.length - used;
  const changes = [...phrases];
  const body = changes.length
    ? changes.join(". ").replace(/^./, (c) => c.toUpperCase()) + "."
    : "Refresh finishes to a clean, move-in-ready condition.";
  const prompt =
    "Photorealistic interior rendering. Same room, same camera angle, same " +
    "layout and windows. " + body + " Show as freshly renovated, professionally " +
    "cleaned, bright natural light, real-estate photography style.";
  return { prompt, usedCount: used, skipped };
}
