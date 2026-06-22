import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/promo/apply
 *
 * An owner/manager applies a comp code to their OWN org. Two things moved
 * server-side here to close the paywall bypass:
 *   1. The valid-code list lives in the PROMO_CODES env var (comma-separated),
 *      so it is no longer shipped in the client JS bundle.
 *   2. The `billing_enforced = false` write happens via the service role for
 *      the caller's session org — the client can no longer flip its own
 *      entitlement directly (that path is the bypass).
 *
 * Body: { code: string }
 */
export async function POST(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;

  try {
    const { code } = (await req.json().catch(() => ({}))) as { code?: string };
    const norm = (code || "").trim().toUpperCase();
    if (!norm) {
      return NextResponse.json({ ok: false, error: "Enter a promo code" }, { status: 400 });
    }

    const valid = (process.env.PROMO_CODES || "")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    if (!valid.includes(norm)) {
      return NextResponse.json({ ok: false, error: "Invalid promo code" }, { status: 400 });
    }

    const { error } = await serviceClient()
      .from("organizations")
      .update({ billing_enforced: false })
      .eq("id", prof.orgId!);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
