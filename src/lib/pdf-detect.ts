/** A PDF starts "%PDF-" (readers allow a little junk before it). */
export function looksLikePdfBytes(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.slice(0, 1024));
  return head.includes("%PDF-");
}

/** PDF by type, name or content — not only a lowercase ".pdf" name. Phones hand
 *  over "Report.PDF", or a share-sheet file with no extension at all, and the
 *  old name check sent those down the plain-text path (garbage, no AI run). */
export async function isPdfFile(file: File): Promise<boolean> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return true;
  try {
    return looksLikePdfBytes(new Uint8Array(await file.slice(0, 1024).arrayBuffer()));
  } catch {
    return false;
  }
}

/** Reject instead of spinning forever when pdf.js can't open a file or its
 *  worker never starts. */
export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
