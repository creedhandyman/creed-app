import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/api-auth";
import { authUrl, googleConfigured } from "@/lib/gcal/google";
import { makeState, newNonce } from "@/lib/gcal/crypto";

export const dynamic = "force-dynamic";

/**
 * Ops → Settings → Google Calendar → Connect (owners / managers). Returns the
 * Google sign-in URL. The signed `state` names the business + person; a
 * matching nonce in an httpOnly cookie ties the callback to THIS browser, so
 * a stranger's link can't attach their Google account to this business.
 */
export async function POST(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;
  if (!googleConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const nonce = newNonce();
  const res = NextResponse.json({ url: authUrl(makeState(prof.orgId as string, prof.userId, nonce)) });
  res.cookies.set("gcal_nonce", nonce, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/gcal", maxAge: 900 });
  return res;
}
