/**
 * Browser helpers shared by the uploaders that send files to the AI
 * (MaterialSpecImport, PurchasePriceImport): base64 encoding and grouping
 * images into calls that stay under Vercel's 4.5 MB request body.
 */

/** Images per AI call, and their combined (decoded) size. */
export const IMAGES_PER_CALL = 4;
export const IMAGE_BATCH_BYTES = 2_400_000;

export interface Img { data: string; media_type: string; bytes: number }

/** A file / blob as bare base64 (no data: prefix). */
export const fileToBase64 = (f: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || "").replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

export const dataUriToImg = (uri: string): Img => {
  const m = uri.match(/^data:(image\/[a-z]+);base64,(.*)$/);
  const data = m ? m[2] : uri;
  return { data, media_type: m ? m[1] : "image/jpeg", bytes: Math.round(data.length * 0.75) };
};

/** A photo, shrunk for reading, as an Img. */
export async function photoToImg(file: File, maxSize = 2000, quality = 0.85): Promise<Img> {
  const { compressImage } = await import("./image");
  const small = await compressImage(file, maxSize, quality);
  const data = await fileToBase64(small);
  return { data, media_type: small.type && small.type.startsWith("image/") ? small.type : "image/jpeg", bytes: Math.round(data.length * 0.75) };
}

/** Group images into AI calls by count and size. */
export function imageCalls(imgs: Img[], perCall = IMAGES_PER_CALL, maxBytes = IMAGE_BATCH_BYTES): Img[][] {
  const out: Img[][] = [];
  let cur: Img[] = [];
  let bytes = 0;
  for (const im of imgs) {
    if (cur.length && (cur.length >= perCall || bytes + im.bytes > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(im);
    bytes += im.bytes;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** The body shape the extract routes take for images. */
export const imagesBody = (group: Img[]) => group.map(({ data, media_type }) => ({ data, media_type }));
