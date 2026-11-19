/**
 * Agent API read tools + update_job (2026-11-22): date ranges, why a day has
 * no open times, status-change rules, note appending, quote / invoice state,
 * and the tools run through the shared runner (scope, activity log) on a fake
 * Supabase.
 */
jest.mock("@/lib/supabase", () => ({ db: {}, supabase: {} }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/api-auth", () => ({ serviceClient: () => { throw new Error("no db in tests"); } }));
jest.mock("@/lib/notify-server", () => ({ dispatchNotifications: jest.fn(), resolveRecipients: jest.fn(async () => []) }));
jest.mock("@/lib/anthropic-server", () => ({ callClaude: jest.fn() }));

import {
  appendNote, checkStatusChange, cleanStatuses, customerHit, explainDays, invoiceState, quoteState, resolveRange, slotsHeadline, visitOut,
} from "@/lib/agent/read";
import { readBookingSettings, DEFAULT_BOOKING_HOURS } from "@/lib/booking";
import { runTool, TOOLS, type AgentCtx } from "@/lib/agent/server";
import { AGENT_SCOPES } from "@/lib/agent/scopes";
import { resetMemoryLimits } from "@/lib/rate-limit";

const JOB = "11111111-2222-4333-8444-555555555555";

describe("date ranges (business time zone 'today' passed in)", () => {
  const thu = "2026-11-19"; // a Thursday
  it("named ranges", () => {
    expect(resolveRange({}, thu)).toEqual({ ok: true, from: thu, to: thu });
    expect(resolveRange({ range: "tomorrow" }, thu)).toEqual({ ok: true, from: "2026-11-20", to: "2026-11-20" });
    expect(resolveRange({ range: "this_week" }, thu)).toEqual({ ok: true, from: thu, to: "2026-11-22" }); // through Sunday
    expect(resolveRange({ range: "next_week" }, thu)).toEqual({ ok: true, from: "2026-11-23", to: "2026-11-29" });
    expect(resolveRange({ range: "this_week" }, "2026-11-22")).toEqual({ ok: true, from: "2026-11-22", to: "2026-11-22" }); // Sunday
  });
  it("from / to are checked and capped", () => {
    expect(resolveRange({ from: "2026-11-20", to: "2026-11-21" }, thu)).toEqual({ ok: true, from: "2026-11-20", to: "2026-11-21" });
    expect(resolveRange({ from: "2026-11-20" }, thu)).toEqual({ ok: true, from: "2026-11-20", to: "2026-11-20" });
    expect(resolveRange({ from: "11/20/2026" }, thu).ok).toBe(false);
    expect(resolveRange({ from: "2026-11-21", to: "2026-11-20" }, thu).ok).toBe(false);
    expect(resolveRange({ from: "2026-01-01", to: "2026-12-31" }, thu).ok).toBe(false);
    expect(resolveRange({ range: "forever" }, thu).ok).toBe(false);
  });
});

describe("get_open_slots explanations", () => {
  const s = readBookingSettings({ booking_hours: DEFAULT_BOOKING_HOURS, booking_min_notice_hours: 24, booking_slot_min: 120, booking_buffer_min: 30 });
  const now = { date: "2026-11-19", minutes: 9 * 60 }; // Thursday 9:00
  it("names the reason for every empty day", () => {
    const visits = [
      { date: "2026-11-23", start: null, label: "12 Elm St" },                    // Monday: untimed → whole day
      { date: "2026-11-24", start: "09:30", durationMin: 150 },                    // Tuesday morning
      { date: "2026-11-24", start: "13:30", durationMin: 270 },                    // Tuesday afternoon
    ];
    const days = explainDays(s, visits, now, "2026-11-19", "2026-11-25");
    const by = Object.fromEntries(days.map((d) => [d.date, d]));
    expect(by["2026-11-19"].reason).toBe("notice");          // today, inside 24 h
    expect(by["2026-11-20"].slots.length).toBeGreaterThan(0); // Friday after 9:00 notice
    expect(by["2026-11-21"]).toMatchObject({ reason: "closed", why: "no working hours set for Saturdays" });
    expect(by["2026-11-22"].reason).toBe("closed");
    expect(by["2026-11-23"].reason).toBe("all_day_visit");
    expect(by["2026-11-23"].why).toContain("12 Elm St");
    expect(by["2026-11-24"].reason).toBe("booked");
    expect(by["2026-11-25"].slots[0]).toBe("09:30");
    expect(days).toHaveLength(7);
  });
  it("a one-line headline, mentioning default hours when none were set", () => {
    const days = explainDays(s, [], now, "2026-11-21", "2026-11-22");
    expect(slotsHeadline(days, false)).toMatch(/^No open times\. Of 2 days: 2 closed \(no working hours\)\. Working hours were never set/);
    expect(slotsHeadline(explainDays(s, [], now, "2026-11-25", "2026-11-25"), true)).toMatch(/^\d+ open start times on 1 of 1 days\.$/);
  });
});

describe("update_job rules", () => {
  it("only accepted / scheduled / active / complete, never on billed jobs", () => {
    expect(checkStatusChange("scheduled", "complete")).toEqual({ ok: true, to: "complete" });
    expect(checkStatusChange("quoted", "Accepted")).toEqual({ ok: true, to: "accepted" });
    for (const bad of ["paid", "invoiced", "quoted", "lead", "deleted", ""]) expect(checkStatusChange("active", bad).ok).toBe(false);
    expect(checkStatusChange("invoiced", "complete").ok).toBe(false);
    expect(checkStatusChange("paid", "active").ok).toBe(false);
  });
  it("notes are appended with a stamp, never replaced", () => {
    expect(appendNote("Gate code 1234", "Customer asked for 2 pm", "Nov 19, 3:00 PM")).toBe("Gate code 1234\n[Nov 19, 3:00 PM · AI assistant] Customer asked for 2 pm");
    expect(appendNote(undefined, "First", "x")).toBe("[x · AI assistant] First");
  });
});

describe("shapes", () => {
  it("quote + invoice state", () => {
    expect(quoteState({ status: "lead" })).toBe("no_quote");
    expect(quoteState({ status: "quoted" })).toBe("not_sent");
    expect(quoteState({ status: "quoted", quote_sent_at: "2026-11-01" })).toBe("awaiting_approval");
    expect(quoteState({ status: "quoted", approved_at: "2026-11-02" })).toBe("approved");
    expect(invoiceState({ status: "invoiced", total: 500, amount_paid: 200 })).toEqual({ state: "partly_paid", total: 500, paid: 200, balance: 300 });
    expect(invoiceState({ status: "invoiced", total: 500 })).toMatchObject({ state: "unpaid", balance: 500 });
    expect(invoiceState({ status: "paid", total: 500 })).toMatchObject({ state: "paid", balance: 0 });
    expect(invoiceState({ status: "complete", total: 500 })).toMatchObject({ state: "not_invoiced", balance: 0 });
  });
  it("statuses and customer search", () => {
    expect(cleanStatuses("Quoted")).toEqual(["quoted"]);
    expect(cleanStatuses(["lead", "lead", "paid"])).toEqual(["lead", "paid"]);
    expect(cleanStatuses("bogus")).toBeNull();
    expect(cleanStatuses(undefined)).toEqual([]);
    const c = { name: "Dana Tenant", phone: "(316) 555-0101", email: "dana@x.com" };
    expect(customerHit(c, "dana")).toBe(true);
    expect(customerHit(c, "+1 316-555-0101")).toBe(true);
    expect(customerHit(c, "0101")).toBe(true);
    expect(customerHit(c, "lee")).toBe(false);
  });
  it("a visit shows time, crew, customer and the free note", () => {
    const v = visitOut({ id: 7, job: "12 Elm St", job_id: JOB, sched_date: "2026-11-24", note: "🕐 14:00 · 👷 Bo Diaz · bring ladder" },
      { id: JOB, client: "Ann Lee", status: "scheduled", requested_tech: "Cy" });
    expect(v).toMatchObject({ schedule_id: "7", weekday: "Tuesday", time: "14:00", time_label: "2:00 PM", crew: ["Bo Diaz", "Cy"], customer: "Ann Lee", note: "bring ladder", pending_booking_request: false });
    expect(visitOut({ id: 8, job: "1 Pine", sched_date: "2026-11-24" }).time_label).toBe("no set time (all day)");
  });
});

// ── Through the runner, on a fake Supabase ────────────────────────────────
function fakeDb(tables: Record<string, unknown[]>) {
  const writes: { table: string; op: string; row: unknown }[] = [];
  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    let head = false;
    for (const m of ["select", "eq", "in", "gte", "lte", "like", "is", "not", "limit", "order", "or", "neq"]) {
      b[m] = (...args: unknown[]) => { if (m === "select" && (args[1] as { head?: boolean })?.head) head = true; return b; };
    }
    b.insert = (row: unknown) => { writes.push({ table, op: "insert", row }); return b; };
    b.update = (row: unknown) => { writes.push({ table, op: "update", row }); return b; };
    b.delete = () => { writes.push({ table, op: "delete", row: null }); return b; };
    b.single = async () => ({ data: { id: "new-id" }, error: null });
    b.maybeSingle = async () => ({ data: (tables[table] || [])[0] ?? null, error: null });
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(head ? { count: 0, error: null } : { data: tables[table] || [], error: null }).then(res);
    return b;
  };
  return { db: { from } as unknown as AgentCtx["supabase"], writes };
}
const ctx = (db: AgentCtx["supabase"], scopes = [...AGENT_SCOPES]): AgentCtx => ({ supabase: db, orgId: "org1", keyId: "key1", scopes });
const nonLog = <T extends { table: string }>(w: T[]) => w.filter((x) => x.table !== "api_activity");

describe("tools through the runner", () => {
  beforeEach(() => resetMemoryLimits());

  it("every tool has a handler, a scope and an object schema; nothing pays, sends or deletes", async () => {
    for (const t of TOOLS) {
      expect(AGENT_SCOPES).toContain(t.scope);
      expect(t.inputSchema.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(60);
      const r = await runTool(ctx(fakeDb({}).db, []), t.name, {}, "rest");
      expect(!r.ok && r.status).toBe(403); // known tool, scope missing
    }
    expect(TOOLS.map((t) => t.name).some((n) => /pay|send|delete|refund|charge/.test(n))).toBe(false);
  });

  it("quote / invoice tools need billing:read", async () => {
    const f = fakeDb({});
    const r = await runTool(ctx(f.db, ["jobs:read", "customers:read"]), "list_invoices", {}, "mcp");
    expect(r).toEqual({ ok: false, status: 403, error: "this key lacks the billing:read scope" });
  });

  it("update_job refuses billing statuses and billed jobs, writes nothing", async () => {
    const f = fakeDb({ jobs: [{ id: JOB, status: "invoiced", archived: false, rooms: "{}" }] });
    const r1 = await runTool(ctx(f.db), "update_job", { job_id: JOB, status: "complete" }, "rest");
    expect(!r1.ok && r1.status).toBe(409);
    const r2 = await runTool(ctx(f.db), "update_job", { job_id: JOB, status: "paid" }, "rest");
    expect(!r2.ok && r2.status).toBe(409);
    expect(nonLog(f.writes)).toEqual([]);
  });

  it("update_job changes status (guarded on the old one) and appends a note", async () => {
    const f = fakeDb({ jobs: [{ id: JOB, status: "scheduled", archived: false, rooms: JSON.stringify({ jobNotes: "Gate 1234", workOrder: [{ detail: "x", done: true }] }) }], organizations: [{ booking_tz: "America/Chicago" }] });
    const r = await runTool(ctx(f.db), "update_job", { job_id: JOB, status: "active", note: "On site now" }, "mcp");
    if (!r.ok) throw new Error(r.error);
    expect(r.data).toMatchObject({ status: "active", changed: ["scheduled → active", "note added"] });
    const ups = nonLog(f.writes).filter((w) => w.op === "update").map((w) => w.row as Record<string, unknown>);
    expect(ups[0]).toEqual({ status: "active" });
    const blob = JSON.parse(String(ups[1].rooms));
    expect(blob.jobNotes).toMatch(/^Gate 1234\n\[.+ · AI assistant\] On site now$/);
    expect(blob.workOrder).toEqual([{ detail: "x", done: true }]); // the rest of the blob kept
    expect(f.writes.some((w) => w.op === "delete")).toBe(false);
    const log = f.writes.find((w) => w.table === "api_activity")!.row as Record<string, unknown>;
    expect(log).toMatchObject({ tool: "update_job", ok: true, job_id: JOB, via: "mcp" });
  });

  it("update_job needs a status or a note", async () => {
    const r = await runTool(ctx(fakeDb({}).db), "update_job", { job_id: JOB }, "rest");
    expect(!r.ok && r.status).toBe(400);
  });

  it("list_schedule returns visits with times, crew and customer", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
    const f = fakeDb({
      organizations: [{ booking_tz: "America/Chicago" }],
      schedule: [
        { id: 2, job: "12 Elm St", job_id: JOB, sched_date: today, note: "🕐 13:00 · 👷 Bo" },
        { id: 1, job: "9 Oak", job_id: null, sched_date: today, note: "🕐 08:00" },
      ],
      jobs: [{ id: JOB, client: "Ann Lee", status: "scheduled", property: "12 Elm St" }],
    });
    const r = await runTool(ctx(f.db), "list_schedule", { range: "today" }, "mcp");
    if (!r.ok) throw new Error(r.error);
    const v = r.data.visits as { time: string; customer: string; crew: string[] }[];
    expect(v.map((x) => x.time)).toEqual(["08:00", "13:00"]);
    expect(v[1]).toMatchObject({ customer: "Ann Lee", crew: ["Bo"] });
  });

  it("get_open_slots says why there are no times", async () => {
    const f = fakeDb({ organizations: [{ booking_hours: { "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] }, booking_tz: "America/Chicago" }], schedule: [] });
    const r = await runTool(ctx(f.db), "get_open_slots", { days_ahead: 3 }, "mcp");
    if (!r.ok) throw new Error(r.error);
    expect(String(r.data.summary)).toMatch(/^No open times\. Of 4 days: 4 closed \(no working hours\)\.$/);
    expect((r.data.days as { reason: string }[]).every((d) => d.reason === "closed")).toBe(true);
    expect(r.data.settings).toMatchObject({ working_hours_set_by_owner: true, working_hours: { Monday: "closed" } });
  });

  it("business_summary hides money without billing:read", async () => {
    const f = fakeDb({
      organizations: [{ booking_tz: "America/Chicago" }],
      schedule: [],
      jobs: [
        { id: JOB, status: "invoiced", total: 400, amount_paid: 100, client: "Ann" },
        { id: "22222222-2222-4333-8444-555555555555", status: "quoted", quote_sent_at: "2026-11-01", total: 900, client: "Bo" },
      ],
    });
    const withMoney = await runTool(ctx(f.db), "business_summary", {}, "rest");
    if (!withMoney.ok) throw new Error(withMoney.error);
    expect(withMoney.data.unpaid_invoices).toMatchObject({ count: 1, total_due: 300 });
    expect(withMoney.data.quotes_awaiting_approval).toMatchObject({ count: 1, total_value: 900 });
    const noMoney = await runTool(ctx(f.db, ["jobs:read"]), "business_summary", {}, "rest");
    if (!noMoney.ok) throw new Error(noMoney.error);
    expect(noMoney.data.unpaid_invoices).not.toHaveProperty("total_due");
    expect(noMoney.data.quotes_awaiting_approval).not.toHaveProperty("total_value");
  });

  it("get_job: checklist, notes, photo count, quote + invoice state", async () => {
    const f = fakeDb({
      jobs: [{ id: JOB, status: "invoiced", client: "Ann", property: "12 Elm", total: 500, amount_paid: 0, quote_sent_at: "2026-11-01", approved_at: "2026-11-02",
        rooms: JSON.stringify({ jobNotes: "Dog in yard", photos: [{ url: "a" }, { url: "b" }], workOrder: [{ room: "Kitchen", detail: "Fix faucet", done: true }, { room: "Bath", detail: "Caulk tub" }] }) }],
      schedule: [], customers: [],
    });
    const r = await runTool(ctx(f.db), "get_job", { job_id: JOB }, "rest");
    if (!r.ok) throw new Error(r.error);
    expect(r.data).toMatchObject({ checklist_done: "1 of 2", notes: "Dog in yard", photo_count: 2, quote: { state: "approved" }, invoice: { state: "unpaid", balance: 500 } });
  });
});
