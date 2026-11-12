import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import { isAudience } from "@/lib/campaigns";
import { loadRecipients } from "@/lib/campaigns-server";

export const dynamic = "force-dynamic";

/** POST /api/campaigns/count { audience } → how many customers it would go
 *  to right now (the same list /api/campaigns/send builds). Owner/manager. */
export async function POST(req: NextRequest) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  const b = (await req.json().catch(() => ({}))) as { audience?: unknown };
  if (!isAudience(b.audience)) return NextResponse.json({ error: "Pick who it goes to." }, { status: 400 });
  try {
    const list = await loadRecipients(serviceClient(), auth.orgId!, b.audience);
    return NextResponse.json({ count: list.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Count failed" }, { status: 500 });
  }
}
