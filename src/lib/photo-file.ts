/**
 * Which stored file (if any) may be deleted when a photo comes off a job.
 * PURE: the route (/api/jobs/photo-file) does the lookups and the delete.
 *
 * Job photos live in the PUBLIC `receipts` bucket under paths that carry no
 * business id, so the path alone can't prove whose file it is. The rules that
 * keep a delete safe:
 *  - only folders that hold job photos (never logos, avatars, the public
 *    card, equipment, or texted-in photos, which the Texts screen still shows);
 *  - the route deletes only when NO job anywhere still mentions the file
 *    (a photo copied to a second job, used as a render's source, or sitting
 *    on a lead stays put).
 */
const PUBLIC_PREFIX = "/storage/v1/object/public/receipts/";

/** Folders whose files are job photos and nothing else. */
const JOB_PHOTO_FOLDERS = ["gallery/", "quickquote/", "leads/", "portal-leads/", "inspections/", "ai-renders/"];

/** The object path inside the `receipts` bucket for a deletable job photo, or
 *  null when the url isn't one (wrong host / bucket / folder, or malformed). */
export function jobPhotoPath(url: unknown, storageHost: string): string | null {
  if (typeof url !== "string" || !url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" || u.host !== storageHost) return null;
  if (!u.pathname.startsWith(PUBLIC_PREFIX)) return null;
  let path: string;
  try { path = decodeURIComponent(u.pathname.slice(PUBLIC_PREFIX.length)); } catch { return null; }
  // Plain characters only, and nothing URL-encoded: the route looks the path
  // up as text inside job blobs, so it must read exactly as it was stored.
  if (path !== u.pathname.slice(PUBLIC_PREFIX.length)) return null;
  if (!/^[A-Za-z0-9_\-./]+$/.test(path) || path.includes("..") || path.includes("//")) return null;
  return JOB_PHOTO_FOLDERS.some((f) => path.startsWith(f)) ? path : null;
}
