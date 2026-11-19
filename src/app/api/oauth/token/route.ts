import type { NextRequest } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { oauthJson, preflight, readForm } from "@/lib/oauth/http";
import { tokenRequest } from "@/lib/oauth/server";

export const dynamic = "force-dynamic";

/** OAuth 2.1 token endpoint: authorization_code (+ PKCE) and refresh_token. */
export async function POST(req: NextRequest) {
  const r = await tokenRequest(serviceClient(), await readForm(req), req.headers.get("authorization"));
  if (r.ok) return oauthJson(r.tokens);
  const { status, ...err } = r.err;
  return oauthJson(err, status, status === 401 ? { "WWW-Authenticate": 'Basic realm="creed"' } : {});
}
export const OPTIONS = preflight;
