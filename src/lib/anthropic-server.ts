/**
 * Server-only: send one request to Anthropic's Messages API with the app's
 * key, the Sonnet 5.5 server-side refusal fallback, and best-effort usage
 * logging to ai_usage. Shared by /api/ai (the signed-in app) and server jobs
 * that run without a user (the website-lead quote draft).
 */
import { serviceClient } from "./api-auth";

// Approx Anthropic $/million tokens for cost estimation (Phase 0 measurement).
// Estimates only — refine against the real invoice; used for relative tracking.
const PRICING: Record<string, { in: number; out: number; cacheWrite: number; cacheRead: number }> = {
  // Order matters for the prefix match below: more-specific keys first —
  // "claude-sonnet-5" is a prefix of "claude-sonnet-5-5".
  "claude-sonnet-5-5": { in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-sonnet-5": { in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-sonnet-4-6": { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5": { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  "claude-opus-4-8": { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.5 },
};

export async function callClaude(
  body: Record<string, unknown>,
  log: { orgId?: string | null; userId?: string | null; callType?: string },
): Promise<{ status: number; data: Record<string, unknown> }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { status: 500, data: { error: "ANTHROPIC_API_KEY not configured" } };

  // Sonnet 5.5 can decline a request (HTTP 200, stop_reason "refusal").
  // Server-side fallback re-runs "cyber" / "frontier_llm" declines on Claude
  // Sonnet 5 inside the same call; "general_harms" / "bio" /
  // "reasoning_extraction" declines still come back as refusals, so callers
  // check stop_reason (the parse, AI Assist and Troubleshoot do). If the
  // fallback option itself is ever rejected, retry once without it rather
  // than break every AI call.
  const send = (b: Record<string, unknown>, beta?: string) =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        ...(beta ? { "anthropic-beta": beta } : {}),
      },
      body: JSON.stringify(b),
    });
  const withFallback = body.model === "claude-sonnet-5-5" && body.fallbacks === undefined;
  let response = withFallback
    ? await send({ ...body, fallbacks: "default" }, "server-side-fallback-2026-07-01")
    : await send(body);
  let data = await response.json();
  if (withFallback && response.status === 400 && /fallback|beta/i.test(String(data?.error?.message ?? ""))) {
    console.warn("[ai] server-side fallback rejected — retrying without it:", data?.error?.message);
    response = await send(body);
    data = await response.json();
  }

  // Phase 0 — best-effort AI usage logging. Never blocks or breaks the
  // response: a missing ai_usage table or insert error is swallowed.
  try {
    const usage = (data?.usage || {}) as {
      input_tokens?: number; output_tokens?: number;
      cache_creation_input_tokens?: number; cache_read_input_tokens?: number;
    };
    // The model that actually answered (a fallback-served call reports
    // Sonnet 5 here); the request's model if the response lacks one.
    const model = (typeof data?.model === "string" && data.model) || (body.model as string);
    // Prefix match so dated snapshots (e.g. claude-haiku-4-5-20251001) map to
    // their rate row.
    const rateKey = Object.keys(PRICING).find((k) => model.startsWith(k)) || "claude-sonnet-5";
    const rate = PRICING[rateKey];
    const inTok = usage.input_tokens || 0;
    const outTok = usage.output_tokens || 0;
    const cacheWrite = usage.cache_creation_input_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const estCost =
      (inTok * rate.in + outTok * rate.out + cacheWrite * rate.cacheWrite + cacheRead * rate.cacheRead) /
      1_000_000;
    await serviceClient().from("ai_usage").insert({
      org_id: log.orgId || null,
      user_id: log.userId || null,
      call_type: log.callType || "other",
      model,
      input_tokens: inTok,
      output_tokens: outTok,
      cache_creation_tokens: cacheWrite,
      cache_read_tokens: cacheRead,
      est_cost: Number(estCost.toFixed(6)),
    });
  } catch {
    /* logging is best-effort — ignore */
  }
  return { status: response.status, data };
}
