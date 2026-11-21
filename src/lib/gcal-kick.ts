/**
 * After the app writes the schedule (or a job field Google shows), ask the
 * server to sync Google Calendar now (/api/gcal/kick), debounced so a batch of
 * writes (Dispatch's "Apply plan", deleting a job's visits) is ONE sync. The
 * server does nothing when Google Calendar isn't connected; the 10-minute cron
 * catches anything missed (and server-side writes). supabase.ts's db helpers
 * fire the "creed:db-write" event this listens to.
 */
import { apiFetch } from "./api";

/** Job fields that change what the Google event says (or whether it exists). */
const JOB_FIELDS = ["archived", "client", "property", "total_hrs", "requested_tech", "trade"];

export function kickWorthy(table: string, fields: Record<string, unknown> | null | undefined): boolean {
  if (table === "schedule") return true;
  if (table === "jobs") return !!fields && JOB_FIELDS.some((k) => k in fields);
  return false;
}

let installed = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export function installGcalKick(delayMs = 2500): () => void {
  if (installed || typeof window === "undefined") return () => {};
  installed = true;
  const onWrite = (e: Event) => {
    const d = (e as CustomEvent<{ table: string; fields: Record<string, unknown> }>).detail;
    if (!d || !kickWorthy(d.table, d.fields)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      apiFetch("/api/gcal/kick", { method: "POST" }).catch(() => { /* cron catches it */ });
    }, delayMs);
  };
  window.addEventListener("creed:db-write", onWrite);
  return () => { window.removeEventListener("creed:db-write", onWrite); installed = false; };
}
