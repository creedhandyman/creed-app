import { NextRequest, NextResponse } from "next/server";
import { getAuthedProfile, serviceClient } from "@/lib/api-auth";
import { signJobToken } from "@/lib/job-token";

export const dynamic = "force-dynamic";

/**
 * POST /api/status-link — mint a signed approval token for a job in the
 * caller's own org. The client appends it to the /status link it sends the
 * customer, so the customer can approve the quote and no one else can forge an
 * approval for a job whose id they happen to learn.
 *
 * Body: { jobId: string }   Returns: { token: string }
 */
export async function POST(req: NextRequest) {
  try {
    const prof = await getAuthedProfile(req);
    if (!prof || !prof.orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { jobId } = (await req.json().catch(() => ({}))) as { jobId?: string };
    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const { data: job } = await serviceClient()
      .from("jobs")
      .select("id, org_id")
      .eq("id", jobId)
      .maybeSingle();
    if (!job || job.org_id !== prof.orgId) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({ token: signJobToken(jobId) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
