import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/api-auth";
import { disconnectOrg } from "@/lib/gcal/server";

export const dynamic = "force-dynamic";

/** Settings → Google Calendar → Disconnect. The "Creed jobs" calendar stays in Google; Creed stops updating it. */
export async function POST(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;
  await disconnectOrg(prof.orgId as string);
  return NextResponse.json({ ok: true });
}
