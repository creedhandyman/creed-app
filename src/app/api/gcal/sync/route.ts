import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/api-auth";
import { syncOrgById } from "@/lib/gcal/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Settings → Google Calendar → Sync now. Waits for the pass and reports it. */
export async function POST(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;
  return NextResponse.json(await syncOrgById(prof.orgId as string));
}
