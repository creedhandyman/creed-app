import {
  autoTextConsent, customerSmsConsentOf, nextCustomerSmsConsent, residentSmsConsentOf, residentTextConsent,
  CONSENT_HISTORY_MAX, type SmsConsentEntry,
} from "@/lib/sms-consent";
import { recipientConsent } from "@/lib/sms-recipient";
import { loadCustomersWithConsent, recordCustomerSmsConsent, stampConsentFromReply } from "@/lib/sms-consent-server";
import type { SupabaseClient } from "@supabase/supabase-js";

const yes = (at: string, extra: Partial<SmsConsentEntry> = {}): SmsConsentEntry => ({ granted: true, at, source: "recorded by owner", ...extra });
const no = (at: string, extra: Partial<SmsConsentEntry> = {}): SmsConsentEntry => ({ granted: false, at, source: "turned off by owner", ...extra });
const jobWith = (c: SmsConsentEntry | null, more: Record<string, unknown> = {}) =>
  JSON.stringify({ ...(c ? { smsConsent: c } : {}), ...more });

describe("customerSmsConsentOf", () => {
  it("reads an object or a JSON string, ignores junk", () => {
    expect(customerSmsConsentOf(yes("2026-11-01T00:00:00Z"))?.granted).toBe(true);
    expect(customerSmsConsentOf(JSON.stringify(no("2026-11-01T00:00:00Z")))?.granted).toBe(false);
    expect(customerSmsConsentOf(null)).toBeNull();
    expect(customerSmsConsentOf("not json")).toBeNull();
    expect(customerSmsConsentOf({ granted: "yes" })).toBeNull();
    expect(customerSmsConsentOf([yes("x")])).toBeNull();
  });
  it("drops an unknown method and keeps the last 10 phone digits", () => {
    const c = customerSmsConsentOf({ ...yes("2026-11-01T00:00:00Z"), method: "carrier pigeon", phone: "+1 (316) 555-0100" });
    expect(c?.method).toBeUndefined();
    expect(c?.phone).toBe("3165550100");
  });
});

describe("nextCustomerSmsConsent", () => {
  it("a form yes always records; a form no only when nothing is on file", () => {
    expect(nextCustomerSmsConsent(null, { ...no("2026-11-01T00:00:00Z"), source: "website quote form" }, "form")?.granted).toBe(false);
    expect(nextCustomerSmsConsent(yes("2026-11-01T00:00:00Z"), { ...no("2026-11-02T00:00:00Z"), source: "quote approval page" }, "form")).toBeNull();
    expect(nextCustomerSmsConsent(no("2026-11-01T00:00:00Z"), { ...yes("2026-11-02T00:00:00Z"), source: "quote approval page" }, "form")?.granted).toBe(true);
  });
  it("an explicit answer always records and keeps the old one in history, newest first", () => {
    const first = nextCustomerSmsConsent(null, yes("2026-11-01T00:00:00Z", { method: "in_person", by: "Bernard" }), "set")!;
    const second = nextCustomerSmsConsent(first, no("2026-11-02T00:00:00Z"), "set")!;
    const third = nextCustomerSmsConsent(second, yes("2026-11-03T00:00:00Z", { source: "replied START" }), "set")!;
    expect(third.granted).toBe(true);
    expect(third.history?.map((h) => h.at)).toEqual(["2026-11-02T00:00:00Z", "2026-11-01T00:00:00Z"]);
    expect(third.history?.[1]).toMatchObject({ method: "in_person", by: "Bernard" });
    expect((third.history?.[0] as { history?: unknown }).history).toBeUndefined();
  });
  it("caps the history", () => {
    let c: unknown = null;
    for (let i = 0; i < CONSENT_HISTORY_MAX + 5; i++) c = nextCustomerSmsConsent(c, yes(new Date(Date.UTC(2026, 0, i + 1)).toISOString()), "set");
    expect(customerSmsConsentOf(c)?.history?.length).toBe(CONSENT_HISTORY_MAX);
  });
});

describe("autoTextConsent — the one rule every automatic text asks", () => {
  it("nothing on file = no", () => {
    const r = autoTextConsent({ phone: "3165550100" }, jobWith(null));
    expect(r.ok).toBe(false);
    expect(r.via).toBeNull();
  });
  it("a yes on the customer covers every job", () => {
    expect(autoTextConsent({ sms_consent: yes("2026-11-01T00:00:00Z"), phone: "316-555-0100" }, jobWith(null))).toMatchObject({ ok: true, via: "customer" });
  });
  it("a yes on the job still counts when the customer row has nothing (older data / before the migration)", () => {
    expect(autoTextConsent({ phone: "3165550100" }, jobWith(yes("2026-11-01T00:00:00Z", { source: "website quote form" })))).toMatchObject({ ok: true, via: "job" });
    expect(autoTextConsent(undefined, jobWith(yes("2026-11-01T00:00:00Z")))).toMatchObject({ ok: true });
  });
  it("the newest answer wins between the customer row and the job", () => {
    const offLater = { sms_consent: no("2026-11-05T00:00:00Z"), phone: "3165550100" };
    expect(autoTextConsent(offLater, jobWith(yes("2026-11-01T00:00:00Z"))).ok).toBe(false);
    const offEarlier = { sms_consent: no("2026-11-01T00:00:00Z"), phone: "3165550100" };
    expect(autoTextConsent(offEarlier, jobWith(yes("2026-11-05T00:00:00Z")))).toMatchObject({ ok: true, via: "job" });
  });
  it("an unchecked box on a job never revokes", () => {
    const c = { sms_consent: yes("2026-11-01T00:00:00Z"), phone: "3165550100" };
    expect(autoTextConsent(c, jobWith(no("2026-11-09T00:00:00Z", { source: "quote approval page" }))).ok).toBe(true);
  });
  it("an answer for a different number doesn't count", () => {
    const moved = { sms_consent: yes("2026-11-01T00:00:00Z", { phone: "3165550100" }), phone: "3165559999" };
    expect(autoTextConsent(moved).ok).toBe(false);
    const same = { sms_consent: yes("2026-11-01T00:00:00Z", { phone: "3165550100" }), phone: "+1 316 555 0100" };
    expect(autoTextConsent(same).ok).toBe(true);
  });
  it("turned off on the customer reads as off, with a reason", () => {
    const r = autoTextConsent({ sms_consent: no("2026-11-01T00:00:00Z"), phone: "3165550100" });
    expect(r).toMatchObject({ ok: false, via: "customer" });
    expect(r.reason).toMatch(/turned off/i);
  });
});

describe("resident consent", () => {
  const rooms = (c: SmsConsentEntry | null) => JSON.stringify({ residentPhone: "316-555-0177", ...(c ? { residentSmsConsent: c } : {}) });
  it("needs the resident's own yes, for that number", () => {
    expect(residentTextConsent(rooms(null), "3165550177")).toBe(false);
    expect(residentTextConsent(rooms(yes("2026-11-01T00:00:00Z", { phone: "3165550177" })), "316-555-0177")).toBe(true);
    expect(residentTextConsent(rooms(yes("2026-11-01T00:00:00Z", { phone: "3165550177" })), "3165550188")).toBe(false);
    expect(residentTextConsent(rooms(no("2026-11-01T00:00:00Z", { phone: "3165550177" })), "3165550177")).toBe(false);
    expect(residentSmsConsentOf("garbage")).toBeNull();
  });
});

describe("recipientConsent", () => {
  const pmCustomer = { type: "property_manager", phone: "3165550100", sms_consent: yes("2026-11-01T00:00:00Z") };
  it("a resident is never covered by the customer's yes", () => {
    const r = recipientConsent("resident", "3165550177", { rooms: jobWith(yes("2026-11-01T00:00:00Z")) }, pmCustomer);
    expect(r.ok).toBe(false);
  });
  it("a resident with their own yes is OK", () => {
    const rooms = JSON.stringify({ residentSmsConsent: yes("2026-11-01T00:00:00Z", { phone: "3165550177" }) });
    expect(recipientConsent("resident", "+13165550177", { rooms }, undefined).ok).toBe(true);
  });
  it("the customer / property manager uses the customer rule", () => {
    expect(recipientConsent("property_manager", "3165550100", { rooms: "{}" }, pmCustomer).ok).toBe(true);
    const r = recipientConsent("customer", "3165550100", { rooms: "{}" }, { phone: "3165550100" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/customer page/);
  });
});

/* ---- server helpers against a tiny fake Supabase ---- */

type Row = Record<string, unknown>;
function fakeSupabase(tables: Record<string, Row[]>, opts: { noConsentColumn?: boolean; phoneMatches?: string[] } = {}) {
  const updates: { table: string; values: Row; filters: [string, unknown][] }[] = [];
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    let cols = "*";
    let ins: [string, unknown[]] | null = null;
    let pendingUpdate: Row | null = null;
    const rows = () => (tables[table] || []).filter((r) =>
      filters.every(([k, v]) => r[k] === v) && (!ins || ins[1].includes(r[ins[0]])));
    const result = () => {
      if (opts.noConsentColumn && cols.includes("sms_consent")) return { data: null, error: { message: "column customers.sms_consent does not exist" } };
      if (pendingUpdate) {
        updates.push({ table, values: pendingUpdate, filters: [...filters] });
        for (const r of rows()) Object.assign(r, pendingUpdate);
        return { data: null, error: null };
      }
      return { data: rows().map((r) => ({ ...r })), error: null };
    };
    const q: Record<string, unknown> = {
      select(c: string) { cols = c; return q; },
      update(v: Row) { pendingUpdate = v; return q; },
      eq(k: string, v: unknown) { filters.push([k, v]); return q; },
      in(k: string, v: unknown[]) { ins = [k, v]; return q; },
      maybeSingle() { const r = result(); return Promise.resolve({ data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }); },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(result()).then(res, rej); },
    };
    return q;
  };
  const rpc = (_fn: string, _args: unknown) => Promise.resolve({ data: (opts.phoneMatches || []).map((id) => ({ id })), error: null });
  return { client: { from, rpc } as unknown as SupabaseClient, updates, tables };
}

describe("loadCustomersWithConsent", () => {
  it("returns sms_consent when the column exists", async () => {
    const { client } = fakeSupabase({ customers: [{ id: "c1", name: "A", phone: "1", sms_consent: yes("2026-11-01T00:00:00Z") }] });
    const m = await loadCustomersWithConsent<{ id: string }>(client, ["c1"], "id, name, phone");
    expect(m.get("c1")?.sms_consent).toBeTruthy();
  });
  it("falls back to the old columns before the migration runs", async () => {
    const { client } = fakeSupabase({ customers: [{ id: "c1", name: "A", phone: "1" }] }, { noConsentColumn: true });
    const m = await loadCustomersWithConsent<{ id: string; name: string }>(client, ["c1"], "id, name, phone");
    expect(m.get("c1")?.name).toBe("A");
  });
  it("no ids, no query", async () => {
    const { client } = fakeSupabase({});
    expect((await loadCustomersWithConsent(client, [], "id")).size).toBe(0);
  });
});

describe("recordCustomerSmsConsent", () => {
  it("writes a form yes onto the customer with the number it covers", async () => {
    const f = fakeSupabase({ customers: [{ id: "c1", org_id: "o1", phone: "(316) 555-0100", sms_consent: null }] });
    const ok = await recordCustomerSmsConsent(f.client, "c1", "o1", { granted: true, at: "2026-11-12T00:00:00Z", source: "quote approval page", jobId: "j1" }, "form");
    expect(ok).toBe(true);
    expect(f.tables.customers[0].sms_consent).toMatchObject({ granted: true, source: "quote approval page", jobId: "j1", phone: "3165550100" });
  });
  it("an unchecked box doesn't overwrite an answer on file", async () => {
    const f = fakeSupabase({ customers: [{ id: "c1", org_id: "o1", phone: "3165550100", sms_consent: yes("2026-11-01T00:00:00Z") }] });
    const ok = await recordCustomerSmsConsent(f.client, "c1", "o1", { granted: false, at: "2026-11-12T00:00:00Z", source: "website quote form" }, "form");
    expect(ok).toBe(false);
    expect(f.updates).toHaveLength(0);
  });
  it("stays inside the org", async () => {
    const f = fakeSupabase({ customers: [{ id: "c1", org_id: "o1", phone: "3165550100" }] });
    expect(await recordCustomerSmsConsent(f.client, "c1", "other-org", yes("2026-11-12T00:00:00Z"), "set")).toBe(false);
  });
  it("never throws when the column is missing", async () => {
    const f = fakeSupabase({ customers: [{ id: "c1", org_id: "o1" }] }, { noConsentColumn: true });
    await expect(recordCustomerSmsConsent(f.client, "c1", "o1", yes("2026-11-12T00:00:00Z"), "set")).resolves.toBe(false);
  });
});

describe("stampConsentFromReply", () => {
  it("STOP turns every matching customer off", async () => {
    const f = fakeSupabase({ customers: [
      { id: "c1", org_id: "o1", sms_consent: yes("2026-11-01T00:00:00Z") },
      { id: "c2", org_id: "o2", sms_consent: null },
    ] }, { phoneMatches: ["c1", "c2"] });
    expect(await stampConsentFromReply(f.client, "+13165550100", "stop")).toBe(2);
    expect(f.tables.customers.map((c) => (c.sms_consent as SmsConsentEntry).source)).toEqual(["replied STOP", "replied STOP"]);
    expect(customerSmsConsentOf(f.tables.customers[0].sms_consent)?.history?.[0].granted).toBe(true);
  });
  it("START only restores customers whose answer is that STOP", async () => {
    const f = fakeSupabase({ customers: [
      { id: "c1", org_id: "o1", sms_consent: no("2026-11-01T00:00:00Z", { source: "replied STOP" }) },
      { id: "c2", org_id: "o1", sms_consent: no("2026-11-01T00:00:00Z") },
      { id: "c3", org_id: "o1", sms_consent: null },
    ] }, { phoneMatches: ["c1", "c2", "c3"] });
    expect(await stampConsentFromReply(f.client, "3165550100", "start")).toBe(1);
    expect((f.tables.customers[0].sms_consent as SmsConsentEntry).granted).toBe(true);
    expect((f.tables.customers[1].sms_consent as SmsConsentEntry).granted).toBe(false);
    expect(f.tables.customers[2].sms_consent).toBeNull();
  });
});
