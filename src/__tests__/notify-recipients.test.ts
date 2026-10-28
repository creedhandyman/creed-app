import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveRecipients } from "@/lib/notify-server";

type Row = Record<string, unknown>;

/** Minimal fake of `from("profiles").select(cols).eq("org_id", x)` that
 *  records what was asked and filters rows by org like Postgres would. */
function fakeSupabase(rows: Row[], error: { message: string } | null = null) {
  const calls: { table: string; cols: string; eq: [string, unknown][] }[] = [];
  const client = {
    from(table: string) {
      const call = { table, cols: "", eq: [] as [string, unknown][] };
      calls.push(call);
      const q = {
        select(cols: string) { call.cols = cols; return q; },
        eq(col: string, val: unknown) { call.eq.push([col, val]); return q; },
        then(resolve: (v: { data: Row[] | null; error: typeof error }) => unknown) {
          const data = error ? null : rows.filter((r) => call.eq.every(([c, v]) => r[c] === v));
          return Promise.resolve({ data, error }).then(resolve);
        },
      };
      return q;
    },
  };
  return { supabase: client as unknown as SupabaseClient, calls };
}

const ORG = "org-1";
const rows: Row[] = [
  { id: "own", org_id: ORG, name: "Bernard", role: "owner", status: "active", phone: "316-555-0100", notify_sms: true, notify_leads: false, notify_assigned: true },
  { id: "mgr", org_id: ORG, name: "Mia", role: "manager", status: null, phone: null, notify_sms: null, notify_leads: null, notify_assigned: false },
  { id: "mgr-pending", org_id: ORG, name: "Pat", role: "manager", status: "pending", phone: "1", notify_sms: true },
  { id: "tech", org_id: ORG, name: " Jordan Lee ", role: "tech", status: "active", phone: "3165550101", notify_sms: false, notify_assigned: undefined, notify_leads: true },
  { id: "tech-pending", org_id: ORG, name: "Sam", role: "tech", status: "pending" },
  { id: "nameless", org_id: ORG, name: null, role: "tech", status: "active" },
  { id: "other-org-mgr", org_id: "org-2", name: "Jordan Lee", role: "owner", status: "active" },
];

describe("resolveRecipients", () => {
  test("managers = active owners + managers of the org only; no event column → opted in", async () => {
    const { supabase, calls } = fakeSupabase(rows);
    const r = await resolveRecipients(supabase, ORG, { managers: true, event: "none" });
    expect(r.map((x) => x.id)).toEqual(["own", "mgr"]);
    expect(r.every((x) => x.eventOptIn === null)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("profiles");
    expect(calls[0].eq).toEqual([["org_id", ORG]]);
    expect(calls[0].cols).not.toMatch(/notify_leads|notify_assigned/);
  });

  test("leads event maps notify_leads to eventOptIn; null stays null (= opted in)", async () => {
    const { supabase, calls } = fakeSupabase(rows);
    const r = await resolveRecipients(supabase, ORG, { managers: true, ids: ["tech"], event: "leads" });
    expect(calls[0].cols).toMatch(/notify_leads/);
    expect(r).toEqual([
      { id: "own", name: "Bernard", phone: "316-555-0100", notify_sms: true, eventOptIn: false },
      { id: "mgr", name: "Mia", phone: null, notify_sms: null, eventOptIn: null },
      { id: "tech", name: " Jordan Lee ", phone: "3165550101", notify_sms: false, eventOptIn: true },
    ]);
  });

  test("a referrer who is also a manager is listed once", async () => {
    const { supabase } = fakeSupabase(rows);
    const r = await resolveRecipients(supabase, ORG, { managers: true, ids: ["own", "own"], event: "leads" });
    expect(r.map((x) => x.id)).toEqual(["own", "mgr"]);
  });

  test("ids are org-scoped and skip pending members", async () => {
    const { supabase } = fakeSupabase(rows);
    const r = await resolveRecipients(supabase, ORG, { ids: ["other-org-mgr", "tech-pending", "tech"], event: "assigned" });
    expect(r.map((x) => x.id)).toEqual(["tech"]);
    expect(r[0].eventOptIn).toBeNull(); // undefined pref → null → opted in
  });

  test("names match trimmed + case-insensitive, never nameless or pending profiles", async () => {
    const { supabase } = fakeSupabase(rows);
    const r = await resolveRecipients(supabase, ORG, { names: ["jordan lee", "SAM", "", "Mia "], event: "assigned" });
    expect(r.map((x) => x.id)).toEqual(["mgr", "tech"]);
    expect(r.find((x) => x.id === "mgr")!.eventOptIn).toBe(false);
  });

  test("empty audience or org makes no query", async () => {
    const { supabase, calls } = fakeSupabase(rows);
    expect(await resolveRecipients(supabase, ORG, { ids: [], names: [""], event: "leads" })).toEqual([]);
    expect(await resolveRecipients(supabase, "", { managers: true, event: "none" })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test("a query error throws with its message", async () => {
    const { supabase } = fakeSupabase(rows, { message: "boom" });
    await expect(resolveRecipients(supabase, ORG, { managers: true, event: "none" })).rejects.toThrow("boom");
  });
});
