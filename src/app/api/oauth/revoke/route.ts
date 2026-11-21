import type { NextRequest } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { oauthJson, preflight, readForm } from "@/lib/oauth/http";
import { revokeToken } from "@/lib/oauth/server";

export const dynamic = "force-dynamic";

/** RFC 7009 token revocation (a refresh token ends the whole connection). */
export async function POST(req: NextRequest) {
  const ok = await revokeToken(serviceClient(), await readForm(req), req.headers.get("authorization"));
  return ok ? oauthJson({}) : oauthJson({ error: "invalid_client" }, 401);
}
export const OPTIONS = preflight;
