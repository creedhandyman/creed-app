/** The engine's Store over Supabase (service role, always scoped to one org). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { statusAfterUnschedule } from "../day-plan";
import type { Job } from "../types";
import type { SyncJob, SyncRow } from "./core";
import type { MapRow, Store } from "./engine";

const ROW_COLS = "id, job, job_id, sched_date, end_date, note, booking_status, updated_at";
const fail = (what: string, e: { message: string } | null) => { if (e) throw new Error(`${what}: ${e.message}`); };

export function supabaseStore(sb: SupabaseClient, orgId: string): Store {
  const links = () => sb.from("google_calendar_links");
  const maps = () => sb.from("google_calendar_events");
  const chunks = <T,>(a: T[], n = 150) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

  return {
    async link() {
      const { data, error } = await links().select("calendar_id, sync_token").eq("org_id", orgId).maybeSingle();
      fail("link", error);
      return { calendar_id: data?.calendar_id ?? null, sync_token: data?.sync_token ?? null };
    },
    async saveLink(patch) {
      const { error } = await links().update({ ...patch, updated_at: new Date().toISOString() }).eq("org_id", orgId);
      fail("save link", error);
    },
    async maps() {
      const { data, error } = await maps().select("schedule_id, event_id, etag, creed_hash").eq("org_id", orgId);
      fail("maps", error);
      return (data || []) as MapRow[];
    },
    async saveMap(m) {
      // A stale row could hold this event id under another visit; the event id is unique per org.
      await maps().delete().eq("org_id", orgId).eq("event_id", m.event_id).neq("schedule_id", m.schedule_id);
      const { error } = await maps().upsert({ org_id: orgId, ...m, updated_at: new Date().toISOString() }, { onConflict: "org_id,schedule_id" });
      fail("save map", error);
    },
    async deleteMap(scheduleId) {
      const { error } = await maps().delete().eq("org_id", orgId).eq("schedule_id", scheduleId);
      fail("delete map", error);
    },
    async clearMaps() {
      const { error } = await maps().delete().eq("org_id", orgId);
      fail("clear maps", error);
    },
    async rowsInWindow(from, to) {
      // 60 days back so a multi-day visit that started earlier but runs into the window counts.
      const back = new Date(Date.parse(from + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
      const { data, error } = await sb.from("schedule").select(ROW_COLS).eq("org_id", orgId).gte("sched_date", back).lte("sched_date", to).limit(5000);
      fail("schedule", error);
      return ((data || []) as SyncRow[]).filter((r) => (r.end_date || r.sched_date) >= from);
    },
    async rowsByIds(ids) {
      const out: SyncRow[] = [];
      for (const part of chunks(ids)) {
        const { data, error } = await sb.from("schedule").select(ROW_COLS).eq("org_id", orgId).in("id", part);
        fail("schedule by id", error);
        out.push(...((data || []) as SyncRow[]));
      }
      return out;
    },
    async jobsByIds(ids) {
      const out: SyncJob[] = [];
      for (const part of chunks(ids)) {
        const { data, error } = await sb.from("jobs").select("id, client, requested_tech, total_hrs, trade, archived, status").eq("org_id", orgId).in("id", part);
        fail("jobs", error);
        out.push(...((data || []) as SyncJob[]));
      }
      return out;
    },
    async patchRow(id, patch) {
      const { data, error } = await sb.from("schedule").update(patch).eq("org_id", orgId).eq("id", id).select("id");
      if (error) return false;
      return !!data?.length;
    },
    async deleteRow(row) {
      const { error } = await sb.from("schedule").delete().eq("org_id", orgId).eq("id", row.id);
      if (error) return false;
      if (row.job_id) {
        const { count } = await sb.from("schedule").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("job_id", row.job_id);
        if (!count) {
          const { data: job } = await sb.from("jobs").select("status, client_signature, approved_at, quote_sent_at")
            .eq("org_id", orgId).eq("id", row.job_id).maybeSingle();
          const next = job ? statusAfterUnschedule(job as Pick<Job, "status" | "client_signature" | "approved_at" | "quote_sent_at">) : null;
          if (next) await sb.from("jobs").update({ status: next }).eq("org_id", orgId).eq("id", row.job_id).eq("status", "scheduled");
        }
      }
      return true;
    },
  };
}
