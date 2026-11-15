// The tier builder's AI call (see tier-build.ts for what it asks and how the
// reply is read). Sonnet 5.5, the cached pricing rules (same first block as
// the parse) + the builder addendum, logged in ai_usage as "tiers".

import { apiFetch } from "./api";
import { AI_SYSTEM_PROMPT_BASE, aiText } from "./parser";
import { TIER_BUILD_ADDENDUM, parseTierBuild, tierBuildUserMessage, type TierBuildResult } from "./tier-build";
import type { Room } from "./types";

/** null = the call failed (network / refusal / cut off) — the caller says so
 *  and leaves the quote as it is. */
export async function aiBuildTiers(
  rooms: Room[],
  opts: { property: string; laborRate: number; licensedTrades?: string[] },
): Promise<TierBuildResult | null> {
  try {
    const res = await apiFetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-creed-call-type": "tiers" },
      body: JSON.stringify({
        model: "claude-sonnet-5-5",
        thinking: { type: "between_tools" },
        output_config: { effort: "high" },
        max_tokens: 4000,
        // BASE alone first, exactly like the parse's first block, so this
        // call reads the cache entry the parse wrote seconds earlier; the
        // builder addendum is its own (small) cached block after it.
        system: [
          { type: "text", text: AI_SYSTEM_PROMPT_BASE, cache_control: { type: "ephemeral" } },
          { type: "text", text: TIER_BUILD_ADDENDUM, cache_control: { type: "ephemeral" } },
          {
            type: "text",
            text:
              `Labor rate: $${opts.laborRate || 55}.00/hour.\n\n` +
              (opts.licensedTrades?.length
                ? `This business holds licenses for: ${opts.licensedTrades.join(", ")}. FULLY QUOTE work in these trades.\n\n`
                : ""),
          },
        ],
        messages: [{ role: "user", content: [{ type: "text", text: tierBuildUserMessage(rooms, opts.property) }] }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.error || data?.stop_reason === "refusal" || data?.stop_reason === "max_tokens") return null;
    return parseTierBuild(aiText(data.content));
  } catch {
    return null;
  }
}
