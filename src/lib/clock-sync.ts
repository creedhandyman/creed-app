/**
 * "Am I still clocked in?" — reconciling THIS phone's clock state with the server.
 *
 * Clock state lives in localStorage (c_t_on / c_t_active_id / c_t_st), written by
 * Timer + WorkVision. Nothing used to check it against the server, so when a
 * manager force-clocked a tech out (Time → Crew), the tech's phone kept the
 * shift running — and the tech's own clock-out later OVERWROTE the manager's
 * close (end_time + hours). Two guards fix that:
 *
 *  1. reconcile (store.reconcileClock, after each online load): if this phone
 *     says "on" for row X, X has no unsynced local write, and the server
 *     CONFIRMS (by-id read) that X is closed or gone → clear the local clock.
 *  2. conditional close (offline-queue `onlyIfOpen`): a clock-out / force-out
 *     update only lands while the row is still open, so a replay can never
 *     overwrite a close that happened elsewhere.
 *
 * The decisions are pure and tested (clock-sync.test.ts). The tiny "this phone
 * is clocking out right now" set lives here too, so the reconcile never mistakes
 * our own in-flight clock-out for one done by the office.
 */

/** An open row has a start and no finish ("" counts as no finish). */
export function isClosedRow(row: { end_time?: string | null } | null | undefined): boolean {
  return !!row && typeof row.end_time === "string" && row.end_time.trim() !== "";
}

export interface LocalClock {
  on: boolean;
  activeId: string | null;
  /** Epoch ms the local shift started (c_t_st). */
  st: number | null;
}

/** A row missing from the org list is only suspicious once the shift is this old
 *  (a clock-in that just synced may not be in the latest list yet). */
export const MISSING_GRACE_MS = 2 * 60 * 1000;

/**
 * Should we ask the server about this phone's shift? Only when the phone says
 * it's on a specific row, that row has no unsynced local write, and the store's
 * copy suggests it was closed or removed elsewhere.
 */
export function needsServerCheck(
  local: LocalClock,
  pendingRowIds: string[],
  storeRow: { end_time?: string | null } | undefined,
  nowMs: number,
): boolean {
  if (!local.on || !local.activeId) return false; // legacy rows without an id: can't tell
  if (pendingRowIds.includes(local.activeId)) return false; // our own write isn't synced yet
  if (storeRow) return isClosedRow(storeRow);
  return local.st !== null && nowMs - local.st > MISSING_GRACE_MS;
}

export type ClockVerdict = "keep" | "closed" | "deleted";

/**
 * Verdict from a SUCCESSFUL by-id server read: `rows` is what came back
 * (empty = the row no longer exists). A failed read never reaches here.
 */
export function serverVerdict(rows: { end_time?: string | null }[]): ClockVerdict {
  if (!rows.length) return "deleted";
  return isClosedRow(rows[0]) ? "closed" : "keep";
}

// ── This phone's own in-flight clock-outs ──────────────────────────────────
// Set right before Timer/WorkVision close a row and cleared once local state is
// off, so a load landing mid-clock-out doesn't read our own close as the office's.
const clockingOut = new Set<string>();
export function markLocalClockOut(id: string | null | undefined): void { if (id) clockingOut.add(id); }
export function unmarkLocalClockOut(id: string | null | undefined): void { if (id) clockingOut.delete(id); }
export function isLocalClockOut(id: string | null | undefined): boolean { return !!id && clockingOut.has(id); }
