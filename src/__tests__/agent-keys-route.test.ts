/**
 * Ops → Settings → AI assistant connection, server side (/api/agent/keys):
 * create shows the key once and stores only its hash; Replace key revokes the
 * old key, issues a new one with the same name + scopes, and logs it; the
 * business always comes from the signed-in owner, never the request body.
 */
const writes: { table: string; op: string; row: Record<string, unknown>; filters: [string, unknown][] }[] = [];
let tables: Record<string, Record<string, unknown>[]> = {};
let headCount = 0;

function fakeDb() {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let head = false;
      let pending: { op: string; row: Record<string, unknown> } | null = null;
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "gte", "is", "limit", "order"]) {
        b[m] = (...a: unknown[]) => {
          if (m === "select" && (a[1] as { head?: boolean })?.head) head = true;
          if (m === "eq") filters.push([a[0] as string, a[1]]);
          return b;
        };
      }
      const flush = () => { if (pending) { writes.push({ table, ...pending, filters }); pending = null; } };
      b.insert = (row: Record<string, unknown>) => { pending = { op: "insert", row }; return b; };
      b.update = (row: Record<string, unknown>) => { pending = { op: "update", row }; return b; };
      b.single = async () => { const row = pending?.row; flush(); return { data: { id: "new-key-id", ...row }, error: null }; };
      b.maybeSingle = async () => {
        const want = filters.find(([c]) => c === "org_id")?.[1];
        const row = (tables[table] || []).find((r) => r.org_id === want && filters.every(([c, v]) => r[c] === undefined || r[c] === v));
        return { data: row ?? null, error: null };
      };
      b.then = (res: (v: unknown) => unknown) => { flush(); return Promise.resolve(head ? { count: headCount, error: null } : { data: tables[table] || [], error: null }).then(res); };
      return b;
    },
  };
}

jest.mock("@/lib/api-auth", () => ({
  requireOwner: async () => ({ userId: "u1", email: null, orgId: "org-A", role: "owner" }),
  serviceClient: () => fakeDb(),
}));
jest.mock("@/lib/notify-server", () => ({ dispatchNotifications: jest.fn(), resolveRecipients: jest.fn(async () => []) }));
jest.mock("@/lib/anthropic-server", () => ({ callClaude: jest.fn() }));
jest.mock("@/lib/supabase", () => ({ db: {}, supabase: {} }));

import { POST } from "@/app/api/agent/keys/route";
import { hashKey, looksLikeKey } from "@/lib/agent/keys";
import type { NextRequest } from "next/server";

const req = (body: unknown) => ({ json: async () => body, headers: new Headers() }) as unknown as NextRequest;
const OLD = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

beforeEach(() => {
  writes.length = 0;
  headCount = 0;
  tables = { api_keys: [{ id: OLD, org_id: "org-A", name: "Claude laptop", scopes: ["quotes:draft", "customers:read"], revoked_at: null }] };
});

it("create: shows the key once, stores only its hash, in the owner's business", async () => {
  const res = await POST(req({ name: "Zapier", scopes: ["schedule:read", "bogus"], org_id: "org-EVIL" }));
  const j = await res.json();
  expect(looksLikeKey(j.key)).toBe(true);
  const ins = writes.find((w) => w.table === "api_keys" && w.op === "insert")!.row;
  expect(ins).toMatchObject({ org_id: "org-A", name: "Zapier", scopes: ["schedule:read"], key_hash: hashKey(j.key) });
  expect(JSON.stringify(ins)).not.toContain(j.key);
  expect(writes.find((w) => w.table === "api_activity")!.row).toMatchObject({ tool: "key.create", org_id: "org-A", ok: true });
});

it("Replace key: revokes the old key, same name + scopes on the new one, logged", async () => {
  const res = await POST(req({ action: "replace", id: OLD }));
  const j = await res.json();
  expect(res.status).toBe(200);
  expect(looksLikeKey(j.key)).toBe(true);
  const ins = writes.find((w) => w.table === "api_keys" && w.op === "insert")!.row;
  expect(ins).toMatchObject({ org_id: "org-A", name: "Claude laptop", scopes: ["customers:read", "quotes:draft"], key_hash: hashKey(j.key) });
  const upd = writes.find((w) => w.table === "api_keys" && w.op === "update")!;
  expect(upd.row.revoked_at).toEqual(expect.any(String));
  expect(upd.row.replaced_by).toBe("new-key-id");
  expect(upd.filters).toEqual(expect.arrayContaining([["id", OLD], ["org_id", "org-A"]]));
  expect(writes.find((w) => w.table === "api_activity")!.row).toMatchObject({ tool: "key.replace", ok: true, via: "app" });
});

it("can't touch another business's key", async () => {
  tables.api_keys[0].org_id = "org-B";
  const res = await POST(req({ action: "replace", id: OLD }));
  expect(res.status).toBe(404);
  expect(writes.filter((w) => w.table === "api_keys")).toEqual([]);
});

it("revoke is logged and needs no new key", async () => {
  const res = await POST(req({ action: "revoke", id: OLD }));
  expect((await res.json()).ok).toBe(true);
  expect(writes.find((w) => w.op === "update")!.row.revoked_at).toEqual(expect.any(String));
  expect(writes.some((w) => w.table === "api_keys" && w.op === "insert")).toBe(false);
  expect(writes.find((w) => w.table === "api_activity")!.row).toMatchObject({ tool: "key.revoke" });
});

it("refuses a nameless key, no permissions, or too many keys", async () => {
  expect((await POST(req({ name: " ", scopes: ["customers:read"] }))).status).toBe(400);
  expect((await POST(req({ name: "x", scopes: [] }))).status).toBe(400);
  headCount = 10;
  expect((await POST(req({ name: "x", scopes: ["customers:read"] }))).status).toBe(400);
});
