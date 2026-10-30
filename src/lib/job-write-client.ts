"use client";
/**
 * Production wiring for job-write.ts: the browser's Supabase client on the
 * remote side, the Zustand store on the local side. Screens and queues import
 * `patchBlob` / `runSerialized` / `settled` from HERE (one writer instance, so
 * one queue per job for the whole app).
 */
import { db, supabase } from "./supabase";
import { useStore } from "./store";
import { tryReadBlob } from "./job-blob";
import { createBlobWriter, type BlobLocal, type BlobRemote } from "./job-write";

export { SKIP, addPhoto, type Change, type WriteResult } from "./job-write";

const remote: BlobRemote = {
  async read(jobId) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("offline");
    const { data, error } = await supabase.from("jobs").select("rooms").eq("id", jobId).maybeSingle();
    if (error) throw error;
    return data ? { rooms: (data as { rooms: unknown }).rooms } : null;
  },
  async write(jobId, rooms) {
    const ok = await db.patch("jobs", jobId, { rooms }); // toasts its own failure
    if (!ok && typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("offline");
    return ok;
  },
};

const local: BlobLocal = {
  get(jobId) {
    const j = useStore.getState().jobs.find((x) => x.id === jobId);
    return j ? tryReadBlob(j.rooms) ?? {} : null;
  },
  merge(jobId, delta) {
    useStore.setState((st) => ({
      jobs: st.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const cur = tryReadBlob(j.rooms);
        if (!cur && j.rooms) return j; // unreadable — leave the screen copy alone
        return { ...j, rooms: JSON.stringify({ ...(cur ?? {}), ...delta }) };
      }),
    }));
  },
};

const writer = createBlobWriter(remote, local);
export const patchBlob = writer.patchBlob;
export const runSerialized = writer.runSerialized;
export const settled = writer.settled;
