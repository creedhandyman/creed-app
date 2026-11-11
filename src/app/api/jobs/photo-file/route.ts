import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import { jobPhotoPath } from "@/lib/photo-file";

export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/photo-file — delete the stored file behind a photo that was
 * just removed from a job (the X on a job photo; owner/manager).
 *
 * Body: { jobId, url }. The Jobs screen calls this AFTER the photo is off the
 * job's blob. The file is deleted only when it is a job-photo file
 * (lib/photo-file.ts) and no job anywhere still mentions it, so a photo that
 * also sits on another job, a lead, or a render's "before" side is kept. Any
 * doubt (a failed lookup, a file still in use) = keep the file and say so.
 * Best-effort for the caller: the photo is already gone from the job.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;

  const body = (await req.json().catch(() => ({}))) as { jobId?: string; url?: string };
  if (!body.jobId || !UUID.test(body.jobId)) return NextResponse.json({ error: "Missing job" }, { status: 400 });

  const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host;
  const path = jobPhotoPath(body.url, host);
  if (!path) return NextResponse.json({ ok: true, deleted: false, reason: "not_a_job_photo" });

  const supabase = serviceClient();
  const { data: job } = await supabase.from("jobs").select("id, org_id").eq("id", body.jobId).maybeSingle();
  if (!job || job.org_id !== prof.orgId) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // Still mentioned by ANY job (this one included: the removal may not have
  // landed, or the photo is a render's source)? Then it stays. `_` in the
  // path is a LIKE wildcard, which can only match more rows = keep the file.
  const { data: refs, error: refErr } = await supabase
    .from("jobs").select("id").like("rooms", `%${path}%`).limit(1);
  if (refErr) return NextResponse.json({ ok: true, deleted: false, reason: "lookup_failed" });
  if (refs && refs.length) return NextResponse.json({ ok: true, deleted: false, reason: "in_use" });

  const { error: delErr } = await supabase.storage.from("receipts").remove([path]);
  if (delErr) {
    console.error("[jobs/photo-file]", delErr.message);
    return NextResponse.json({ ok: true, deleted: false, reason: "delete_failed" });
  }
  return NextResponse.json({ ok: true, deleted: true });
}
