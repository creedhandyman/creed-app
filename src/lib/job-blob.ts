/**
 * Reading a job's `rooms` blob — the JSON column that holds the quote (rooms,
 * tiers, photos, workOrder, jobNotes, approval, …). It arrives as a JSON
 * string from Supabase but as an object once something in the app has
 * patched it locally, and old / hand-edited rows can be empty or malformed.
 *
 * READ ONLY. How and where the blob is written (Jobs' enqueueRoomsWrite, the
 * offline queues, saveJob) is deliberately not here.
 */

// The blob is free-form JSON; callers read the fields they know (same typing
// JSON.parse gave every call site before this module).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RoomsBlob = Record<string, any>;

const isPlainObject = (v: unknown): v is RoomsBlob =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** The blob as an object, or null when there's none / it can't be read
 *  (missing, malformed JSON, or JSON that isn't an object — null, a number,
 *  a legacy bare array). For callers that must tell "no blob" apart, e.g. to
 *  skip a write rather than overwrite unreadable data. Never throws. An
 *  object is passed through as-is (same reference, not a copy). */
export function tryReadBlob(rooms: unknown): RoomsBlob | null {
  if (typeof rooms === "string") {
    if (!rooms) return null;
    try {
      const v = JSON.parse(rooms);
      return isPlainObject(v) ? v : null;
    } catch {
      return null;
    }
  }
  return isPlainObject(rooms) ? rooms : null;
}

/** The blob as an object — `{}` when there's none or it can't be read.
 *  Never throws. Pass the rooms VALUE (job.rooms), not the job row: a blob
 *  has its own `rooms` key, so a row and a blob can't be told apart. */
export function readBlob(rooms: unknown): RoomsBlob {
  return tryReadBlob(rooms) ?? {};
}

/** readBlob(job.rooms) for an optional job row. */
export function jobBlob(job: { rooms?: unknown } | null | undefined): RoomsBlob {
  return readBlob(job?.rooms);
}

/** Stable identity of a work-order task inside the blob: room + detail,
 *  case/space-insensitive. Used to find a task again after the array shifted
 *  (WorkVision / Jobs ticks, the offline tick queue). */
export function woKey(w: { room?: string; detail?: string }): string {
  return `${(w.room || "").toLowerCase().trim()}|||${(w.detail || "").toLowerCase().trim()}`;
}
