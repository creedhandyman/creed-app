import { NextRequest, NextResponse } from "next/server";
import { authenticateKey, bearerKey, runTool } from "@/lib/agent/server";
import { handleRpc, type RpcRequest } from "@/lib/agent/mcp";
import { trustedOrigin } from "@/lib/oauth/core";
import { siteOrigin } from "@/lib/site-url";

export const dynamic = "force-dynamic";
// draft_quote waits for the AI (~30–90 s).
export const maxDuration = 300;

/**
 * MCP endpoint: https://www.creedhm.com/api/mcp (Streamable HTTP, JSON
 * responses). Auth: `Authorization: Bearer creed_sk_…` — a key made in
 * Ops → Settings → AI assistant connection. Tools: lib/agent/server.ts.
 */
export async function POST(req: NextRequest) {
  const presented = bearerKey(req.headers);
  const ctx = await authenticateKey(presented);
  if (!ctx) {
    // Points an OAuth client (claude.ai) at "Sign in with Creed" (MCP
    // authorization spec / RFC 9728). A bad or expired token says so, so the
    // client refreshes instead of starting over.
    const origin = trustedOrigin(req.headers.get("host"), siteOrigin());
    const meta = `${origin}/.well-known/oauth-protected-resource/api/mcp`;
    const challenge = `Bearer realm="creed", resource_metadata="${meta}"${presented ? ', error="invalid_token"' : ""}`;
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: presented ? "invalid, expired or revoked credentials" : "sign in with Creed or use an API key" } },
      { status: 401, headers: { "WWW-Authenticate": challenge } },
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
