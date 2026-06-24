"use client";

/**
 * Client-side image helpers for the native-picker flows (receipts, etc.).
 *
 * The in-app CameraModal (getUserMedia) is great for inspection photos — it
 * does multi-shot, torch, and aggressive downscaling. But two things make it a
 * poor fit for RECEIPTS: (1) on iOS Safari getUserMedia frequently can't open a
 * live stream and silently falls back to the library picker, and (2) the stream
 * it does get is low-resolution, then gets squeezed to 1600px/0.8 — too soft for
 * the AI scan to read small line items. For receipts we instead go straight to
 * the device's NATIVE camera/photo picker (rock-solid on every phone) and keep
 * the image at HD quality.
 */

/**
 * Downscale + re-encode an image File to a bounded JPEG. Returns the original
 * file unchanged if it isn't a decodable image. Defaults are tuned for receipts
 * (HD: 2400px longest edge, q0.9) — readable text without absurd file sizes.
 */
export function compressImage(file: File, maxSize = 2400, quality = 0.9): Promise<File> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) {
      resolve(file);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width;
      let h = img.height;
      if (w > maxSize || h > maxSize) {
        if (w > h) {
          h = Math.round((h * maxSize) / w);
          w = maxSize;
        } else {
          w = Math.round((w * maxSize) / h);
          h = maxSize;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const base = file.name.replace(/\.[^.]+$/, "") || "photo";
      canvas.toBlob(
        (b) => resolve(b ? new File([b], `${base}.jpg`, { type: "image/jpeg" }) : file),
        "image/jpeg",
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

/**
 * Open the device's native file picker and resolve with the chosen File(s).
 * `camera: true` adds capture="environment" so phones jump straight to the rear
 * camera; omit it to get the OS sheet (Take Photo / Photo Library / Files).
 * The promise simply never settles if the user cancels (no reliable cross-
 * browser cancel event) — callers should treat that as "nothing happened".
 */
export function pickImage(opts: { camera?: boolean; multiple?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (opts.multiple) input.multiple = true;
    if (opts.camera) input.setAttribute("capture", "environment");
    input.onchange = () => resolve(Array.from(input.files || []));
    input.click();
  });
}

/**
 * Receipt-specialized capture: native picker → HD JPEG (2400px, q0.9). Returns
 * null if the user picked nothing. `camera` true opens the camera directly;
 * false shows the OS sheet so they can pick an existing photo too.
 */
export async function pickReceiptPhoto(camera: boolean): Promise<File | null> {
  const files = await pickImage({ camera });
  if (!files.length) return null;
  return compressImage(files[0], 2400, 0.9);
}
