import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// Defense-in-depth on top of auth: cap the work a single call can request so a
// compromised/abusive session can't run up the Anthropic bill, and never let
// the caller pick a non-Claude model.
const MAX_TOKENS_CEILING = 16000;
const MAX_BODY_BYTES = 6_000_000; // inspection pages ride as base64 image blocks

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
    // Preserve the prior contract (client inspects the JSON body itself).
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
