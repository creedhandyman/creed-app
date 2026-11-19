import { NextRequest, NextResponse } from "next/server";
import { authenticateKey, bearerKey, runTool } from "@/lib/agent/server";
import { handleRpc, type RpcRequest } from "@/lib/agent/mcp";

export const dynamic = "force-dynamic";
// draft_quote waits for the AI (~30–90 s).
export const maxDuration = 300;

/**
 * MCP endpoint: https://www.creedhm.com/api/mcp (Streamable HTTP, JSON
 * responses). Auth: `Authorization: Bearer creed_sk_…` — a key made in
 * Ops → Settings → AI assistant connection. Tools: lib/agent/server.ts.
 */
export async function POST(req: NextRequest) {
  const ctx = await authenticateKey(bearerKey(req.headers));
  if (!ctx) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "invalid or revoked API key" } },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="creed"' } },
    );
  }
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const call = (name: string, args: unknown) => runTool(ctx, name, args, "mcp");
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.slice(0, 20).map((m) => handleRpc(m as RpcRequest, ctx.scopes, call)))).filter(Boolean);
    return out.length ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
  }
  const res = await handleRpc(body as RpcRequest, ctx.scopes, call);
  return res ? NextResponse.json(res) : new NextResponse(null, { status: 202 });
}

/** No server-initiated stream. */
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
