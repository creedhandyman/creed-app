import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifySession, PORTAL_COOKIE_NAME } from "@/lib/portal-session";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/upload-photo
 *
 * Accepts a single image file (multipart/form-data, key = "file") from
 * a logged-in portal customer and uploads it to the existing "receipts"
 * Storage bucket — same bucket the contractor's app uses for job /
 * receipt photos. Returns the public URL so the work-order form can
 * include it in the eventual /api/portal/submit-work-order call.
 *
 * Stored under `portal-leads/<org_id>/<customer_id>/<random>.<ext>`.
 * That path scopes uploads under predictable prefixes so Bernard can
 * audit / clean up later without crawling the whole bucket.
 *
 * Hard limits: 8 MB per upload (cheap defense against someone stuffing
 * the bucket). Larger images get rejected with 413; the client should
 * resize before sending (the form does, with a 1200px max edge).
 */

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(PORTAL_COOKIE_NAME)?.value;
  const session = verifySession(cookie);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 8 MB)" }, { status: 413 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `portal-leads/${session.org_id}/${session.customer_id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("receipts")
      .upload(path, file, { contentType: file.type || "image/jpeg" });
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
    const { data } = supabase.storage.from("receipts").getPublicUrl(path);
    return NextResponse.json({ ok: true, url: data?.publicUrl || "" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("portal/upload-photo error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
