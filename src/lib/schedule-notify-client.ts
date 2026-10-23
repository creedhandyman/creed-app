/**
 * Client side of schedule alerts: snapshot a schedule row before/after a write
 * and post the resulting notices (lib/schedule-notify) to /api/notify/schedule.
 * Fire-and-forget — an alert failing never blocks the schedule write.
 */
import { apiFetch } from "./api";
import { useStore } from "./store";
import { visitSnap, scheduleNotices, todayYmd, type Notice, type VisitSnap } from "./schedule-notify";

type Row = { job?: string | null; job_id?: string | null; sched_date: string; end_date?: string | null; note?: string | null };

/** A schedule row as a VisitSnap, with its linked job's requested tech as crew. */
export function snapOf(row: Row): VisitSnap {
  const job = row.job_id ? useStore.getState().jobs.find((j) => j.id === row.job_id) : undefined;
  return visitSnap(row, job?.requested_tech);
}

/** Notices for one write (prev/next = row before / after; null = none). */
export function noticesFor(prev: Row | null, next: Row | null): Notice[] {
  return scheduleNotices(prev ? snapOf(prev) : null, next ? snapOf(next) : null, todayYmd());
}

export function sendScheduleNotices(notices: Notice[]): void {
  if (!notices.length) return;
  apiFetch("/api/notify/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notices }),
  }).catch(() => { /* non-blocking */ });
}
