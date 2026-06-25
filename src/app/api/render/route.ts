import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth, isSupabaseStorageUrl } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
// Image generation can take 20–50s end to end; give it room.
export const maxDuration = 60;

// Clamp client-supplied gpt-image-1 params so a caller can't force an
// expensive tier. Default quality is "low" (~$0.01); the client opts into a
// higher tier explicitly (RenderModal's High-quality toggle).
const ALLOWED_SIZE = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);
const ALLOWED_QUALITY = new Set(["low", "medium", "high", "auto"]);

/**
 * Generate a "finished work" rendering of a property photo.
 *
 * Pipeline:
 *  1. Fetch the source photo from its public Supabase URL.
 *  2. Send (image + prompt) to OpenAI gpt-image-1 edits endpoint.
 *  3. Decode the b64 result and upload to Supabase storage at
 *     gallery/<jobId>/renderings/<timestamp>.png.
 *  4. Return { url } so the client can append it to job.photos.
 *
 * The route is stateless w.r.t. the job — the client patches jobs.rooms
 * with the new photo entry. This matches the existing uploadWorkPhoto
 * pattern in WorkVision.
 *
 * Request: JSON { photoUrl, prompt, jobId, size?, quality? }
 *   - photoUrl: public URL of the source image
 *   - prompt:   text describing the desired finished state
 *   - jobId:    used to namespace the storage path
 *   - size:     "1024x1024" | "1024x1536" | "1536x1024" | "auto" (default 1024x1024)
 *   - quality:  "low" | "medium" | "high" | "auto" (clamped; default "low" — ~$0.01/image)
 *
 * Response: { url: string } | { error: string }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 503 }
    );
  }

  try {
    const { photoUrl, prompt, jobId, size, quality } = await req.json();
    if (!photoUrl || !prompt || !jobId) {
      return NextResponse.json(
        { error: "Missing photoUrl, prompt, or jobId" },
        { status: 400 }
      );
    }
    if (!isSupabaseStorageUrl(photoUrl)) {
      return NextResponse.json(
        { error: "photoUrl must be a Supabase Storage URL" },
        { status: 400 }
      );
    }

    // 1) Fetch source photo
    const imgRes = await fetch(photoUrl);
    if (!imgRes.ok) {
      return NextResponse.json(
        { error: `Could not fetch source photo: ${imgRes.status}` },
        { status: 400 }
      );
    }
    const sourceType = imgRes.headers.get("content-type") || "image/jpeg";
    const sourceBuf = Buffer.from(await imgRes.arrayBuffer());
    // gpt-image-1 caps inputs at 25MB; reject before burning a round trip.
    if (sourceBuf.byteLength > 25 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Source photo exceeds 25MB" },
        { status: 413 }
      );
    }

    // 2) Send to OpenAI gpt-image-1 (edits endpoint, no mask = full reimagining
    // conditioned on the source). Returns base64 PNG by default.
    const fwd = new FormData();
    fwd.append(
      "image",
      new Blob([sourceBuf], { type: sourceType }),
      "source.jpg"
    );
    fwd.append("model", "gpt-image-1");
    fwd.append("prompt", prompt);
    fwd.append("size", typeof size === "string" && ALLOWED_SIZE.has(size) ? size : "1024x1024");
    fwd.append("quality", typeof quality === "string" && ALLOWED_QUALITY.has(quality) ? quality : "low");
    fwd.append("n", "1");

    const aiRes = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fwd,
    });
    const aiText = await aiRes.text();
    if (!aiRes.ok) {
      console.error("gpt-image-1 error:", aiRes.status, aiText);
      return NextResponse.json(
        { error: `Image API ${aiRes.status}: ${aiText.slice(0, 300)}` },
        { status: aiRes.status >= 500 ? 502 : aiRes.status }
      );
    }
    let parsed: { data?: Array<{ b64_json?: string; url?: string }> };
    try {
      parsed = JSON.parse(aiText);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON from image API" },
        { status: 502 }
      );
    }
    const b64 = parsed.data?.[0]?.b64_json;
    if (!b64) {
      return NextResponse.json(
        { error: "Image API returned no image data" },
        { status: 502 }
      );
    }
    const renderedBuf = Buffer.from(b64, "base64");

    // 3) Upload to Supabase storage. The anon key has upload privileges in
    // this app (same key the client uses for receipt uploads).
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supaUrl || !anonKey) {
      return NextResponse.json(
        { error: "Supabase env not configured" },
        { status: 500 }
      );
    }
    const supa = createClient(supaUrl, anonKey);
    const stamp = Date.now();
    const path = `gallery/${jobId}/renderings/${stamp}.png`;
    const { error: upErr } = await supa.storage
      .from("receipts")
      .upload(path, renderedBuf, { contentType: "image/png" });
    if (upErr) {
      return NextResponse.json(
        { error: `Storage upload failed: ${upErr.message}` },
        { status: 502 }
      );
    }
    const { data: pub } = supa.storage.from("receipts").getPublicUrl(path);
    const publicUrl = pub?.publicUrl;
    if (!publicUrl) {
      return NextResponse.json(
        { error: "Could not resolve public URL" },
        { status: 502 }
      );
    }

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("render error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
