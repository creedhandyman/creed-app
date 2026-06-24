import { NextRequest, NextResponse } from "next/server";
import { getAuthedProfile, serviceClient } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// Private bucket for sensitive files (receipts). Created in Supabase as a
// NON-public bucket; all access is via service-role signed URLs.
const BUCKET = "receipts-private";

/**
 * POST /api/storage/upload-url  { jobId, ext }
 *
 * Mints a one-time signed UPLOAD url so the browser can put a receipt image
 * straight into the private bucket (no bytes through this function). The
 * object key is derived server-side and scoped to the caller's org prefix, so
 * a client can't write outside its own tenant. Returns { path, token }.
 */
export async function POST(req: NextRequest) {
  const prof = await getAuthedProfile(req);
  if (!prof) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!prof.orgId) return NextResponse.json({ error: "No organization on profile" }, { status: 403 });

  const { jobId, ext } = (await req.json().catch(() => ({}))) as { jobId?: string; ext?: string };
  if (!jobId || typeof jobId !== "string") {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const safeJob = jobId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  const safeExt = (ext || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `${prof.orgId}/${safeJob}/${Date.now()}_${rand}.${safeExt}`;

  const { data, error } = await serviceClient().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Could not create upload URL" }, { status: 500 });
  }
  return NextResponse.json({ path: data.path, token: data.token });
}
