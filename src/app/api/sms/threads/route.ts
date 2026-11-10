import { NextRequest, NextResponse } from "next/server";
import { getAuthedProfile, serviceClient } from "@/lib/api-auth";
import { describe, viewerOf, visibleThreads } from "@/lib/sms-threads-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/sms/threads: the Texts screen list. One row per phone number the
 * business has texted with, newest first, with name, job address, preview,
 * unread count and STOP state. Owners and managers see every conversation;
 * crew only those on jobs they're on (lib/sms-threads canSeeThread).
 *
 * GET /api/sms/threads?count=1: just { unread } for the More tab badge.
 *
 * Before the text replies migration (20261110_text_replies.sql) the columns
 * don't exist: answers { threads: [], unread: 0, ready: false }.
 */
export async function GET(req: NextRequest) {
  const prof = await getAuthedProfile(req);
  if (!prof) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!prof.orgId) return NextResponse.json({ threads: [], unread: 0 });
  const supabase = serviceClient();
  const viewer = await viewerOf(supabase, { ...prof, orgId: prof.orgId });

  let threads;
  try {
    threads = await visibleThreads(supabase, viewer);
  } catch {
    return NextResponse.json({ threads: [], unread: 0, ready: false });
  }
  const unread = threads.reduce((n, t) => n + t.unread, 0);
  if (req.nextUrl.searchParams.get("count")) return NextResponse.json({ unread });

  const info = await describe(supabase, viewer.orgId, threads);
  return NextResponse.json({
    unread,
    admin: viewer.admin,
    threads: threads.map((t) => ({
      phone: t.phone,
      lastAt: t.lastAt,
      lastDirection: t.lastDirection,
      preview: t.preview,
      unread: t.unread,
      jobId: t.jobId,
      match: t.match,
      ...info[t.phone],
    })),
  });
}
