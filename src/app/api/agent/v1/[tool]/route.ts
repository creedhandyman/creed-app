import { NextRequest, NextResponse } from "next/server";
import { authenticateKey, bearerKey, runTool, toolByName } from "@/lib/agent/server";

export const dynamic = "force-dynamic";
// draft_quote waits for the AI (~30–90 s).
export const maxDuration = 300;

/**
 * Agent API, REST form: POST /api/agent/v1/<tool> with
 * `Authorization: Bearer creed_sk_…` and the tool's arguments as the JSON
 * body. Same tools, checks and activity log as the MCP endpoint (/api/mcp).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  const ctx = await authenticateKey(bearerKey(req.headers));
  if (!ctx) return NextResponse.json({ error: "invalid or revoked API key" }, { status: 401 });
  if (!toolByName(tool)) return NextResponse.json({ error: "unknown tool" }, { status: 404 });
  let args: unknown = {};
  try { args = await req.json(); } catch { /* empty body = no arguments */ }
  const r = await runTool(ctx, tool, args, "rest");
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}
