/**
 * Writing a job's `rooms` blob — the other half of job-blob.ts (which only
 * READS it). ONE writer for every screen / queue that changes the blob, so the
 * rules live here instead of ~20 hand-rolled copies:
 *
 *  - OPTIMISTIC: the caller's screen copy is updated synchronously, so a tap
 *    renders in the same frame; the network write follows.
 *  - SERIALIZED per job, in call order, across ALL callers (Jobs and WorkVision
 *    used to keep two separate queues that never waited on each other).
 *  - FRESH BASE: each write reads the SERVER's current blob and merges only the
 *    keys the change returned. The screen's copy (stale by up to the 15 s poll)
 *    is never the base, so a write can't erase keys somebody else set — the
 *    "approval record erased by a stale-store blob write" bug.
 *  - Writes nothing when nothing would change.
 *
 * A change is `{ key: value }` (the common case) or `(blob) => delta | SKIP`.
 * A function change runs TWICE — on the screen copy for the instant update, then
 * on the server blob — so it must be pure and idempotent (dedupe inside it).
 * Return only the keys you touched: a nested edit such as `rooms[]` replaces
 * that whole key.
 *
 * Never throws and never toasts (the browser adapter's db.patch already toasts
 * a refused write); failure comes back as `{ ok: false, reason }`. A failed
 * write leaves the optimistic value on screen until the next poll reconciles
 * it — the behavior every caller had before. Not here: offline durability
 * (wo-queue owns work-order ticks, offline-uploads owns photos) and the server
 * routes' conditional writes (they keep their own guards).
 *
 * This file is the pure core, tested through fake adapters. The production
 * wiring (Supabase + the Zustand store) is job-write-client.ts.
 */
import { tryReadBlob, type RoomsBlob } from "./job-blob";

export const SKIP: unique symbol = Symbol("job-write.skip");

export type Delta = Record<string, unknown>;
export type Change = Delta | ((blob: RoomsBlob) => Delta | typeof SKIP);

export type WriteResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "no-job" | "unreadable" | "network" | "rejected" };

/** The server side of the seam. */
export interface BlobRemote {
  /** The job's current row, or null when there's no such job. Throws on a
   *  transport / database error. */
  read(jobId: string): Promise<{ rooms: unknown } | null>;
  /** Write the whole blob text. false = refused (already reported to the user
   *  by the adapter); throws on a transport error. */
  write(jobId: string, rooms: string): Promise<boolean>;
}

/** The screen's own copy (the store). Used ONLY for the instant update. */
export interface BlobLocal {
  get(jobId: string): RoomsBlob | null;
  merge(jobId: string, delta: Delta): void;
}

const run = (change: Change, blob: RoomsBlob): Delta | typeof SKIP =>
  typeof change === "function" ? change(blob) : change;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const differs = (blob: RoomsBlob, delta: Delta) => Object.keys(delta).some((k) => !same(blob[k], delta[k]));

/** Append a photo unless one with the same url is already there (a retried
 *  replay can't duplicate it). */
export const addPhoto = (photo: { url: string } & Delta): Change => (blob) => {
  const photos: { url?: string }[] = Array.isArray(blob.photos) ? blob.photos : [];
  return photos.some((p) => p?.url === photo.url) ? SKIP : { photos: [...photos, photo] };
};

export function createBlobWriter(remote: BlobRemote, local?: BlobLocal) {
  // One chain per job. Each entry is a promise that never rejects.
  const chains = new Map<string, Promise<unknown>>();

  /** Run `task` after everything already queued for this job. Anything else that
   *  reads-merges-writes the same blob (wo-queue's flush) goes through here too
   *  so it can't interleave with a patchBlob. */
  function runSerialized<T>(jobId: string, task: () => Promise<T>): Promise<T> {
    const prev = chains.get(jobId) ?? Promise.resolve();
    const next = prev.then(task);
    const tail = next.then(() => undefined, () => undefined);
    chains.set(jobId, tail);
    void tail.then(() => { if (chains.get(jobId) === tail) chains.delete(jobId); });
    return next;
  }

  /** Resolves once everything queued for this job so far has been written. */
  const settled = (jobId: string): Promise<void> =>
    (chains.get(jobId) ?? Promise.resolve()).then(() => undefined);

  function patchBlob(jobId: string, change: Change): Promise<WriteResult> {
    if (local) {
      try {
        const d = run(change, local.get(jobId) ?? {});
        if (d !== SKIP) local.merge(jobId, d);
      } catch { /* the instant update is best-effort */ }
    }
    return runSerialized<WriteResult>(jobId, async () => {
      let row: { rooms: unknown } | null;
      try { row = await remote.read(jobId); } catch { return { ok: false, reason: "network" }; }
      if (!row) return { ok: false, reason: "no-job" };
      const empty = row.rooms === null || row.rooms === undefined || row.rooms === "";
      const blob = empty ? {} : tryReadBlob(row.rooms);
      if (!blob) return { ok: false, reason: "unreadable" }; // never overwrite data we can't read
      let delta: Delta | typeof SKIP;
      try { delta = run(change, blob); } catch { return { ok: false, reason: "rejected" }; }
      if (delta === SKIP || !differs(blob, delta)) return { ok: true, changed: false };
      try {
        return (await remote.write(jobId, JSON.stringify({ ...blob, ...delta })))
          ? { ok: true, changed: true }
          : { ok: false, reason: "rejected" };
      } catch {
        return { ok: false, reason: "network" };
      }
    });
  }

  return { patchBlob, runSerialized, settled };
}
