// Client-side helpers for the PRIVATE receipts bucket (H7 phase B).
//
// Receipts capture the contractor's material costs, so they live in a private
// Supabase Storage bucket and are never world-readable. Uploads go straight
// from the browser to storage via a one-time signed upload URL minted by
// /api/storage/upload-url (no bytes through the serverless function, so no
// Vercel body-size limit). Reads are short-lived signed URLs from
// /api/storage/sign. The object PATH (not a URL) is what we persist in
// receipts.photo_url; legacy rows hold a public https URL — isPrivatePath
// tells them apart so both still render.
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";

export const RECEIPTS_BUCKET = "receipts-private";

/** True when a stored receipts.photo_url is a private-bucket object path (new)
 *  rather than a legacy public https URL (old). */
export function isPrivatePath(v?: string | null): v is string {
  return !!v && !/^https?:\/\//i.test(v);
}

/**
 * Upload a receipt image to the private bucket. Returns the object PATH
 * (persist this in receipts.photo_url) plus a short-lived signed URL for an
 * immediate AI scan / preview.
 */
export async function uploadReceiptPrivate(
  file: File,
  jobId: string,
): Promise<{ path: string; url: string }> {
  const ext =
    (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";

  // 1) server mints a one-time signed upload URL, scoped to the caller's org.
  const res = await apiFetch("/api/storage/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, ext }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.error || "Could not start receipt upload");
  }
  const { path, token } = (await res.json()) as { path: string; token: string };

  // 2) upload the bytes straight to storage with that one-time URL.
  const { error } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .uploadToSignedUrl(path, token, file, { contentType: file.type || "image/jpeg" });
  if (error) throw error;

  // 3) get a short-lived read URL for the immediate scan + preview.
  const urls = await signReceiptPaths([path]);
  return { path, url: urls[path] || "" };
}

/**
 * Batch-mint short-lived signed READ URLs for private-bucket paths. Legacy
 * https URLs are filtered out (they're already directly viewable). Returns a
 * { path: signedUrl } map.
 */
export async function signReceiptPaths(paths: string[]): Promise<Record<string, string>> {
  const list = Array.from(new Set(paths.filter(isPrivatePath)));
  if (!list.length) return {};
  const res = await apiFetch("/api/storage/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths: list }),
  });
  if (!res.ok) return {};
  const { urls } = (await res.json()) as { urls?: Record<string, string> };
  return urls || {};
}
