import { NextRequest, NextResponse } from "next/server";
import { requireAuth, serviceClient } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// Defense-in-depth on top of auth: cap the work a single call can request so a
// compromised/abusive session can't run up the Anthropic bill, and never let
// the caller pick a non-Claude model.
const MAX_TOKENS_CEILING = 16000;
const MAX_BODY_BYTES = 6_000_000; // inspection pages ride as base64 image blocks

// Approx Anthropic $/million tokens for cost estimation (Phase 0 measurement).
// Estimates only — refine against the real invoice; used for relative tracking.
const PRICING: Record<string, { in: number; out: number; cacheWrite: number; cacheRead: number }> = {
  "claude-sonnet-4-6": { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5": { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  "claude-opus-4-8": { in: 15, out: 75, cacheWrite: 18.75, cacheRead: 1.5 },
};

export async function POST(req: NextRequest) {
  // Previously this was an OPEN proxy to Anthropic with our key — anyone could
  // use it as a free, uncapped Claude. Require a logged-in session.
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }
    const body = JSON.parse(raw) as { model?: unknown; max_tokens?: unknown; [k: string]: unknown };

    if (typeof body.model !== "string" || !body.model.startsWith("claude-")) {
      return NextResponse.json({ error: "Unsupported model" }, { status: 400 });
    }
    if (typeof body.max_tokens === "number") {
      body.max_tokens = Math.min(body.max_tokens, MAX_TOKENS_CEILING);
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();

    // Phase 0 — best-effort AI usage logging. Never blocks or breaks the
    // response: a missing ai_usage table or insert error is swallowed.
    try {
      const usage = (data?.usage || {}) as {
        input_tokens?: number; output_tokens?: number;
        cache_creation_input_tokens?: number; cache_read_input_tokens?: number;
      };
      const model = body.model as string;
      const rate = PRICING[model] || PRICING["claude-sonnet-4-6"];
      const inTok = usage.input_tokens || 0;
      const outTok = usage.output_tokens || 0;
      const cacheWrite = usage.cache_creation_input_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;
      const estCost =
        (inTok * rate.in + outTok * rate.out + cacheWrite * rate.cacheWrite + cacheRead * rate.cacheRead) /
        1_000_000;
      await serviceClient().from("ai_usage").insert({
        org_id: req.headers.get("x-creed-org") || null,
        user_id: auth.userId,
        call_type: req.headers.get("x-creed-call-type") || "other",
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

    // Preserve the prior contract (client inspects the JSON body itself).
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
