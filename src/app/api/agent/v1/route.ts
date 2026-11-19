import { NextRequest, NextResponse } from "next/server";
import { authenticateKey, bearerKey, TOOLS } from "@/lib/agent/server";

export const dynamic = "force-dynamic";

/** GET /api/agent/v1 — the tools this key may call, with their input schemas. */
export async function GET(req: NextRequest) {
  const ctx = await authenticateKey(bearerKey(req.headers));
  if (!ctx) return NextResponse.json({ error: "invalid or revoked API key" }, { status: 401 });
  return NextResponse.json({
    tools: TOOLS.filter((t) => ctx.scopes.includes(t.scope)).map((t) => ({
      name: t.name, description: t.description, scope: t.scope, input_schema: t.inputSchema,
      url: `/api/agent/v1/${t.name}`,
    })),
  });
}
