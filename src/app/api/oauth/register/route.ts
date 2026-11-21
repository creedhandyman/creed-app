import type { NextRequest } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { oauthJson, preflight } from "@/lib/oauth/http";
import { registerClient } from "@/lib/oauth/server";
import { addressTag, clientIp, memoryLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** RFC 7591 dynamic client registration (open, as the MCP spec expects).
 *  Registering grants nothing: an owner still has to sign in and approve. */
export async function POST(req: NextRequest) {
  const tag = addressTag(clientIp(req)) || "unknown";
  if (!memoryLimit(`oauth-reg:${tag}`, 10, 3_600_000)) {
    return oauthJson({ error: "slow_down", error_description: "too many registrations" }, 429);
  }
  let body: unknown = null;
  try { body = await req.json(); } catch { /* */ }
  const r = await registerClient(serviceClient(), body);
  return r.ok ? oauthJson(r.data, 201) : oauthJson(r.err, r.err.error === "server_error" ? 500 : 400);
}
export const OPTIONS = preflight;
