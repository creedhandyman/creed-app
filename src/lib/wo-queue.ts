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
 */
"use client";
import { supabase } from "./supabase";
import { woKey } from "./job-blob";

export interface WoToggle {
  qid: string;
  jobId: string;
  key: string; // `${room}|||${detail}`, lowercased + trimmed
  done: boolean;
  ts: number;
  /** First transient failure — retry for a day from here. */
  failSince?: number;
}

const KEY = "c_wo_queue";

// The task key lives with the blob reader; re-exported for existing callers.
export { woKey };

function read(): WoToggle[] {
  if (typeof window === "undefined") return [];
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as WoToggle[]) : []; } catch { return []; }
}
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

export function woPendingCount(): number {
  return read().length;
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

/** Overlay unsynced ticks onto loaded jobs (server data or the snapshot). */
export function applyWoPending<T extends { id: string; rooms?: unknown }>(jobs: T[]): T[] {
  const q = read();
  if (!q.length) return jobs;
  return jobs.map((j) => {
    const mine = q.filter((i) => i.jobId === j.id);
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

let inflight: Promise<number> | null = null;

/** Replay queued ticks (all jobs, or one). Resolves to the number still pending. */
export async function flushWoQueue(onlyJobId?: string): Promise<number> {
  if (inflight) { await inflight.catch(() => 0); }
  if (typeof navigator !== "undefined" && navigator.onLine === false) return woPendingCount();
  const run = (async () => {
    const jobIds = Array.from(new Set(read().map((i) => i.jobId))).filter((id) => !onlyJobId || id === onlyJobId);
    for (const jobId of jobIds) {
      const batch = read().filter((i) => i.jobId === jobId);
      if (!batch.length) continue;
      const done = (ids: string[]) => write(read().filter((i) => !ids.includes(i.qid)));
      try {
        const { data: rows, error } = await supabase.from("jobs").select("id, rooms").eq("id", jobId);
        if (error) throw error;
        const row = (rows as { id: string; rooms: unknown }[] | null)?.[0];
        const blob = row ? parseRooms(row.rooms) : null;
        if (!row || !blob) { done(batch.map((b) => b.qid)); continue; } // job gone / unreadable
        const { data: next, applied } = applyTogglesToBlob(blob, batch);
        if (!applied) { done(batch.map((b) => b.qid)); continue; } // tasks no longer exist
        const { error: upErr } = await supabase.from("jobs").update({ rooms: JSON.stringify(next) } as never).eq("id", jobId);
        if (upErr) throw upErr;
        done(batch.map((b) => b.qid));
      } catch (err) {
        if (isTransient(err)) {
          const since = batch[0].failSince ?? Date.now();
          if (Date.now() - since < 24 * 3600000) {
            if (!batch[0].failSince) write(read().map((i) => (i.jobId === jobId ? { ...i, failSince: since } : i)));
            break; // still offline-ish — keep everything for the next try
          }
        }
        // eslint-disable-next-line no-console
        console.error("[wo-queue] dropping un-replayable work-order ticks:", jobId, err);
        done(batch.map((b) => b.qid));
      }
    }
    return woPendingCount();
  })();
  inflight = run;
  try { return await run; } finally { if (inflight === run) inflight = null; }
}
