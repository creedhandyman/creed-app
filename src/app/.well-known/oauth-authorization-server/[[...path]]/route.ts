import type { NextRequest } from "next/server";
import { oauthJson, preflight } from "@/lib/oauth/http";
import { authServerMetadata, trustedOrigin } from "@/lib/oauth/core";
import { siteOrigin } from "@/lib/site-url";

/** RFC 8414 authorization server metadata ("Sign in with Creed"). */
export async function GET(req: NextRequest) {
  return oauthJson(authServerMetadata(trustedOrigin(req.headers.get("host"), siteOrigin())), 200, { "Cache-Control": "public, max-age=300" });
}
export const OPTIONS = preflight;
