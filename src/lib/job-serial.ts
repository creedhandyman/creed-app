/**
 * ONE write queue per job for everything that reads-merges-writes a job's
 * `rooms` blob: patchBlob (job-write.ts) and the work-order tick flush
 * (wo-queue.ts). No imports, so both (and the store) can share the same
 * instance without an import cycle.
 *
 * It also remembers which jobs have a blob write queued / in flight or just
 * finished, so the 15s poll can tell when its read may be OLDER than what's on
 * screen (`blobWrittenSince`) and keep the screen's copy instead of
 * clobbering it (fix 2026-11-21, "checked boxes flip back").
 */
export interface Serializer {
  runSerialized<T>(jobId: string, task: () => Promise<T>): Promise<T>;
  settled(jobId: string): Promise<void>;
  /** A write for this job is queued / running, or finished after `since`. */
  blobWrittenSince(jobId: string, since: number): boolean;
}

export function createSerializer(now: () => number = Date.now): Serializer {
  const chains = new Map<string, Promise<unknown>>();
  const busy = new Map<string, number>();
  const lastDone = new Map<string, number>();

  function runSerialized<T>(jobId: string, task: () => Promise<T>): Promise<T> {
    busy.set(jobId, (busy.get(jobId) || 0) + 1);
    const prev = chains.get(jobId) ?? Promise.resolve();
    const next = prev.then(task).finally(() => {
      const n = (busy.get(jobId) || 1) - 1;
      if (n > 0) busy.set(jobId, n); else busy.delete(jobId);
      lastDone.set(jobId, now());
    });
    const tail = next.then(() => undefined, () => undefined);
    chains.set(jobId, tail);
    void tail.then(() => { if (chains.get(jobId) === tail) chains.delete(jobId); });
    return next;
  }

  const settled = (jobId: string): Promise<void> => (chains.get(jobId) ?? Promise.resolve()).then(() => undefined);

  const blobWrittenSince = (jobId: string, since: number): boolean =>
    (busy.get(jobId) || 0) > 0 || (lastDone.get(jobId) ?? -Infinity) >= since;

  return { runSerialized, settled, blobWrittenSince };
}

/** The app's one instance (job-write-client, wo-queue and the store use it). */
export const jobSerial: Serializer = createSerializer();
