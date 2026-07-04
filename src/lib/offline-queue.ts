/**
 * Offline WRITE queue (P3, scoped to time-entry clock actions).
 *
 * The db helpers lose a write when there's no signal: `db.post` returns null,
 * `db.patch`/`db.del` swallow the error. So an offline clock-out never closed
 * the time_entries row and the tech kept showing "on the clock". This queue
 * makes those writes durable: every clock write is enqueued to localStorage,
 * applied optimistically to the store, and REPLAYED when connectivity returns.
 *
 * The key trick: every new row gets a CLIENT-generated stable UUID (newRowId),
 * so a queued insert and a later update/delete both reference the same id —
 * no temp-id → real-id remapping, and replay is idempotent (post = upsert by
 * id, patch = update by id, del = delete by id). Replaying twice is safe.
 */
"use client";
import { supabase } from "./supabase";

export interface QueuedWrite {
  qid: string; // queue-item id
  table: string; // only "time_entries" today
  op: "post" | "patch" | "del";
  rowId: string; // stable client id of the affected row
  payload?: Record<string, unknown>; // full row (post) or updates (patch)
  ts: number;
}

const KEY = "c_offline_queue";
let flushing = false;

/** RFC4122 v4 id, from crypto when available (falls back to Math.random). */
export function newRowId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function read(): QueuedWrite[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedWrite[]) : [];
  } catch {
    return [];
  }
}

function write(q: QueuedWrite[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* quota — best-effort */
  }
}

export function enqueueWrite(item: {
  table: string;
  op: "post" | "patch" | "del";
  rowId: string;
  payload?: Record<string, unknown>;
}): void {
  const q = read();
  q.push({ qid: newRowId(), ts: Date.now(), ...item });
  write(q);
}

export function getPending(table?: string): QueuedWrite[] {
  const q = read();
  return table ? q.filter((i) => i.table === table) : q;
}

export function pendingCount(table?: string): number {
  return getPending(table).length;
}

/**
 * Materialize pending writes for a table on top of a base array (server truth
 * or the offline snapshot), so the UI reflects unsynced local intent until the
 * server confirms it. Idempotent and order-preserving.
 */
export function applyPending<T extends { id: string }>(table: string, base: T[]): T[] {
  const q = getPending(table);
  if (!q.length) return base;
  const map = new Map<string, T>(base.map((r) => [r.id, r]));
  for (const item of q) {
    if (item.op === "del") {
      map.delete(item.rowId);
    } else {
      const existing = map.get(item.rowId) || ({ id: item.rowId } as T);
      map.set(item.rowId, { ...existing, ...(item.payload || {}), id: item.rowId } as T);
    }
  }
  return Array.from(map.values());
}

/** A transport failure (offline / aborted) — keep the item and retry later. */
function isNetworkish(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (err instanceof TypeError) return true; // fetch transport failure
  if (err && typeof err === "object") {
    const e = err as { name?: string; message?: string; code?: string };
    if (e.name === "AbortError") return true;
    // A PostgrestError has a `code` — that's a real server rejection, NOT a
    // transport blip, so don't treat it as retryable.
    if (!e.code && e.message && /failed to fetch|networkerror|load failed|network request failed/i.test(e.message)) {
      return true;
    }
  }
  return false;
}

/**
 * Replay queued writes in order against Supabase. Stops at the first network
 * failure (still offline — keep the rest for next time). A NON-network error
 * (constraint / RLS) can't succeed on retry, so we drop that one item (logged)
 * rather than let it wedge the whole queue forever.
 */
export async function flushQueue(): Promise<{ flushed: number; remaining: number }> {
  if (flushing) return { flushed: 0, remaining: pendingCount() };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { flushed: 0, remaining: pendingCount() };
  }
  flushing = true;
  let flushed = 0;
  try {
    // Process the head repeatedly (re-reading each round so a concurrent
    // enqueue is picked up), stopping on a network failure.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const q = read();
      if (!q.length) break;
      const item = q[0];
      try {
        if (item.op === "post") {
          const { error } = await supabase
            .from(item.table)
            .upsert({ id: item.rowId, ...(item.payload || {}) } as never, { onConflict: "id" });
          if (error) throw error;
        } else if (item.op === "patch") {
          const { error } = await supabase
            .from(item.table)
            .update((item.payload || {}) as never)
            .eq("id", item.rowId);
          if (error) throw error;
        } else {
          const { error } = await supabase.from(item.table).delete().eq("id", item.rowId);
          if (error) throw error;
        }
      } catch (err) {
        if (isNetworkish(err)) break; // still offline — retry the whole queue later
        // eslint-disable-next-line no-console
        console.error("[offline-queue] dropping un-replayable write:", item, err);
      }
      // Remove this item (synced OR dropped-poison) and continue.
      write(read().filter((i) => i.qid !== item.qid));
      flushed += 1;
    }
  } finally {
    flushing = false;
  }
  return { flushed, remaining: pendingCount() };
}

/** Wipe the queue (called on logout so a new account starts clean). */
export function clearQueue(): void {
  write([]);
}
