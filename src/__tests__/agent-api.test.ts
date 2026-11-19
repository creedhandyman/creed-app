/**
 * Agent API (2026-11-20): keys, the customer matcher, the work-order and
 * schedule rules, the draft PDF link, the MCP handler and the shared runner
 * (scope → rate limit → tool → activity log), with a fake Supabase.
 */
jest.mock("@/lib/supabase", () => ({ db: {}, supabase: {} }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/api-auth", () => ({ serviceClient: () => { throw new Error("no db in tests"); } }));
jest.mock("@/lib/notify-server", () => ({ dispatchNotifications: jest.fn(), resolveRecipients: jest.fn(async () => []) }));
jest.mock("@/lib/anthropic-server", () => ({ callClaude: jest.fn() }));

import { newKey, hashKey, looksLikeKey, cleanKeyName } from "@/lib/agent/keys";
import { cleanScopes, AGENT_SCOPES } from "@/lib/agent/scopes";
import { phoneKey, emailKey, matchCustomers, sameCustomer } from "@/lib/agent/customer-match";
import { checkWorkOrder, checkSchedule, cleanPhotoLinks, cleanTime, scheduleNote, scheduleRows, MAX_SCHEDULE_DAYS } from "@/lib/agent/plan";
import { draftPdfQuery, verifyDraftPdf } from "@/lib/agent/draft-link";
import { handleRpc } from "@/lib/agent/mcp";
import { runTool, TOOLS, bearerKey, type AgentCtx } from "@/lib/agent/server";
import { draftSummary, draftTotals } from "@/lib/lead-draft";
import { parseSchedTime, parseSchedCrew } from "@/lib/day-plan";
import { resetMemoryLimits } from "@/lib/rate-limit";
import type { Room } from "@/lib/types";

process.env.PORTAL_SESSION_SECRET = "test-secret";
const JOB = "11111111-2222-4333-8444-555555555555";

describe("keys", () => {
  it("makes a creed_sk_ key, stores only its hash and a short prefix", () => {
    const k = newKey();
    expect(looksLikeKey(k.key)).toBe(true);
    expect(k.hash).toBe(hashKey(k.key));
    expect(k.hash).not.toContain(k.key);
    expect(k.key.startsWith(k.prefix)).toBe(true);
    expect(k.prefix.length).toBeLessThan(20);
    expect(newKey().key).not.toBe(k.key);
  });
  it("rejects anything that isn't one of our keys before a DB read", () => {
    expect(looksLikeKey("creed_sk_short")).toBe(false);
    expect(looksLikeKey("Bearer x")).toBe(false);
  });
  it("keeps known scopes only, in order, no duplicates", () => {
    expect(cleanScopes(["schedule:write", "payments:write", "customers:read", "schedule:write"])).toEqual(["customers:read", "schedule:write"]);
    expect(cleanScopes("customers:read")).toEqual([]);
    expect(AGENT_SCOPES.some((s) => /pay|delete|send|bulk/.test(s))).toBe(false);
  });
  it("names are one trimmed line", () => {
    expect(cleanKeyName("  Claude \n laptop ")).toBe("Claude laptop");
    expect(cleanKeyName(5)).toBe("");
  });
  it("reads the key from Bearer or x-api-key", () => {
    const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
    expect(bearerKey(h({ authorization: "Bearer creed_sk_abc" }))).toBe("creed_sk_abc");
    expect(bearerKey(h({ "x-api-key": " creed_sk_abc " }))).toBe("creed_sk_abc");
  });
});

describe("customer matcher", () => {
  const people = [
    { id: "a", name: "Dana Tenant", phone: "(316) 555-0101", email: "Dana@Example.com" },
    { id: "b", name: "Lee Owner", phone: "+1 316.555.0199", email: "" },
    { id: "c", name: "dana tenant", phone: "", email: "other@x.com" },
  ];
  it("normalizes phones and emails", () => {
    expect(phoneKey("+1 (316) 555-0101")).toBe("3165550101");
    expect(phoneKey("555-0101")).toBe("");
    expect(emailKey("  DANA@example.COM ")).toBe("dana@example.com");
    expect(emailKey("not an email")).toBe("");
  });
  it("the same tenant in three formats is one customer", () => {
    for (const q of [{ phone: "316-555-0101" }, { phone: "13165550101" }, { email: "dana@example.com" }]) {
      expect(sameCustomer(people, q)?.id).toBe("a");
    }
  });
  it("phone beats email; name only when nothing else matched", () => {
    const m = matchCustomers(people, { phone: "3165550199", email: "dana@example.com" });
    expect(m.map((x) => [x.customer.id, x.by])).toEqual([["b", "phone"], ["a", "email"]]);
    expect(matchCustomers(people, { name: "Dana  Tenant" }).map((x) => x.customer.id)).toEqual(["a", "c"]);
  });
  it("a name alone never counts as the same customer for a new work order", () => {
    expect(sameCustomer(people, { name: "Dana Tenant" })).toBeNull();
  });
});

describe("work order rules", () => {
  const base = { source: "AppFolio", external_id: "WO-77", description: "Leaky faucet in unit 4", customer_name: "Dana" };
  it("accepts the four sources, case-insensitive", () => {
    for (const s of ["appfolio", "Angi", "BUILDIUM", "email"]) expect(checkWorkOrder({ ...base, source: s }).ok).toBe(true);
    expect(checkWorkOrder({ ...base, source: "zillow" }).ok).toBe(false);
  });
  it("needs a description and someone to reach", () => {
    expect(checkWorkOrder({ ...base, description: " " }).ok).toBe(false);
    expect(checkWorkOrder({ source: "email", description: "x" }).ok).toBe(false);
  });
  it("photo links: https only, no internal hosts, max 12", () => {
    expect(cleanPhotoLinks(["https://a.com/1.jpg", "http://a.com/2.jpg", "https://localhost/x.jpg", "https://10.0.0.1/y.jpg", "javascript:alert(1)", "https://a.com/1.jpg"]))
      .toEqual(["https://a.com/1.jpg"]);
    expect(cleanPhotoLinks(Array.from({ length: 20 }, (_, i) => `https://a.com/${i}.jpg`))).toHaveLength(12);
    const r = checkWorkOrder({ ...base, photo_urls: ["https://cdn.appfolio.com/p.jpg"] });
    expect(r.ok && r.value.photos).toEqual(["https://cdn.appfolio.com/p.jpg"]);
  });
});

describe("schedule rules", () => {
  const crew = ["Bernard Reed", "Sam Tech"];
  it("start_date + days → consecutive days", () => {
    const r = checkSchedule({ job_id: JOB, start_date: "2026-12-30", days: 3, time: "9:00 am", crew: ["sam tech"] }, crew);
    expect(r.ok && r.value).toEqual({ jobId: JOB, dates: ["2026-12-30", "2026-12-31", "2027-01-01"], time: "09:00", crew: ["Sam Tech"], note: "" });
  });
  it("explicit dates are de-duplicated and sorted", () => {
    const r = checkSchedule({ job_id: JOB, dates: ["2026-12-05", "2026-12-01", "2026-12-05"] }, crew);
    expect(r.ok && r.value.dates).toEqual(["2026-12-01", "2026-12-05"]);
  });
  it("refuses bad input instead of guessing", () => {
    expect(checkSchedule({ job_id: "123 Main St", start_date: "2026-12-01" }, crew).ok).toBe(false); // by id, never address text
    expect(checkSchedule({ job_id: JOB, start_date: "2026-02-30" }, crew).ok).toBe(false);
    expect(checkSchedule({ job_id: JOB, start_date: "2026-12-01", days: MAX_SCHEDULE_DAYS + 1 }, crew).ok).toBe(false);
    expect(checkSchedule({ job_id: JOB, start_date: "2026-12-01", time: "lunch" }, crew).ok).toBe(false);
    const r = checkSchedule({ job_id: JOB, start_date: "2026-12-01", crew: ["Nobody"] }, crew);
    expect(!r.ok && r.error).toMatch(/unknown crew/);
  });
  it("times", () => {
    expect(cleanTime("2:30pm")).toBe("14:30");
    expect(cleanTime("12:00 am")).toBe("00:00");
    expect(cleanTime("25:00")).toBe("");
  });
  it("writes the note the app reads back, one row per day tied by job id", () => {
    const r = checkSchedule({ job_id: JOB, start_date: "2026-12-01", days: 2, time: "08:30", crew: ["Bernard Reed", "Sam Tech"], note: "Gate code 1234 · back door" }, crew);
    if (!r.ok) throw new Error(r.error);
    const note = scheduleNote(r.value);
    expect(parseSchedTime(note)).toBe("08:30");
    expect(parseSchedCrew(note)).toEqual(["Bernard Reed", "Sam Tech"]);
    const rows = scheduleRows(r.value, "12 Elm St", "org1");
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.job_id === JOB && x.org_id === "org1" && x.note === note)).toBe(true);
  });
});

describe("draft PDF link", () => {
  it("verifies only for its job, untampered, before expiry", () => {
    const now = Date.UTC(2026, 10, 20);
    const q = new URLSearchParams(draftPdfQuery(JOB, now));
    expect(verifyDraftPdf(JOB, q.get("exp"), q.get("sig"), now)).toBe(true);
    expect(verifyDraftPdf(JOB.replace("1", "9"), q.get("exp"), q.get("sig"), now)).toBe(false);
    expect(verifyDraftPdf(JOB, String(Number(q.get("exp")) + 1), q.get("sig"), now)).toBe(false);
    expect(verifyDraftPdf(JOB, q.get("exp"), q.get("sig"), now + 8 * 86400_000)).toBe(false);
  });
});

describe("draft summary", () => {
  const line = (id: string, detail: string, hrs: number, mat: number, tiers?: string[]) => ({
    id, detail, comment: "", condition: "P", laborHrs: hrs, materials: mat ? [{ n: "m", qty: 1, unitPrice: mat, c: mat }] : [], ...(tiers ? { tiers } : {}),
  });
  const rooms = [{ name: "Plumbing", items: [line("1", "Replace faucet", 1, 80), line("2", "New shutoff valves", 1, 30, ["better", "best"])] }] as unknown as Room[];
  const org = { default_rate: 60, min_labor_hours: 0 };
  it("lists each line's price and offers options only when they change the scope", () => {
    const s = draftSummary(rooms, org, "12 Elm St, Wichita, KS 67202");
    expect(s.lines.map((l) => [l.detail, l.price])).toEqual([["Replace faucet", 140], ["New shutoff valves", 90]]);
    expect(s.tiers.map((t) => [t.key, t.total])).toEqual([["base", 140], ["better", 230]]);
    expect(draftTotals(rooms, org, "").total).toBe(230);
  });
  it("one option when the business turned tiers off", () => {
    expect(draftSummary(rooms, { ...org, tiered_quotes_default: false }, "").tiers).toEqual([]);
  });
  it("the minimum charge applies to every option", () => {
    const s = draftSummary(rooms, { default_rate: 60, min_labor_hours: 3 }, "");
    expect(s.tiers[0].total).toBe(260); // 3h × $60 + $80 materials
  });
});

// ── Fake Supabase: every chain resolves to what `tables` says; writes recorded.
function fakeDb(tables: Record<string, unknown[]>, count = 0) {
  const writes: { table: string; op: string; row: unknown }[] = [];
  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    let head = false;
    const chain = ["select", "eq", "in", "gte", "lte", "like", "is", "limit", "order", "or"];
    for (const m of chain) b[m] = (...args: unknown[]) => { if (m === "select" && (args[1] as { head?: boolean })?.head) head = true; return b; };
    b.insert = (row: unknown) => { writes.push({ table, op: "insert", row }); return b; };
    b.update = (row: unknown) => { writes.push({ table, op: "update", row }); return b; };
    b.single = async () => ({ data: { id: "new-id" }, error: null });
    b.maybeSingle = async () => ({ data: (tables[table] || [])[0] ?? null, error: null });
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(head ? { count, error: null } : { data: tables[table] || [], error: null }).then(res);
    return b;
  };
  return { db: { from } as unknown as AgentCtx["supabase"], writes };
}
const ctx = (db: AgentCtx["supabase"], scopes = [...AGENT_SCOPES]): AgentCtx => ({ supabase: db, orgId: "org1", keyId: "key1", scopes });

describe("shared runner", () => {
  beforeEach(() => resetMemoryLimits());
  it("refuses a tool outside the key's scopes and logs it", async () => {
    const f = fakeDb({});
    const r = await runTool(ctx(f.db, ["customers:read"]), "schedule_job", { job_id: JOB }, "rest");
    expect(r).toEqual({ ok: false, status: 403, error: "this key lacks the schedule:write scope" });
    const log = f.writes.find((w) => w.table === "api_activity")?.row as Record<string, unknown>;
    expect(log).toMatchObject({ org_id: "org1", key_id: "key1", tool: "schedule_job", ok: false, status: 403, via: "rest" });
  });
  it("find_customer matches across formats inside the key's business", async () => {
    const f = fakeDb({ customers: [{ id: "a", name: "Dana", phone: "316.555.0101", email: "" }], addresses: [{ customer_id: "a", street: "12 Elm", city: "Wichita" }] });
    const r = await runTool(ctx(f.db), "find_customer", { phone: "+1 (316) 555-0101" }, "mcp");
    expect(r.ok && r.data.matches).toEqual([{ customer_id: "a", name: "Dana", phone: "316.555.0101", email: "", matched_by: "phone", addresses: ["12 Elm, Wichita"] }]);
    expect(f.writes.some((w) => w.table === "api_activity" && (w.row as { ok: boolean }).ok)).toBe(true);
  });
  it("hourly limit (counted in the activity log)", async () => {
    const f = fakeDb({}, 600);
    const r = await runTool(ctx(f.db), "find_customer", { phone: "3165550101" }, "rest");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(429);
  });
  it("per-minute burst limit", async () => {
    const f = fakeDb({ customers: [] });
    let last;
    for (let i = 0; i < 31; i++) last = await runTool(ctx(f.db), "find_customer", { phone: "3165550101" }, "rest");
    expect(last && !last.ok && last.status).toBe(429);
  });
  it("add_work_order with a known source + id returns the existing lead", async () => {
    const f = fakeDb({ jobs: [{ id: JOB, status: "lead", customer_id: "a" }] });
    const r = await runTool(ctx(f.db), "add_work_order", { source: "angi", external_id: "A-1", description: "Fix door", phone: "3165550101" }, "rest");
    expect(r.ok && r.data).toEqual({ job_id: JOB, customer_id: "a", status: "lead", created: false });
    expect(f.writes.filter((w) => w.table !== "api_activity")).toEqual([]);
  });
  it("draft_quote only drafts leads", async () => {
    const f = fakeDb({ jobs: [{ id: JOB, status: "scheduled", rooms: "{}", property: "", client: "" }] });
    const r = await runTool(ctx(f.db), "draft_quote", { job_id: JOB }, "rest");
    expect(!r.ok && r.status).toBe(409);
  });
  it("draft_quote stops at 25 AI drafts a day", async () => {
    const f = fakeDb({ jobs: [{ id: JOB, status: "lead", rooms: JSON.stringify({ leadDescription: "Fix the fence" }), property: "", client: "" }] }, 25);
    // count=25 also trips nothing else: the hourly limit is 600.
    const r = await runTool(ctx(f.db), "draft_quote", { job_id: JOB }, "rest");
    expect(!r.ok && r.error).toMatch(/25 AI drafts/);
  });
  it("draft_quote returns an existing draft without a second AI run", async () => {
    const rooms = [{ name: "Carpentry", items: [{ id: "1", detail: "Rehang door", comment: "", condition: "P", laborHrs: 1, materials: [] }] }];
    const f = fakeDb({
      jobs: [{ id: JOB, status: "lead", rooms: JSON.stringify({ leadDraft: { rooms, estDays: 1 } }), property: "", client: "", source: "angi" }],
      organizations: [{ default_rate: 70, min_labor_hours: 1, flat_pricing: true }],
    });
    const r = await runTool(ctx(f.db), "draft_quote", { job_id: JOB }, "rest");
    if (!r.ok) throw new Error(r.error);
    expect(r.data).toMatchObject({ status: "draft", total: 70, hours: 1, flat_pricing: true, lines: [{ detail: "Rehang door", price: 70 }] });
    expect((r.data.lines as object[])[0]).not.toHaveProperty("hours"); // flat: no hours per line
    expect(String(r.data.quote_link)).toMatch(new RegExp(`/\\?job=${JOB}$`));
    expect(String(r.data.pdf_link)).toMatch(/\/api\/agent\/draft-pdf\?job=.+&exp=\d+&sig=[0-9a-f]+$/);
  });
});

describe("MCP", () => {
  const call = jest.fn(async (name: string) => (name === "find_customer" ? { ok: true as const, data: { matches: [] } } : { ok: false as const, status: 403, error: "nope" }));
  it("initialize negotiates a version and names the server", async () => {
    const r = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, [], call);
    expect(r).toMatchObject({ id: 1, result: { protocolVersion: "2025-03-26", serverInfo: { name: "creed" }, capabilities: { tools: {} } } });
    const r2 = await handleRpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, [], call);
    expect((r2 as { result: { protocolVersion: string } }).result.protocolVersion).toBe("2025-06-18");
  });
  it("lists only the tools this key's scopes allow", async () => {
    const r = await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }, ["customers:read", "schedule:read"], call);
    expect((r as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name)).toEqual(["find_customer", "get_open_slots"]);
    expect(TOOLS).toHaveLength(5);
  });
  it("tools/call: results as text + structured content; tool errors as isError", async () => {
    const ok = await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "find_customer", arguments: { phone: "1" } } }, [], call);
    expect(ok).toMatchObject({ result: { isError: false, structuredContent: { matches: [] } } });
    const bad = await handleRpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "schedule_job" } }, [], call);
    expect(bad).toMatchObject({ result: { isError: true, content: [{ type: "text", text: "nope" }] } });
    const unknown = await handleRpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "delete_everything" } }, [], call);
    expect(unknown).toMatchObject({ error: { code: -32602 } });
  });
  it("notifications get no reply; unknown methods and junk get errors", async () => {
    expect(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, [], call)).toBeNull();
    expect(await handleRpc({ jsonrpc: "2.0", id: 7, method: "resources/list" }, [], call)).toMatchObject({ error: { code: -32601 } });
    expect(await handleRpc({ id: 8 } as never, [], call)).toMatchObject({ error: { code: -32600 } });
  });
});

describe("draft PDF page (server render)", () => {
  it("builds the quote HTML without a browser", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { jobQuotePdfHtml } = require("@/lib/quote-pdf");
    const rooms = [{ name: "Carpentry", items: [{ id: "1", detail: "Rehang closet door", comment: "", condition: "P", laborHrs: 1, materials: [] }] }];
    const html: string = jobQuotePdfHtml({ id: JOB, property: "12 Elm St", client: "Dana", rooms: JSON.stringify({ rooms }), total: 70, total_labor: 70, total_mat: 0, total_hrs: 1 }, { name: "Creed", default_rate: 70 });
    expect(html).toContain("<body>");
    expect(html).toContain("Rehang closet door");
  });
});
