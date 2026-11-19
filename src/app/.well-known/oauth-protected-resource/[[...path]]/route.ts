import type { NextRequest } from "next/server";
import { oauthJson, preflight } from "@/lib/oauth/http";
import { protectedResourceMetadata, trustedOrigin } from "@/lib/oauth/core";
import { siteOrigin } from "@/lib/site-url";

/** RFC 9728 protected resource metadata for the MCP server, at both
 *  /.well-known/oauth-protected-resource and …/api/mcp. */
export async function GET(req: NextRequest) {
  return oauthJson(protectedResourceMetadata(trustedOrigin(req.headers.get("host"), siteOrigin())), 200, { "Cache-Control": "public, max-age=300" });
}
export const OPTIONS = preflight;
