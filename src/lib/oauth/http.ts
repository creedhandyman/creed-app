/** Response helpers for the OAuth endpoints: JSON, never cached, and open to
 *  browser-based MCP clients (no cookies are involved, so `*` is safe). */
import { NextResponse } from "next/server";

export const OAUTH_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export function oauthJson(body: unknown, status = 200, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...OAUTH_CORS, "Cache-Control": "no-store", Pragma: "no-cache", ...extra } });
}

export const preflight = () => new NextResponse(null, { status: 204, headers: OAUTH_CORS });

/** A token / revoke request body: form-encoded per the spec, JSON tolerated. */
export async function readForm(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") || "";
  try {
    if (type.includes("application/json")) {
      const j = (await req.json()) as Record<string, unknown>;
      return new URLSearchParams(Object.entries(j).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
    }
    return new URLSearchParams(await req.text());
  } catch {
    return new URLSearchParams();
  }
}
