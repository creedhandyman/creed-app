import { NextRequest, NextResponse } from "next/server";
import { requireAuth, serviceClient } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/account/delete — "Delete account" from personal Settings.
 *
 * The old in-app version deleted only the `profiles` row: the login survived,
 * so the next sign-in hit a half-deleted account, and an OWNER doing it
 * orphaned the whole business and crew. Now:
 *   - owners are refused (closing a business / handing it over is a support
 *     conversation, not one tap);
 *   - everyone else: the profile AND the auth user are deleted. Their past
 *     time entries / pay history stay (they're the business's payroll records).
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const supabase = serviceClient();
  const { data: prof } = await supabase
    .from("profiles").select("id, role").eq("id", auth.userId).maybeSingle();
  if (prof?.role === "owner") {
    return NextResponse.json(
      { error: "Owners can't delete their account while the business is open — contact support to close it or hand it over." },
      { status: 409 },
    );
  }

  if (prof) {
    const { error } = await supabase.from("profiles").delete().eq("id", auth.userId);
    if (error) {
      console.error("[account/delete] profile", error);
      return NextResponse.json({ error: "Couldn't delete your account — please try again." }, { status: 500 });
    }
  }
  const { error: authErr } = await supabase.auth.admin.deleteUser(auth.userId);
  if (authErr) {
    console.error("[account/delete] auth user", authErr);
    return NextResponse.json({ error: "Couldn't finish deleting your login — please contact support." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
