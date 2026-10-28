import { tryReadBlob } from "./job-blob";
/** Client-safe reader for a lead's server-made AI draft (see lib/lead-draft.ts). */
export function leadDraftTotal(rooms: unknown): number | null {
  try {
    const d = tryReadBlob(rooms);
    const ld = (d as { rooms?: unknown[]; leadDraft?: { rooms?: unknown[]; total?: unknown } } | null);
    if (!ld || (Array.isArray(ld.rooms) && ld.rooms.length)) return null; // already quoted
    const dr = ld.leadDraft;
    return dr && Array.isArray(dr.rooms) && dr.rooms.length && typeof dr.total === "number" ? dr.total : null;
  } catch {
    return null;
  }
}
