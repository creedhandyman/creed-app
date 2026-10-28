/**
 * Server-only: send one multipart request to OpenAI (gpt-image-1 renders,
 * Whisper transcription) with the app's key, and log it to ai_usage
 * (best-effort, like anthropic-server.ts). Returns the raw status + body text
 * so each route keeps its own parsing and error contract.
 */
import { logAiUsage, type AiUsageLog } from "./ai-usage";

// Rough $ per call when the response carries no token usage — estimates for
// relative tracking only (gpt-image-1 1024px by quality; whisper per minute).
const IMAGE_PER_CALL: Record<string, number> = { low: 0.011, medium: 0.042, high: 0.167, auto: 0.042 };
const WHISPER_PER_MIN = 0.006;
// gpt-image-1 $/million tokens: text input, image input, image output.
const IMAGE_RATE = { textIn: 5, imageIn: 10, out: 40 };

/** ai_usage figures for one OpenAI response (exported for the test). */
export function openaiUsage(
  model: string,
  status: number,
  text: string,
  opts: { quality?: string } = {},
): { inputTokens: number; outputTokens: number; estCost: number } {
  const ok = status >= 200 && status < 300;
  let usage: {
    input_tokens?: number; output_tokens?: number;
    input_tokens_details?: { text_tokens?: number; image_tokens?: number };
    type?: string; seconds?: number;
  } = {};
  try {
    const u = (JSON.parse(text) as { usage?: unknown })?.usage;
    if (u && typeof u === "object") usage = u as typeof usage;
  } catch { /* non-JSON body — no usage */ }
  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  if (!ok) return { inputTokens: inTok, outputTokens: outTok, estCost: 0 };
  if (model.startsWith("gpt-image")) {
    if (inTok || outTok) {
      const imgIn = usage.input_tokens_details?.image_tokens ?? 0;
      const textIn = usage.input_tokens_details?.text_tokens ?? Math.max(0, inTok - imgIn);
      const cost = (textIn * IMAGE_RATE.textIn + imgIn * IMAGE_RATE.imageIn + outTok * IMAGE_RATE.out) / 1_000_000;
      return { inputTokens: inTok, outputTokens: outTok, estCost: cost };
    }
    return { inputTokens: 0, outputTokens: 0, estCost: IMAGE_PER_CALL[opts.quality || "low"] ?? IMAGE_PER_CALL.low };
  }
  if (model.startsWith("whisper")) {
    // Whisper reports {type:"duration", seconds} when it reports usage at all.
    const secs = usage.type === "duration" && typeof usage.seconds === "number" ? usage.seconds : 0;
    return { inputTokens: inTok, outputTokens: outTok, estCost: (secs / 60) * WHISPER_PER_MIN };
  }
  return { inputTokens: inTok, outputTokens: outTok, estCost: 0 };
}

export async function callOpenAI(
  path: string,
  form: FormData,
  log: AiUsageLog & { model: string; quality?: string },
): Promise<{ status: number; ok: boolean; text: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { status: 503, ok: false, text: JSON.stringify({ error: "OPENAI_API_KEY not configured" }) };
  const res = await fetch(`https://api.openai.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const text = await res.text();
  try {
    await logAiUsage(log, { model: log.model, ...openaiUsage(log.model, res.status, text, { quality: log.quality }) });
  } catch {
    /* logging is best-effort — ignore */
  }
  return { status: res.status, ok: res.ok, text };
}
