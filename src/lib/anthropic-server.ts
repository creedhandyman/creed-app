/**
 * Server-only: send one request to Anthropic's Messages API with the app's
 * key, the Sonnet 5.5 server-side refusal fallback, and best-effort usage
 * logging to ai_usage. EVERY Anthropic call goes through here: /api/ai (the
 * signed-in app), /api/ai/receipt, /api/tax/material-rate, and server jobs
 * that run without a user (the website-lead quote draft). Callers keep their
 * own model / max_tokens / tools; this owns the key, headers, fallback + log.
 */
import { logAiUsage, type AiUsageLog } from "./ai-usage";
import { readMessageStream } from "./anthropic-stream";

/** Replies allowed to run longer than this are read as a stream, so a slow
 *  one can be stopped at the deadline and returned partial instead of dying
 *  with the server function (see anthropic-stream.ts). */
export const STREAM_ABOVE_TOKENS = 16000;
/** How long a streamed reply may run. The routes that make long calls allow
 *  300s; this leaves room for auth, the usage log and the response. */
export const STREAM_DEADLINE_MS = 255_000;

// Approx Anthropic $/million tokens for cost estimation (Phase 0 measurement).
// Estimates only — refine against the real invoice; used for relative tracking.
const PRICING: Record<string, { in: number; out: number; cacheWrite: number; cacheRead: number }> = {
  // Order matters for the prefix match below: more-specific keys first —
  // "claude-sonnet-5" is a prefix of "claude-sonnet-5-5".
  "claude-sonnet-5-5": { in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-sonnet-5": { in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-sonnet-4-6": { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheWrite: 0.125, cacheRead: 0.01 }, // prompts ≤100K tokens
  "claude-haiku-4-5": { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  "claude-opus-4-8": { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.5 },
};

export async function callClaude(
  body: Record<string, unknown>,
  log: AiUsageLog,
  opts: { deadlineMs?: number } = {},
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
  const startedAt = Date.now();
  const stream = Number(body.max_tokens) > STREAM_ABOVE_TOKENS && body.stream === undefined;
  const post = (b: Record<string, unknown>, beta?: string) =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        ...(beta ? { "anthropic-beta": beta } : {}),
      },
      body: JSON.stringify(stream ? { ...b, stream: true } : b),
    });
  const send = async (b: Record<string, unknown>, beta?: string): Promise<{ status: number; data: Record<string, unknown> }> => {
    const response = await post(b, beta);
    if (!stream || !response.ok || !response.body) return { status: response.status, data: await response.json() };
    const { message, error } = await readMessageStream(response.body, {
      deadlineAt: startedAt + (opts.deadlineMs ?? STREAM_DEADLINE_MS),
    });
    // An error after the stream opened (overloaded, …) — report it the way a
    // failed non-streamed call would be.
    if (error) return { status: 502, data: { type: "error", error } };
    return { status: response.status, data: message };
  };
  const withFallback = body.model === "claude-sonnet-5-5" && body.fallbacks === undefined;
  let response = withFallback
    ? await send({ ...body, fallbacks: "default" }, "server-side-fallback-2026-07-01")
    : await send(body);
  let data = response.data;
  const errMessage = (d: Record<string, unknown>) => String((d.error as { message?: unknown } | undefined)?.message ?? "");
  if (withFallback && response.status === 400 && /fallback|beta/i.test(errMessage(data))) {
    console.warn("[ai] server-side fallback rejected — retrying without it:", errMessage(data));
    response = await send(body);
    data = response.data;
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
    const model = (typeof data?.model === "string" && data.model) || String(body.model ?? "");
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
    await logAiUsage(log, {
      model, inputTokens: inTok, outputTokens: outTok,
      cacheWriteTokens: cacheWrite, cacheReadTokens: cacheRead, estCost,
    });
  } catch {
    /* logging is best-effort — ignore */
  }
  return { status: response.status, data };
}
