import {
  applyVisit, decidePull, desiredEvent, eventIdFor, eventToVisit, type GEvent, type SyncJob, type SyncRow,
} from "@/lib/gcal/core";
import { syncOrg, GoogleError, type Api, type MapRow, type Store } from "@/lib/gcal/engine";
import { zonedToUtc, utcToZoned } from "@/lib/tz";

const TZ = "America/Chicago";
const ORG = "org-1";
const URL0 = "https://app.test";

// ── Fakes ──────────────────────────────────────────────────────────────
class FakeGoogle implements Api {
  cals = new Set<string>();
  events = new Map<string, GEvent>(); // id → event (cancelled ones kept, like Google)
  changed: string[] = [];             // event ids changed since the last token
  n = 0;
  clock = Date.parse("2026-11-20T12:00:00Z");
  writes = 0;
  tick() { this.clock += 1000; return new Date(this.clock).toISOString(); }
  private touch(ev: GEvent) {
    ev.etag = `"e${++this.n}"`; ev.updated = this.tick();
    this.events.set(ev.id, ev); this.changed.push(ev.id);
    return { ...ev };
  }
  async calendarExists(id: string) { return this.cals.has(id); }
  async createCalendar() { this.cals.add("cal1"); return "cal1"; }
  async listEvents(_c: string, token: string | null) {
    const ids = token ? [...new Set(this.changed)] : [...this.events.keys()];
    const items = ids.map((id) => this.events.get(id)!).filter((e) => token || e.status !== "cancelled");
    this.changed = [];
    return { items: items.map((e) => ({ ...e })), nextSyncToken: `t${this.n}` };
  }
  async insertEvent(_c: string, body: GEvent) {
    this.writes++;
    if (this.events.has(body.id)) throw new GoogleError(409, "duplicate");
    return this.touch({ ...body });
  }
  async patchEvent(_c: string, id: string, body: Partial<GEvent>, ifMatch?: string | null) {
    this.writes++;
    const cur = this.events.get(id);
    if (!cur) throw new GoogleError(404, "gone");
    if (ifMatch && ifMatch !== cur.etag) throw new GoogleError(412, "precondition");
    return this.touch({ ...cur, ...body });
  }
  async deleteEvent(_c: string, id: string) {
    this.writes++;
    const cur = this.events.get(id);
    if (!cur || cur.status === "cancelled") throw new GoogleError(410, "deleted");
    this.touch({ ...cur, status: "cancelled" });
  }
  // What a person does in Google Calendar:
  userMove(id: string, date: string, time: string, mins = 120) {
    const cur = this.events.get(id)!;
    const s = zonedToUtc(date, time, TZ);
    this.touch({ ...cur, start: { dateTime: s.toISOString() }, end: { dateTime: new Date(s.getTime() + mins * 60000).toISOString() } });
  }
  userDelete(id: string) { const cur = this.events.get(id)!; this.touch({ ...cur, status: "cancelled" }); }
  live() { return [...this.events.values()].filter((e) => e.status !== "cancelled"); }
}

class FakeStore implements Store {
  link0 = { calendar_id: null as string | null, sync_token: null as string | null };
  mapRows = new Map<string, MapRow>();
  rows = new Map<string, SyncRow>();
  jobs = new Map<string, SyncJob & { status?: string }>();
  clock = Date.parse("2026-11-20T12:00:00Z");
  constructor(private g: FakeGoogle) {}
  stamp() { this.clock = Math.max(this.clock, this.g.clock) + 1000; return new Date(this.clock).toISOString(); }
  async link() { return { ...this.link0 }; }
  async saveLink(p: Partial<typeof this.link0>) { Object.assign(this.link0, p); }
  async maps() { return [...this.mapRows.values()].map((m) => ({ ...m })); }
  async saveMap(m: MapRow) { this.mapRows.set(m.schedule_id, { ...m }); }
  async deleteMap(id: string) { this.mapRows.delete(id); }
  async clearMaps() { this.mapRows.clear(); }
  async rowsInWindow(from: string, to: string) {
    return [...this.rows.values()].filter((r) => (r.end_date || r.sched_date) >= from && r.sched_date <= to).map((r) => ({ ...r }));
  }
  async rowsByIds(ids: string[]) { return ids.map((id) => this.rows.get(id)).filter(Boolean).map((r) => ({ ...r! })); }
  async jobsByIds(ids: string[]) { return ids.map((id) => this.jobs.get(id)).filter(Boolean).map((j) => ({ ...j! })); }
  async patchRow(id: string, p: { sched_date: string; end_date: string | null; note: string }) {
    const r = this.rows.get(id); if (!r) return false;
    this.rows.set(id, { ...r, ...p, updated_at: this.stamp() }); return true;
  }
  async deleteRow(row: SyncRow) {
    this.rows.delete(String(row.id));
    const j = row.job_id ? this.jobs.get(row.job_id) : undefined;
    if (j && j.status === "scheduled" && ![...this.rows.values()].some((r) => r.job_id === j.id)) j.status = "accepted";
    return true;
  }
  // What a person does in Creed:
  put(r: Omit<SyncRow, "updated_at">) { this.rows.set(String(r.id), { ...r, updated_at: this.stamp() }); }
  edit(id: string, p: Partial<SyncRow>) { this.rows.set(id, { ...this.rows.get(id)!, ...p, updated_at: this.stamp() }); }
}

function setup() {
  const g = new FakeGoogle();
  const s = new FakeStore(g);
  s.jobs.set("j1", { id: "j1", client: "Ann Lee", total_hrs: 2, status: "scheduled" });
  s.put({ id: "1", job: "12 Elm St", job_id: "j1", sched_date: "2026-11-24", note: "🕐 08:00 · 👷 Bo Diaz · bring ladder" });
  const run = () => syncOrg({ orgId: ORG, store: s, api: g, tz: TZ, appUrl: URL0, today: "2026-11-20" });
  return { g, s, run };
}
const evId = (sid: string) => eventIdFor(ORG, sid);

// ── Pure rules ─────────────────────────────────────────────────────────
describe("gcal core", () => {
  test("event id is deterministic, Google-legal, per org + visit", () => {
    expect(eventIdFor("o", "5")).toBe(eventIdFor("o", "5"));
    expect(eventIdFor("o", "5")).not.toBe(eventIdFor("o", "6"));
    expect(eventIdFor("o", "5")).toMatch(/^[a-v0-9]{5,1024}$/);
  });

  test("a timed visit is a timed event in the business's zone; untimed / multi-day are all-day", () => {
    const timed = desiredEvent({ id: 1, job: "12 Elm", sched_date: "2026-11-24", note: "🕐 08:00" }, { id: "j", total_hrs: 3 }, TZ, URL0);
    expect(timed.start).toEqual({ dateTime: "2026-11-24T08:00:00", timeZone: TZ });
    expect(timed.end).toEqual({ dateTime: "2026-11-24T11:00:00", timeZone: TZ });
    const allDay = desiredEvent({ id: 1, job: "12 Elm", sched_date: "2026-11-24", end_date: "2026-11-26", note: "🕐 08:00" }, undefined, TZ, URL0);
    expect(allDay.start).toEqual({ date: "2026-11-24" });
    expect(allDay.end).toEqual({ date: "2026-11-27" }); // exclusive
    expect(allDay.summary).toMatch(/^8:00 AM · /);
  });

  test("eventToVisit reads times in the business's zone (offset-bearing times from Google)", () => {
    expect(eventToVisit({ id: "x", start: { dateTime: "2026-11-24T15:30:00Z" }, end: { dateTime: "2026-11-24T17:30:00Z" } }, TZ))
      .toEqual({ date: "2026-11-24", end: null, time: "09:30" });
    expect(eventToVisit({ id: "x", start: { date: "2026-11-24" }, end: { date: "2026-11-25" } }, TZ))
      .toEqual({ date: "2026-11-24", end: null, time: null });
    expect(eventToVisit({ id: "x", start: { date: "2026-11-24" }, end: { date: "2026-11-27" } }, TZ))
      .toEqual({ date: "2026-11-24", end: "2026-11-26", time: null });
  });

  test("applyVisit moves date / time and keeps crew + notes", () => {
    const row = { id: 1, sched_date: "2026-11-24", note: "🕐 08:00 · 👷 Bo Diaz · bring ladder" };
    expect(applyVisit(row, { date: "2026-11-25", end: null, time: "13:00" }))
      .toEqual({ sched_date: "2026-11-25", end_date: null, note: "🕐 13:00 · 👷 Bo Diaz · bring ladder" });
    expect(applyVisit(row, { date: "2026-11-24", end: null, time: "08:00" })).toBeNull();
    // made all-day in Google → time dropped
    expect(applyVisit(row, { date: "2026-11-24", end: null, time: null })!.note).toBe("👷 Bo Diaz · bring ladder");
    // an all-day multi-day span keeps the visit's time
    expect(applyVisit(row, { date: "2026-11-24", end: "2026-11-25", time: null })!.note).toBe(row.note);
  });

  test("decidePull: own echo, Google-only change, latest edit wins", () => {
    expect(decidePull({ mapEtag: "a", eventEtag: "a", creedChanged: true, eventUpdated: null, rowUpdated: null })).toBe("echo");
    expect(decidePull({ mapEtag: "a", eventEtag: "b", creedChanged: false, eventUpdated: null, rowUpdated: null })).toBe("apply");
    expect(decidePull({ mapEtag: "a", eventEtag: "b", creedChanged: true, eventUpdated: "2026-11-20T10:00:00Z", rowUpdated: "2026-11-20T09:00:00Z" })).toBe("apply");
    expect(decidePull({ mapEtag: "a", eventEtag: "b", creedChanged: true, eventUpdated: "2026-11-20T09:00:00Z", rowUpdated: "2026-11-20T10:00:00Z" })).toBe("creed");
  });
});

// ── Whole passes ───────────────────────────────────────────────────────
describe("gcal sync pass", () => {
  test("first pass creates the calendar and one event per visit; a second pass writes nothing", async () => {
    const { g, s, run } = setup();
    const r1 = await run();
    expect(r1.pushed).toBe(1);
    expect(s.link0.calendar_id).toBe("cal1");
    const ev = g.events.get(evId("1"))!;
    expect(ev.start).toEqual({ dateTime: "2026-11-24T08:00:00", timeZone: TZ });
    expect(ev.extendedProperties?.private?.creedScheduleId).toBe("1");
    const w = g.writes;
    const r2 = await run(); // reads back its own writes: echo, nothing pushed
    expect(r2).toMatchObject({ pulled: 0, pushed: 0 });
    expect(g.writes).toBe(w);
  });

  test("lost mapping / overlapping passes never duplicate an event", async () => {
    const { g, s, run } = setup();
    await run();
    s.mapRows.clear();
    s.link0.sync_token = null;
    await run();
    await run();
    expect(g.live()).toHaveLength(1);
    expect(s.mapRows.get("1")!.event_id).toBe(evId("1"));
  });

  test("Creed reschedule / new visit / delete reach Google", async () => {
    const { g, s, run } = setup();
    await run();
    s.edit("1", { sched_date: "2026-11-26", note: "🕐 10:30 · 👷 Bo Diaz · bring ladder" });
    s.put({ id: "2", job: "9 Oak Ave", job_id: null, sched_date: "2026-11-27", note: "" });
    await run();
    expect(g.events.get(evId("1"))!.start).toEqual({ dateTime: "2026-11-26T10:30:00", timeZone: TZ });
    expect(g.events.get(evId("2"))!.start).toEqual({ date: "2026-11-27" });
    s.rows.delete("2");
    await run();
    expect(g.events.get(evId("2"))!.status).toBe("cancelled");
    expect(s.mapRows.has("2")).toBe(false);
  });

  test("a pending booking request or an archived job is not on Google", async () => {
    const { g, s, run } = setup();
    s.put({ id: "3", job: "1 Pine", sched_date: "2026-11-25", note: "", booking_status: "requested" });
    await run();
    expect(g.events.has(evId("3"))).toBe(false);
    s.jobs.get("j1")!.archived = true;
    await run();
    expect(g.events.get(evId("1"))!.status).toBe("cancelled");
  });

  test("a move in Google updates the Creed visit (crew + notes kept) and doesn't bounce back", async () => {
    const { g, s, run } = setup();
    await run();
    g.userMove(evId("1"), "2026-11-25", "13:00", 180);
    const etagAfterMove = g.events.get(evId("1"))!.etag;
    const r = await run();
    expect(r.pulled).toBe(1);
    expect(s.rows.get("1")).toMatchObject({ sched_date: "2026-11-25", note: "🕐 13:00 · 👷 Bo Diaz · bring ladder" });
    // The person's 3-hour length stays: Creed doesn't push over it.
    expect(g.events.get(evId("1"))!.etag).toBe(etagAfterMove);
    const w = g.writes;
    await run();
    expect(g.writes).toBe(w);
  });

  test("deleting the event in Google removes the visit and puts the job back to approved", async () => {
    const { g, s, run } = setup();
    await run();
    g.userDelete(evId("1"));
    const r = await run();
    expect(r.removedInCreed).toBe(1);
    expect(s.rows.has("1")).toBe(false);
    expect(s.jobs.get("j1")!.status).toBe("accepted");
    await run();
    expect(g.live()).toHaveLength(0); // not re-created
  });

  test("conflict: both edited, the later edit wins (Creed later)", async () => {
    const { g, s, run } = setup();
    await run();
    g.userMove(evId("1"), "2026-11-25", "13:00");
    s.edit("1", { note: "🕐 15:00 · 👷 Bo Diaz · bring ladder" }); // stamped after Google's edit
    await run();
    expect(s.rows.get("1")!.sched_date).toBe("2026-11-24");
    expect(g.events.get(evId("1"))!.start).toEqual({ dateTime: "2026-11-24T15:00:00", timeZone: TZ });
  });

  test("conflict: both edited, the later edit wins (Google later)", async () => {
    const { g, s, run } = setup();
    await run();
    s.edit("1", { note: "🕐 15:00 · 👷 Bo Diaz, Cy · bring ladder" });
    g.clock = s.clock + 5000;
    g.userMove(evId("1"), "2026-11-25", "13:00");
    await run();
    expect(s.rows.get("1")).toMatchObject({ sched_date: "2026-11-25", note: "🕐 13:00 · 👷 Bo Diaz, Cy · bring ladder" });
    const ev = g.events.get(evId("1"))!;
    expect(ev.start).toEqual({ dateTime: "2026-11-25T13:00:00", timeZone: TZ }); // Google's time
    expect(ev.summary).toContain("Cy"); // Creed's crew edit still went over
  });

  test("deleted in Google while edited later in Creed → Creed wins and restores the event", async () => {
    const { g, s, run } = setup();
    await run();
    g.userDelete(evId("1"));
    s.edit("1", { note: "🕐 09:00 · 👷 Bo Diaz · bring ladder" });
    await run();
    expect(s.rows.has("1")).toBe(true);
    const ev = g.events.get(evId("1"))!;
    expect(ev.status).toBe("confirmed");
    expect(ev.start).toEqual({ dateTime: "2026-11-24T09:00:00", timeZone: TZ });
  });

  test("events Creed didn't make, and recurring ones, are left alone", async () => {
    const { g, s, run } = setup();
    await run();
    g.events.set("mine", { id: "mine", etag: "x", status: "confirmed", start: { date: "2026-11-24" }, end: { date: "2026-11-25" } });
    g.changed.push("mine");
    g.events.set("rec", { id: "rec", etag: "y", status: "confirmed", recurrence: ["RRULE:FREQ=WEEKLY"], extendedProperties: { private: { creedScheduleId: "1" } } });
    g.changed.push("rec");
    await run();
    expect(g.events.get("mine")!.status).toBe("confirmed");
    expect(s.rows.get("1")!.sched_date).toBe("2026-11-24");
  });

  test("a stale sync token (410) falls back to a full resync", async () => {
    const { g, s, run } = setup();
    await run();
    const list = g.listEvents.bind(g);
    let first = true;
    g.listEvents = async (c, t) => {
      if (t && first) { first = false; throw new GoogleError(410, "gone"); }
      return list(c, t);
    };
    g.userMove(evId("1"), "2026-11-25", "13:00");
    await run();
    expect(s.rows.get("1")!.sched_date).toBe("2026-11-25");
  });

  test("calendar deleted in Google → a fresh one, events re-made without duplicates", async () => {
    const { g, s, run } = setup();
    await run();
    g.cals.clear(); g.events.clear();
    await run();
    expect(s.link0.calendar_id).toBe("cal1");
    expect(g.live()).toHaveLength(1);
  });

  test("a revoked connection stops the pass with the auth error (nothing half-written)", async () => {
    const { g, s, run } = setup();
    const { AuthError } = await import("@/lib/gcal/engine");
    g.createCalendar = async () => { throw new AuthError("invalid_grant"); };
    await expect(run()).rejects.toBeInstanceOf(AuthError);
    expect(s.mapRows.size).toBe(0);
  });

  test("tz helpers round-trip across DST", () => {
    expect(zonedToUtc("2026-07-01", "08:00", TZ).toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedToUtc("2026-12-01", "08:00", TZ).toISOString()).toBe("2026-12-01T14:00:00.000Z");
    expect(utcToZoned("2026-11-01T14:00:00Z", TZ)).toEqual({ date: "2026-11-01", time: "08:00" });
  });
});

// ── Kick filter + server secrets ──────────────────────────────────────
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn(() => Promise.resolve()) }));
import { kickWorthy } from "@/lib/gcal-kick";
import { decrypt, encrypt, makeState, readState } from "@/lib/gcal/crypto";

describe("gcal kick + crypto", () => {
  test("only schedule writes and job fields Google shows start a sync", () => {
    expect(kickWorthy("schedule", {})).toBe(true);
    expect(kickWorthy("jobs", { archived: true })).toBe(true);
    expect(kickWorthy("jobs", { rooms: "{}" })).toBe(false);
    expect(kickWorthy("time_entries", { hours: 1 })).toBe(false);
  });

  test("tokens round-trip encrypted; tampering or a missing key fails closed", () => {
    const prev = process.env.GOOGLE_TOKEN_KEY;
    process.env.GOOGLE_TOKEN_KEY = "test-key-123";
    const enc = encrypt("1//refresh-token");
    expect(enc).not.toContain("refresh");
    expect(decrypt(enc)).toBe("1//refresh-token");
    expect(decrypt(enc.slice(0, -2) + "AA")).toBeNull();
    const st = makeState("org", "user", "nonce");
    expect(readState(st)).toEqual({ orgId: "org", userId: "user", nonce: "nonce" });
    expect(readState(st.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBeNull();
    expect(readState(makeState("org", "user", "n", Date.now() - 3600000))).toBeNull(); // expired
    process.env.GOOGLE_TOKEN_KEY = prev;
  });
});
