import type { NextRequest } from "next/server";
import { oauthJson, preflight } from "@/lib/oauth/http";
import { authServerMetadata, trustedOrigin } from "@/lib/oauth/core";
import { siteOrigin } from "@/lib/site-url";

/** Some MCP clients look here first; it's the same OAuth metadata (no OpenID
 *  sign-in / id tokens are offered). */
export async function GET(req: NextRequest) {
  return oauthJson(authServerMetadata(trustedOrigin(req.headers.get("host"), siteOrigin())), 200, { "Cache-Control": "public, max-age=300" });
}
export const OPTIONS = preflight;
