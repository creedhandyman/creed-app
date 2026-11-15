import { tryReadBlob } from "./job-blob";

/** The money on a lead's unsaved AI draft. labor / materials are null on
 *  drafts made before they were stored (2026-11-14) — show a dash, not $0. */
export interface LeadDraftMoney {
  total: number;
  labor: number | null;
  materials: number | null;
  hours: number | null;
}

/**
 * Client-safe reader for a lead's server-made AI draft (see lib/lead-draft.ts).
 * null once the lead has a real quote (the draft is then history) or when
 * there is no usable draft.
 */
export function leadDraftMoney(rooms: unknown): LeadDraftMoney | null {
  try {
    const d = tryReadBlob(rooms) as {
      rooms?: unknown[];
      leadDraft?: { rooms?: { items?: { laborHrs?: unknown }[] }[]; total?: unknown; labor?: unknown; materials?: unknown; hours?: unknown };
    } | null;
    if (!d || (Array.isArray(d.rooms) && d.rooms.length)) return null; // already quoted
    const dr = d.leadDraft;
    if (!dr || !Array.isArray(dr.rooms) || !dr.rooms.length || typeof dr.total !== "number") return null;
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    // Hours don't depend on the rate, so an older draft can still show them.
    const lineHrs = dr.rooms.reduce(
      (s, r) => s + (Array.isArray(r?.items) ? r.items.reduce((ss, it) => ss + (typeof it?.laborHrs === "number" ? it.laborHrs : 0), 0) : 0),
      0,
    );
    return {
      total: dr.total,
      labor: num(dr.labor),
      materials: num(dr.materials),
      hours: num(dr.hours) ?? (lineHrs > 0 ? Math.round(lineHrs * 100) / 100 : null),
    };
  } catch {
    return null;
  }
}

/** The draft's total, or null (see leadDraftMoney). */
export function leadDraftTotal(rooms: unknown): number | null {
  return leadDraftMoney(rooms)?.total ?? null;
}
