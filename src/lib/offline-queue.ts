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
 * no temp-id → real-id remapping, and replay is idempotent (post = insert by
 * id, ignored if it already landed; patch = update by id; del = delete by id;
 * shift closes are conditional — see writeIfOpen). Replaying twice is safe.
 */
"use client";
import { supabase } from "./supabase";
import { isCloseWrite, resolveClose } from "./clock-sync";

export interface QueuedWrite {
  qid: string; // queue-item id
  table: string; // only "time_entries" today
  op: "post" | "patch" | "del";
  rowId: string; // stable client id of the affected row
  payload?: Record<string, unknown>; // full row (post) or updates (patch)
  /** Close-a-shift writes (clock-out, force-out, ghost-row delete): land only
   *  while the row is still OPEN, so a late replay can never overwrite a close
   *  done elsewhere (a manager's force clock-out, another phone). */
  onlyIfOpen?: boolean;
  /** The tech's OWN clock-out (Timer.stop / WorkVision.clockOut): if the row
   *  was closed elsewhere with MORE hours, this earlier real finish replaces it
   *  (unpaid rows only). Office closes never get this — they can't shrink a
   *  real clock-out. */
  earlierWins?: boolean;
  ts: number;
}

/** Per-request timeout so one hanging dead-zone request can't stall the queue
 *  (and every clock action waiting behind it) for a minute or more. An abort
 *  is retryable (isNetworkish), and every replay is safe to repeat. */
function tmo<B extends { abortSignal(s: AbortSignal): B }>(b: B): B {
  try {
    const AS = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
    if (typeof AS?.timeout === "function") return b.abortSignal(AS.timeout(15000));
  } catch { /* older browser — no timeout */ }
  return b;
}

/**
 * A close/remove write: try it only on an open row (end_time NULL — the same
 * open test payroll-runner uses). If nothing matched, re-read the row and let
 * clock-sync's resolveClose decide (our own retry → done; blank "" finish →
 * write; an earlier real clock-out beats a later force-out on an unpaid row;
 * otherwise keep the server's times = conflict).
 */
async function writeIfOpen(item: QueuedWrite): Promise<"ok" | "conflict"> {
  const op = item.op === "del" ? "del" : "patch";
  const payload = (item.payload || {}) as never;
  const { data, error } = op === "del"
    ? await tmo(supabase.from(item.table).delete().eq("id", item.rowId).is("end_time", null).select("id"))
    : await tmo(supabase.from(item.table).update(payload).eq("id", item.rowId).is("end_time", null).select("id"));
  if (error) throw error;
  if (data && data.length) return "ok";
  const { data: cur, error: readErr } = await tmo(supabase.from(item.table).select("id, end_time, hours, paid_at").eq("id", item.rowId));
  if (readErr) throw readErr;
  const row = ((cur as { end_time?: string | null; hours?: number | null; paid_at?: string | null }[] | null) || [])[0] || null;
  const verdict = resolveClose(op, item.payload, row);
  if (verdict === "done") return "ok";
  if (verdict === "conflict") return "conflict";
  if (verdict === "write") {
    // Blank "" finish = still open; never onto a row payroll already paid.
    const { data: d2, error: err2 } = op === "del"
      ? await tmo(supabase.from(item.table).delete().eq("id", item.rowId).is("paid_at", null).select("id"))
      : await tmo(supabase.from(item.table).update(payload).eq("id", item.rowId).is("paid_at", null).select("id"));
    if (err2) throw err2;
    return d2 && d2.length ? "ok" : "conflict";
  }
  // write-if-earlier: only the tech's own clock-out, still unpaid, and the
  // stored close is LONGER than ours.
  if (!item.earlierWins) return "conflict";
  const { data: d3, error: err3 } = await tmo(supabase
    .from(item.table)
    .update(payload)
    .eq("id", item.rowId)
    .is("paid_at", null)
    .gt("hours", Number(item.payload?.hours))
    .select("id"));
  if (err3) throw err3;
  return d3 && d3.length ? "ok" : "conflict";
}

const KEY = "c_offline_queue";

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
  onlyIfOpen?: boolean;
  earlierWins?: boolean;
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
    if (!e.code && e.message && /failed to fetch|networkerror|load failed|network request failed|aborterror|timeouterror|aborted|timed out/i.test(e.message)) {
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
export interface FlushResult {
  flushed: number;
  remaining: number;
  /** Row ids whose close/remove found the shift already closed (or removed)
   *  elsewhere — the server's times were kept. Per row, so a caller can tell
   *  whether ITS write landed. */
  conflictRows: string[];
}

let inflight: Promise<FlushResult> | null = null;
let followUp: Promise<FlushResult> | null = null;

/** A flush is running right now (the 15s poll skips its retry then). */
export function isFlushing(): boolean {
  return inflight !== null;
}

export async function flushQueue(): Promise<FlushResult> {
  // Already flushing: everyone arriving now shares ONE follow-up flush that
  // runs after it (it may be replaying OUR item; the follow-up catches
  // anything enqueued meanwhile). Both results are reported, so a conflict is
  // never swallowed as "0" — and waiters can't pile up into a long line.
  if (inflight) {
    if (!followUp) {
      const prevRun = inflight;
      followUp = prevRun.catch(() => null).then(async (prev) => {
        followUp = null;
        const again = await flushQueue();
        return {
          flushed: (prev?.flushed || 0) + again.flushed,
          remaining: again.remaining,
          conflictRows: [...(prev?.conflictRows || []), ...again.conflictRows],
        };
      });
    }
    return followUp;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { flushed: 0, remaining: pendingCount(), conflictRows: [] };
  }
  inflight = runFlush();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

async function runFlush(): Promise<FlushResult> {
  let flushed = 0;
  const conflictRows: string[] = [];
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
          // Insert-only: posts always carry a fresh client id, so a replay of
          // one that already landed (lost response) must NEVER update the row
          // — a merge would reset hours/amount to 0 on a shift since closed.
          const { error } = await tmo(supabase
            .from(item.table)
            .upsert({ id: item.rowId, ...(item.payload || {}) } as never, { onConflict: "id", ignoreDuplicates: true }));
          if (error) throw error;
        } else if (item.table === "time_entries" && isCloseWrite(item) && (item.onlyIfOpen || item.op === "patch")) {
          // onlyIfOpen closes, plus legacy end_time patches queued before it existed.
          if ((await writeIfOpen(item)) === "conflict") conflictRows.push(item.rowId);
        } else if (item.op === "patch") {
          const { error } = await tmo(supabase
            .from(item.table)
            .update((item.payload || {}) as never)
            .eq("id", item.rowId));
          if (error) throw error;
        } else {
          const { error } = await tmo(supabase.from(item.table).delete().eq("id", item.rowId));
          if (error) throw error;
        }
      } catch (err) {
        if (isNetworkish(err)) break; // still offline — retry the whole queue later
        // A response with no PostgREST / SQL code (a 502/504/520 gateway page)
        // is transient too — retry it for a day before giving up on it.
        const code = err && typeof err === "object" ? (err as { code?: string }).code : undefined;
        if (!code && Date.now() - item.ts < 24 * 3600000) break;
        // eslint-disable-next-line no-console
        console.error("[offline-queue] dropping un-replayable write:", item, err);
      }
      // Remove this item (synced OR dropped-poison) and continue.
      write(read().filter((i) => i.qid !== item.qid));
      flushed += 1;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[offline-queue] flush aborted:", err);
  }
  return { flushed, remaining: pendingCount(), conflictRows };
}

/** Wipe the queue (called on logout so a new account starts clean). */
export function clearQueue(): void {
  write([]);
}
