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

// Magic-byte image sniff. Returns the verified mime + ext, or null if the
// bytes aren't an allowed raster image. This bucket is public and served by
// URL, so trusting the client content-type would let an SVG/HTML upload become
// a stored-XSS vector (audit M6).
function sniffImage(b: Uint8Array): { mime: string; ext: string } | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (["heic", "heix", "hevc", "heim", "heis", "hevm", "hevs", "mif1", "msf1", "heif"].includes(brand)) {
      return { mime: "image/heic", ext: "heic" };
    }
  }
  return null;
}

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

    // Verify it's a real image by its magic bytes, not the client's
    // content-type/filename, before storing it in the public bucket.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffImage(bytes);
    if (!kind) {
      return NextResponse.json({ error: "Only JPEG, PNG, WebP, or HEIC images are allowed" }, { status: 415 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const path = `portal-leads/${session.org_id}/${session.customer_id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${kind.ext}`;

    const { error: upErr } = await supabase.storage
      .from("receipts")
      .upload(path, bytes, { contentType: kind.mime });
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
