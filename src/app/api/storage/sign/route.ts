import { NextRequest, NextResponse } from "next/server";
import { getAuthedProfile, serviceClient } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const BUCKET = "receipts-private";
const TTL_SECONDS = 3600; // 1 hour — long enough for a viewing session

/**
 * POST /api/storage/sign  { paths: string[] }
 *
 * Returns short-lived signed READ urls for private-bucket object paths. Only
 * signs paths under the caller's own org prefix (`<orgId>/…`) and never
 * absolute URLs, so a client can't read another tenant's objects. Response:
 * { urls: { [path]: signedUrl } }.
 */
export async function POST(req: NextRequest) {
  const prof = await getAuthedProfile(req);
  if (!prof) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!prof.orgId) return NextResponse.json({ error: "No organization on profile" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { paths?: unknown };
  const paths = Array.isArray(body.paths) ? body.paths : [];
  const safe = paths
    .filter((p): p is string => typeof p === "string" && p.length > 0 && !/^https?:\/\//i.test(p))
    .filter((p) => p.startsWith(`${prof.orgId}/`))
    .slice(0, 200);
  if (!safe.length) return NextResponse.json({ urls: {} });

  const { data, error } = await serviceClient().storage.from(BUCKET).createSignedUrls(safe, TTL_SECONDS);
  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Could not sign URLs" }, { status: 500 });
  }
  const urls: Record<string, string> = {};
  for (const item of data) {
    if (item.path && item.signedUrl && !item.error) urls[item.path] = item.signedUrl;
  }
  return NextResponse.json({ urls });
}
