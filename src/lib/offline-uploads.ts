/**
 * Offline UPLOAD queue (P3, remaining piece) — binary photo/receipt uploads
 * that survive no-signal and replay on reconnect.
 *
 * Row writes go through offline-queue (localStorage); images can't — they're
 * megabytes of binary, so the pending File is stashed in IndexedDB and the
 * upload (+ its follow-up write) is replayed when connectivity returns. Two
 * kinds today, both from WorkVision (the on-site screen):
 *   - "job-photo": upload to the public `receipts` bucket, append to the job's
 *                  rooms.photos.
 *   - "receipt":   uploadReceiptPrivate (signed-URL flow — needs the network,
 *                  so it can only run on replay), then insert the receipt row.
 *
 * Idempotency: a job-photo carries a PRE-COMPUTED storage path (upsert-uploaded,
 * deduped by URL before append) and a receipt carries a STABLE row id (upserted)
 * — so a replay that half-finished and retries can't create duplicates.
 */
"use client";
import { supabase, db } from "./supabase";
import { uploadReceiptPrivate } from "./receipt-storage";

const DB_NAME = "creed-uploads";
const STORE = "uploads";
const MAX_QUEUE = 80; // soft cap so a long offline stretch can't fill storage
let flushing = false;

export interface QueuedUpload {
  id: string;
  kind: "job-photo" | "receipt";
  blob: Blob; // the image File (structured-clone stores it fine)
  meta: Record<string, unknown>;
  ts: number;
}

function rid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return "u-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readAll(): Promise<QueuedUpload[]> {
  if (!idbAvailable()) return Promise.resolve([]);
  return openDb()
    .then(
      (dbi) =>
        new Promise<QueuedUpload[]>((resolve) => {
          try {
            const tx = dbi.transaction(STORE, "readonly");
            const req = tx.objectStore(STORE).getAll();
            req.onsuccess = () => {
              const rows = (req.result as QueuedUpload[]) || [];
              rows.sort((a, b) => a.ts - b.ts); // FIFO
              resolve(rows);
            };
            req.onerror = () => resolve([]);
            tx.oncomplete = () => dbi.close();
          } catch {
            resolve([]);
          }
        }),
    )
    .catch(() => []);
}

function putRow(row: QueuedUpload): Promise<void> {
  if (!idbAvailable()) return Promise.resolve();
  return openDb()
    .then(
      (dbi) =>
        new Promise<void>((resolve) => {
          try {
            const tx = dbi.transaction(STORE, "readwrite");
            tx.objectStore(STORE).put(row);
            tx.oncomplete = () => {
              dbi.close();
              resolve();
            };
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
          } catch {
            resolve();
          }
        }),
    )
    .catch(() => {});
}

function deleteRow(id: string): Promise<void> {
  if (!idbAvailable()) return Promise.resolve();
  return openDb()
    .then(
      (dbi) =>
        new Promise<void>((resolve) => {
          try {
            const tx = dbi.transaction(STORE, "readwrite");
            tx.objectStore(STORE).delete(id);
            tx.oncomplete = () => {
              dbi.close();
              resolve();
            };
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
          } catch {
            resolve();
          }
        }),
    )
    .catch(() => {});
}

export async function pendingUploadCount(): Promise<number> {
  return (await readAll()).length;
}

export async function clearUploads(): Promise<void> {
  const rows = await readAll();
  await Promise.all(rows.map((r) => deleteRow(r.id)));
}

/** A transport failure (offline / aborted) — keep the item and retry later. */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (err instanceof TypeError) return true; // fetch transport failure
  if (err && typeof err === "object") {
    const e = err as { name?: string; message?: string; code?: string };
    if (e.name === "AbortError") return true;
    if (!e.code && e.message && /failed to fetch|networkerror|load failed|network request failed/i.test(e.message)) {
      return true;
    }
  }
  return false;
}

/**
 * Queue an offline upload. Returns false if the queue is full (caller should
 * surface a "storage full" note) or IndexedDB is unavailable — otherwise true.
 */
export async function enqueueUpload(
  kind: QueuedUpload["kind"],
  blob: Blob,
  meta: Record<string, unknown>,
): Promise<boolean> {
  if (!idbAvailable()) return false;
  const rows = await readAll();
  if (rows.length >= MAX_QUEUE) return false;
  await putRow({ id: rid(), kind, blob, meta, ts: Date.now() });
  return true;
}

async function replayJobPhoto(item: QueuedUpload): Promise<void> {
  const jobId = String(item.meta.jobId || "");
  const path = String(item.meta.path || "");
  const tag = String(item.meta.tag || "work");
  if (!jobId || !path) return; // malformed — drop
  // Upsert so a retried replay overwrites the same object instead of orphaning.
  const { error } = await supabase.storage.from("receipts").upload(path, item.blob, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("receipts").getPublicUrl(path);
  const publicUrl = data?.publicUrl;
  if (!publicUrl) throw new Error("no public url");
  // Append to the job's rooms.photos, deduped by url (idempotent on retry).
  const jobs = await db.get<{ id: string; rooms: unknown }>("jobs", { id: jobId });
  const job = jobs[0];
  if (!job) return; // job deleted — drop
  let roomsData: Record<string, unknown> = {};
  try {
    roomsData = (typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms) || {};
  } catch {
    roomsData = {};
  }
  if (!Array.isArray(roomsData.photos)) roomsData.photos = [];
  const photos = roomsData.photos as { url?: string; label?: string; type?: string }[];
  if (!photos.some((p) => p.url === publicUrl)) {
    photos.push({ url: publicUrl, label: "", type: tag });
    await db.patch("jobs", jobId, { rooms: JSON.stringify(roomsData) });
  }
}

async function replayReceipt(item: QueuedUpload): Promise<void> {
  const jobId = String(item.meta.jobId || "");
  const orgId = item.meta.orgId ? String(item.meta.orgId) : undefined;
  const receiptId = String(item.meta.receiptId || "");
  if (!jobId || !receiptId) return; // malformed — drop
  const file = new File([item.blob], String(item.meta.name || "receipt.jpg"), {
    type: String(item.meta.type || "image/jpeg"),
  });
  const up = await uploadReceiptPrivate(file, jobId); // throws on network — kept for retry
  // Upsert by the stable id so a retried replay can't create a duplicate row.
  const { error } = await supabase
    .from("receipts")
    .upsert(
      {
        id: receiptId,
        job_id: jobId,
        ...(orgId ? { org_id: orgId } : {}),
        note: "Receipt",
        amount: 0,
        receipt_date: String(item.meta.receiptDate || new Date().toLocaleDateString()),
        photo_url: up.path,
      } as never,
      { onConflict: "id" },
    );
  if (error) throw error;
  // NOTE: the AI scan (scanReceiptAndLearn) is intentionally NOT re-run on
  // replay — the receipt image + row are saved (the lossless part); auto-scan
  // is a bonus that only fires on the live online path.
}

/**
 * Replay queued uploads in FIFO order. Stops at the first network failure
 * (still offline — keep the rest). A non-network error (a genuinely broken
 * item) is dropped so it can't wedge the queue.
 */
export async function flushUploads(): Promise<{ flushed: number; remaining: number }> {
  if (flushing) return { flushed: 0, remaining: await pendingUploadCount() };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { flushed: 0, remaining: await pendingUploadCount() };
  }
  flushing = true;
  let flushed = 0;
  try {
    const rows = await readAll();
    for (const item of rows) {
      try {
        if (item.kind === "job-photo") await replayJobPhoto(item);
        else if (item.kind === "receipt") await replayReceipt(item);
      } catch (err) {
        if (isNetworkError(err)) break; // still offline — retry the whole queue later
        // eslint-disable-next-line no-console
        console.error("[offline-uploads] dropping un-replayable upload:", item.kind, err);
      }
      await deleteRow(item.id); // synced OR dropped-poison
      flushed += 1;
    }
  } finally {
    flushing = false;
  }
  return { flushed, remaining: await pendingUploadCount() };
}
