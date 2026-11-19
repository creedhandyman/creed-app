/**
 * Offline-durable WORK-ORDER checkbox taps.
 *
 * A work-order tick lives inside the job's `rooms` JSON blob, so it can't use
 * the row queue (offline-queue.ts replays whole-row writes; a blob needs a
 * read-merge-write). Before this, an offline tap flipped the box on screen,
 * the patch failed, and the next sync silently un-ticked it.
 *
 * Each tap is stored as {jobId, key, done} (key = room|||detail, the same
 * stable key WorkVision / Jobs match tasks by), latest tap per task wins.
 * `applyWoPending` overlays pending ticks onto loaded jobs so a poll or the
 * offline snapshot can't revert them; `flushWoQueue` replays them against the
 * job's CURRENT server blob (read → set `done` by key → write), so other blob
 * changes made meanwhile (photos, notes, quote edits) are kept. A task that no
 * longer exists, or a job that's gone, just drops its taps.
 *
 * A synced tap is NOT forgotten at once (fix 2026-11-21, "checked boxes come
 * back unchecked"): the 15s poll's job read can be sent BEFORE the tap's write
 * lands and come back AFTER the flush emptied the queue — its stale copy then
 * replaced the store's and the box flipped back (and a quote save in that
 * window could write the stale `done` to the server). So a synced tap stays in
 * the queue with `syncedAt`, and `applyWoPending(jobs, readStartedAt)` keeps
 * overlaying it onto any read that STARTED before it synced. A read started
 * after it synced is trusted (another phone may have unticked it since).
 * Synced taps are pruned after SYNCED_KEEP_MS.
 */
"use client";
import { supabase } from "./supabase";
import { woKey } from "./job-blob";
import { jobSerial } from "./job-serial";

export interface WoToggle {
  qid: string;
  jobId: string;
  key: string; // `${room}|||${detail}`, lowercased + trimmed
  done: boolean;
  ts: number;
  /** First transient failure — retry for a day from here. */
  failSince?: number;
  /** When the server write was confirmed. Kept (not removed) so a read that
   *  was already in flight can't revert the box; see the file header. */
  syncedAt?: number;
}

/** How long a synced tap keeps guarding against stale reads. Far above any
 *  real request time; a poll started after the sync no longer uses it. */
export const SYNCED_KEEP_MS = 2 * 60_000;

const KEY = "c_wo_queue";

// The task key lives with the blob reader; re-exported for existing callers.
export { woKey };

function read(now = Date.now()): WoToggle[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const q = raw ? (JSON.parse(raw) as WoToggle[]) : [];
    return q.filter((i) => !i.syncedAt || now - i.syncedAt < SYNCED_KEEP_MS);
  } catch { return []; }
}
const unsynced = (q: WoToggle[]) => q.filter((i) => !i.syncedAt);
function write(q: WoToggle[]): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* quota — best-effort */ }
}
function qid(): string {
  try { if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID(); } catch { /* */ }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Record a tap (replaces any earlier unsynced tap on the same task). */
export function enqueueWoToggle(jobId: string, key: string, done: boolean): void {
  const q = read().filter((i) => !(i.jobId === jobId && i.key === key));
  q.push({ qid: qid(), jobId, key, done, ts: Date.now() });
  write(q);
}

/** Taps still waiting to reach the server (synced ones don't count). */
export function woPendingCount(): number {
  return unsynced(read()).length;
}

export function clearWoQueue(): void {
  write([]);
}

type WOItem = { room?: string; detail?: string; done?: boolean } & Record<string, unknown>;

/** Pure: set `done` on the matching tasks of a parsed rooms blob. */
export function applyTogglesToBlob(
  data: Record<string, unknown>,
  toggles: { key: string; done: boolean }[],
): { data: Record<string, unknown>; applied: number } {
  if (!Array.isArray(data.workOrder) || !toggles.length) return { data, applied: 0 };
  let applied = 0;
  const wo = (data.workOrder as WOItem[]).map((w) => {
    const t = toggles.find((x) => x.key === woKey(w));
    if (!t) return w;
    applied++;
    return w.done === t.done ? w : { ...w, done: t.done };
  });
  return { data: { ...data, workOrder: wo }, applied };
}

const parseRooms = (rooms: unknown): Record<string, unknown> | null => {
  try {
    const d = typeof rooms === "string" ? JSON.parse(rooms) : rooms;
    return d && typeof d === "object" ? (d as Record<string, unknown>) : null;
  } catch { return null; }
};

/** Pure: the taps to lay over a read of one job. Unsynced taps always; a
 *  synced tap only when the read started before it synced (the read may
 *  predate the write). No `readStartedAt` = assume the read is old. */
export function tapsForRead(q: WoToggle[], jobId: string, readStartedAt?: number): WoToggle[] {
  return q.filter((i) => i.jobId === jobId && (!i.syncedAt || readStartedAt == null || i.syncedAt > readStartedAt));
}

/** Overlay ticks onto loaded jobs (server data or the snapshot).
 *  `readStartedAt` = when that data was requested (Date.now() before the
 *  query, or the snapshot's time). */
export function applyWoPending<T extends { id: string; rooms?: unknown }>(jobs: T[], readStartedAt?: number): T[] {
  const q = read();
  if (!q.length) return jobs;
  return jobs.map((j) => {
    const mine = tapsForRead(q, j.id, readStartedAt);
    if (!mine.length) return j;
    const d = parseRooms(j.rooms);
    if (!d) return j;
    const { data, applied } = applyTogglesToBlob(d, mine);
    return applied ? { ...j, rooms: JSON.stringify(data) } : j;
  });
}

const TRANSIENT_CODE = /^(PGRST00[0-3]|PGRST303|57014|57P0[1-3]|40001|40P01|08\d{3}|53\d{3})$/;
function isTransient(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (err instanceof TypeError) return true;
  const code = err && typeof err === "object" ? (err as { code?: string }).code : undefined;
  return !code || TRANSIENT_CODE.test(code);
}

// One flush at a time, app-wide. The old guard (`if (inflight) await inflight`)
// let EVERY waiter run together once the first finished, so a tap's flush and
// the 15s poll's flush could both read the blob, each add their own ticks and
// write — the later write erased the other's tick on the server (the "one of
// four boxes flips back a second later" bug). Calls now chain.
let flushChain: Promise<unknown> = Promise.resolve();

/** Replay queued ticks (all jobs, or one). Resolves to the number still
 *  pending. Each job's read → set done → write runs in that job's shared write
 *  queue (job-serial.ts), so it can't interleave with a patchBlob either. Don't
 *  call it from inside `runSerialized` for the same job (it would wait on itself). */
export function flushWoQueue(onlyJobId?: string): Promise<number> {
  const run = flushChain.then(() => flushNow(onlyJobId));
  flushChain = run.catch(() => 0);
  return run;
}

async function flushNow(onlyJobId?: string): Promise<number> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return woPendingCount();
  const jobIds = Array.from(new Set(unsynced(read()).map((i) => i.jobId))).filter((id) => !onlyJobId || id === onlyJobId);
  for (const jobId of jobIds) {
    const stop = await jobSerial.runSerialized(jobId, () => flushJob(jobId));
    if (stop) break; // offline-ish: keep everything for the next try
  }
  return woPendingCount();
}

/** One job's taps against its current server blob. true = stop flushing. */
async function flushJob(jobId: string): Promise<boolean> {
  // Read the batch INSIDE the job queue, so taps made while earlier writes
  // ran are included and nothing is written from an older list.
  const batch = unsynced(read()).filter((i) => i.jobId === jobId);
  if (!batch.length) return false;
  const done = (ids: string[]) => write(read().filter((i) => !ids.includes(i.qid)));
  // Written: keep the taps a while as a guard against reads already in
  // flight (a tap made meanwhile has a new qid and stays unsynced).
  const synced = (ids: string[]) => {
    const at = Date.now();
    write(read().map((i) => (ids.includes(i.qid) ? { ...i, syncedAt: at, failSince: undefined } : i)));
  };
  try {
    const { data: rows, error } = await supabase.from("jobs").select("id, rooms").eq("id", jobId);
    if (error) throw error;
    const row = (rows as { id: string; rooms: unknown }[] | null)?.[0];
    const blob = row ? parseRooms(row.rooms) : null;
    if (!row || !blob) { done(batch.map((b) => b.qid)); return false; } // job gone / unreadable
    const { data: next, applied } = applyTogglesToBlob(blob, batch);
    if (!applied) { done(batch.map((b) => b.qid)); return false; } // tasks no longer exist
    const { error: upErr } = await supabase.from("jobs").update({ rooms: JSON.stringify(next) } as never).eq("id", jobId);
    if (upErr) throw upErr;
    synced(batch.map((b) => b.qid));
    return false;
  } catch (err) {
    if (isTransient(err)) {
      const since = batch[0].failSince ?? Date.now();
      if (Date.now() - since < 24 * 3600000) {
        if (!batch[0].failSince) write(read().map((i) => (i.jobId === jobId && !i.syncedAt ? { ...i, failSince: since } : i)));
        return true;
      }
    }
    // eslint-disable-next-line no-console
    console.error("[wo-queue] dropping un-replayable work-order ticks:", jobId, err);
    done(batch.map((b) => b.qid));
    return false;
  }
}
