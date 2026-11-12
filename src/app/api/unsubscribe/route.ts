import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

export const dynamic = "force-dynamic";

/**
 * POST /api/unsubscribe?t=<token>   (or JSON { token })
 *
 * Public. Used two ways: the "Unsubscribe" button on /u/[token], and the
 * one-click List-Unsubscribe-Post that Gmail / Apple Mail send (RFC 8058).
 * The token is signed per customer (lib/unsubscribe-token.ts), so nobody can
 * unsubscribe someone else. Marks the customer "don't email"; never undone
 * from here. Idempotent.
 */
export async function POST(req: NextRequest) {
  let token = req.nextUrl.searchParams.get("t");
  if (!token) {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const b = (await req.json().catch(() => ({}))) as { token?: unknown };
      token = typeof b.token === "string" ? b.token : null;
    }
  }
  const customerId = verifyUnsubscribeToken(token);
  if (!customerId) return NextResponse.json({ error: "This unsubscribe link isn't valid." }, { status: 400 });
  const sb = serviceClient();
  const { error } = await sb
    .from("customers")
    .update({ email_unsubscribed_at: new Date().toISOString() })
    .eq("id", customerId)
    .is("email_unsubscribed_at", null);
  if (error) return NextResponse.json({ error: "Couldn't unsubscribe just now." }, { status: 500 });
  // Anything still queued for them is dropped too.
  await sb.from("campaign_sends").update({ status: "skipped", error: "Unsubscribed" })
    .eq("customer_id", customerId).eq("status", "queued");
  return NextResponse.json({ ok: true });
}
