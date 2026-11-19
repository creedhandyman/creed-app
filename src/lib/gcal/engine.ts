/**
 * One sync pass for one business: PULL Google's changes (incremental, with
 * the stored sync token), then PUSH Creed's. Storage and Google are injected
 * (Store / Api) so the whole pass is tested with fakes (gcal-sync.test.ts);
 * lib/gcal/store.ts + google.ts are the real ones.
 *
 * Rules:
 *  - One Google event per schedule row, id = eventIdFor(org, row): an insert
 *    that hits 409 means it already exists and is patched instead, so a
 *    retried or overlapping pass never makes a duplicate.
 *  - Only events Creed made are read back (creedScheduleId on the event, or
 *    the mapping). Other events on the calendar, and recurring ones, are left
 *    alone.
 *  - Conflicts: decidePull() — latest edit wins.
 *  - Pending online-booking requests and archived jobs aren't on Google; a
 *    visit that becomes one has its event removed.
 */
import {
  applyVisit, decidePull, desiredEvent, eventHash, eventIdFor, eventToVisit, excluded,
  type EventBody, type GEvent, type SyncJob, type SyncRow,
} from "./core";

export interface MapRow { schedule_id: string; event_id: string; etag: string | null; creed_hash: string | null }

export interface Store {
  link(): Promise<{ calendar_id: string | null; sync_token: string | null }>;
  saveLink(patch: { calendar_id?: string | null; sync_token?: string | null }): Promise<void>;
  maps(): Promise<MapRow[]>;
  saveMap(m: MapRow): Promise<void>;
  deleteMap(scheduleId: string): Promise<void>;
  clearMaps(): Promise<void>;
  /** Visits touching [from, to] (a visit that started earlier but runs into it counts). */
  rowsInWindow(from: string, to: string): Promise<SyncRow[]>;
  rowsByIds(ids: string[]): Promise<SyncRow[]>;
  jobsByIds(ids: string[]): Promise<SyncJob[]>;
  patchRow(id: string, patch: { sched_date: string; end_date: string | null; note: string }): Promise<boolean>;
  /** Delete the visit; when it was its job's last one, the job's status goes back (statusAfterUnschedule). */
  deleteRow(row: SyncRow): Promise<boolean>;
}

export class GoogleError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
/** The Google connection is revoked / expired: the owner must reconnect. */
export class AuthError extends Error {}

export interface Api {
  calendarExists(id: string): Promise<boolean>;
  createCalendar(name: string, tz: string): Promise<string>;
  /** All pages. With a syncToken: only changes since (cancelled ones included). Throws GoogleError(410) when the token is stale. */
  listEvents(calendarId: string, syncToken: string | null): Promise<{ items: GEvent[]; nextSyncToken: string | null }>;
  insertEvent(calendarId: string, body: EventBody & { id: string }): Promise<GEvent>;
  patchEvent(calendarId: string, eventId: string, body: EventBody, ifMatch?: string | null): Promise<GEvent>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

export interface SyncResult { pulled: number; pushed: number; removedInCreed: number; removedInGoogle: number; skipped: number }

export async function syncOrg(o: {
  orgId: string; store: Store; api: Api; tz: string; appUrl: string; today: string; calendarName?: string;
}): Promise<SyncResult> {
  const { orgId, store, api, tz, appUrl } = o;
  const res: SyncResult = { pulled: 0, pushed: 0, removedInCreed: 0, removedInGoogle: 0, skipped: 0 };

  // ── The calendar ──
  let link = await store.link();
  let calId = link.calendar_id;
  if (!calId || !(await api.calendarExists(calId))) {
    calId = await api.createCalendar(o.calendarName || "Creed jobs", tz);
    await store.clearMaps();
    await store.saveLink({ calendar_id: calId, sync_token: null });
    link = { calendar_id: calId, sync_token: null };
  }

  const maps = await store.maps();
  const bySched = new Map(maps.map((m) => [m.schedule_id, m]));
  const byEvent = new Map(maps.map((m) => [m.event_id, m]));
  const jobCache = new Map<string, SyncJob>();
  const loadJobs = async (rows: SyncRow[]) => {
    const need = [...new Set(rows.map((r) => r.job_id).filter((id): id is string => !!id && !jobCache.has(id)))];
    if (need.length) for (const j of await store.jobsByIds(need)) jobCache.set(j.id, j);
  };
  const jobOf = (r: SyncRow) => (r.job_id ? jobCache.get(r.job_id) : undefined);
  const hashOf = (r: SyncRow) => eventHash(desiredEvent(r, jobOf(r), tz, appUrl));
  const setMap = async (m: MapRow) => {
    const old = bySched.get(m.schedule_id);
    if (old) byEvent.delete(old.event_id);
    bySched.set(m.schedule_id, m); byEvent.set(m.event_id, m);
    await store.saveMap(m);
  };
  const dropMap = async (scheduleId: string) => {
    const old = bySched.get(scheduleId);
    if (old) byEvent.delete(old.event_id);
    bySched.delete(scheduleId);
    await store.deleteMap(scheduleId);
  };

  // ── PULL ──
  let listing: { items: GEvent[]; nextSyncToken: string | null };
  try {
    listing = await api.listEvents(calId, link.sync_token);
  } catch (e) {
    if (!(e instanceof GoogleError && e.status === 410)) throw e;
    listing = await api.listEvents(calId, null); // stale token → full resync
  }
  const events = listing.items.filter((ev) => !ev.recurringEventId && !ev.recurrence?.length);
  const linkedIds = new Set<string>();
  for (const ev of events) {
    const m = byEvent.get(ev.id);
    const sid = m?.schedule_id || ev.extendedProperties?.private?.creedScheduleId;
    if (sid) linkedIds.add(sid);
  }
  const pullRows = new Map((await store.rowsByIds([...linkedIds])).map((r) => [String(r.id), r]));
  await loadJobs([...pullRows.values()]);

  for (const ev of events) {
    let m = byEvent.get(ev.id);
    if (!m) {
      const sid = ev.extendedProperties?.private?.creedScheduleId;
      // Someone else's event on the calendar, or a cancelled one we already let go of.
      if (!sid || ev.status === "cancelled") { res.skipped++; continue; }
      if (bySched.has(sid) || ev.id !== eventIdFor(orgId, sid)) { res.skipped++; continue; } // a copy (another calendar's id) — never adopt
      const row = pullRows.get(sid);
      if (!row) {
        // Ours, but its visit is gone (mapping lost): take it off Google.
        await api.deleteEvent(calId, ev.id).catch(ignoreGone);
        res.removedInGoogle++;
        continue;
      }
      // Re-link; the push below brings it in line with Creed.
      m = { schedule_id: sid, event_id: ev.id, etag: ev.etag || null, creed_hash: null };
      await setMap(m);
      continue;
    }
    const row = pullRows.get(m.schedule_id);
    if (!row) continue; // deleted in Creed — the push removes the event
    const job = jobOf(row);
    if (excluded(row, job)) continue;
    const decision = decidePull({
      mapEtag: m.etag, eventEtag: ev.etag, creedChanged: hashOf(row) !== m.creed_hash,
      eventUpdated: ev.updated, rowUpdated: row.updated_at,
    });
    if (decision === "echo") continue;
    const creedChanged = hashOf(row) !== m.creed_hash;
    if (decision === "creed") {
      // Creed's newer edit goes over it in the push; remember Google's etag so that write isn't refused.
      await setMap({ ...m, etag: ev.etag || null });
      continue;
    }
    if (ev.status === "cancelled") {
      if (await store.deleteRow(row)) {
        await dropMap(m.schedule_id);
        pullRows.delete(m.schedule_id);
        res.removedInCreed++;
      }
      continue;
    }
    const visit = eventToVisit(ev, tz);
    if (!visit) continue;
    const patch = applyVisit(row, visit);
    let now = row;
    if (patch) {
      if (!(await store.patchRow(String(row.id), patch))) continue;
      now = { ...row, ...patch };
      pullRows.set(m.schedule_id, now);
      res.pulled++;
    }
    // Both sides changed (Google's date / time won): keep the old hash so the
    // push still sends Creed's other edits (crew, client) over.
    await setMap({ ...m, etag: ev.etag || null, creed_hash: creedChanged ? m.creed_hash : hashOf(now) });
  }
  // The token is saved only after every change it covers has been handled.
  if (listing.nextSyncToken) await store.saveLink({ sync_token: listing.nextSyncToken });

  // ── PUSH ──
  const rows = await store.rowsInWindow(addDaysYmd(o.today, -30), addDaysYmd(o.today, 183));
  await loadJobs(rows);
  const shown = new Set<string>();
  for (const row of rows) {
    const sid = String(row.id);
    if (excluded(row, jobOf(row))) continue;
    shown.add(sid);
    const body = desiredEvent(row, jobOf(row), tz, appUrl);
    const hash = eventHash(body);
    const m = bySched.get(sid);
    if (m && m.creed_hash === hash) continue;
    let ev: GEvent | null = null;
    const eventId = m?.event_id || eventIdFor(orgId, sid);
    try {
      ev = m
        ? await api.patchEvent(calId, eventId, body, m.etag)
        : await insertOrAdopt(api, calId, eventId, body);
    } catch (e) {
      if (e instanceof GoogleError && e.status === 412) { res.skipped++; continue; } // changed in Google just now — next pull decides
      if (e instanceof GoogleError && (e.status === 404 || e.status === 410)) ev = await insertOrAdopt(api, calId, eventId, body);
      else throw e;
    }
    await setMap({ schedule_id: sid, event_id: ev.id || eventId, etag: ev.etag || null, creed_hash: hash });
    res.pushed++;
  }

  // Events whose visit is gone, became a pending request, or whose job was archived.
  const leftover = [...bySched.values()].filter((m) => !shown.has(m.schedule_id));
  if (leftover.length) {
    const still = new Map((await store.rowsByIds(leftover.map((m) => m.schedule_id))).map((r) => [String(r.id), r]));
    await loadJobs([...still.values()]);
    for (const m of leftover) {
      const row = still.get(m.schedule_id);
      if (row && !excluded(row, jobOf(row))) continue; // just outside the window — leave it
      await api.deleteEvent(calId, m.event_id).catch(ignoreGone);
      await dropMap(m.schedule_id);
      res.removedInGoogle++;
    }
  }
  return res;
}

async function insertOrAdopt(api: Api, calId: string, eventId: string, body: EventBody): Promise<GEvent> {
  try {
    return await api.insertEvent(calId, { ...body, id: eventId });
  } catch (e) {
    // Already there (an earlier pass, or deleted in Google: a deleted event
    // keeps its id) → overwrite it; status "confirmed" in the body restores it.
    if (e instanceof GoogleError && e.status === 409) return api.patchEvent(calId, eventId, body, null);
    throw e;
  }
}

function ignoreGone(e: unknown) {
  if (e instanceof GoogleError && (e.status === 404 || e.status === 410)) return;
  throw e;
}

function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
