jest.mock("@/lib/supabase", () => ({ db: {}, supabase: {} }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/api-auth", () => ({ serviceClient: jest.fn() }));
const dispatch = jest.fn(async () => ({ created: 1, texted: 0, pushed: 0, failures: 0 }));
jest.mock("@/lib/notify-server", () => ({ dispatchNotifications: (...a: unknown[]) => dispatch(...(a as [])) }));
const aiReply = {
  rooms: [{ name: "Plumbing", items: [{ detail: "Kitchen — Replace faucet cartridge", condition: "D", comment: "Leaking at base", laborHrs: 1.5, materials: [{ n: "Cartridge", c: 40 }] }] }],
  estDays: 1,
};
const callClaude = jest.fn(async (_b: unknown, _l: unknown) => ({ status: 200, data: { content: [{ type: "text", text: JSON.stringify(aiReply) }], stop_reason: "end_turn" } }));
jest.mock("@/lib/anthropic-server", () => ({ callClaude: (b: unknown, l: unknown) => callClaude(b, l) }));

import { draftLeadQuote } from "@/lib/lead-draft";

/** Minimal chainable fake of the supabase query builder. */
function fakeDb(state: { jobRooms: string; status?: string; draftsToday?: number }) {
  const updates: Record<string, unknown>[] = [];
  const from = (table: string) => {
    let op = "select";
    let payload: Record<string, unknown> = {};
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of ["select", "eq", "gte", "like", "limit", "in", "order"]) q[m] = chain;
    q.update = (p: Record<string, unknown>) => { op = "update"; payload = p; return q; };
    const result = () => {
      if (op === "update") { updates.push(payload); return { error: null }; }
      if (table === "organizations") return { data: { default_rate: 60, licensed_trades: null } };
      if (table === "jobs") return { data: { status: state.status || "lead", rooms: state.jobRooms }, count: state.draftsToday || 0 };
      if (table === "price_corrections") return { data: [] };
      if (table === "profiles") return { data: [{ id: "u1", role: "owner", status: "active" }] };
      return { data: null };
    };
    q.maybeSingle = async () => result();
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    return q;
  };
  return { client: { from } as never, updates };
}

const lead = { orgId: "o1", jobId: "j1", description: "Kitchen faucet leaking at the base", photos: ["https://x/p.jpg"], property: "1 Main St, Wichita, KS 67210", client: "Jane" };

beforeEach(() => { dispatch.mockClear(); callClaude.mockClear(); });

test("drafts, stores leadDraft on the lead and alerts the owner", async () => {
  const db = fakeDb({ jobRooms: JSON.stringify({ leadDescription: lead.description, leadPhotos: lead.photos }) });
  const r = await draftLeadQuote(db.client, lead);
  expect(r.ok).toBe(true);
  expect(callClaude).toHaveBeenCalledTimes(1);
  const blob = JSON.parse(db.updates[0].rooms as string);
  expect(blob.leadDescription).toBe(lead.description);
  expect(blob.leadDraft.rooms[0].items[0].detail).toMatch(/faucet/i);
  expect(blob.leadDraft.total).toBeGreaterThan(0);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect((dispatch.mock.calls[0] as unknown[])[1]).toMatchObject({ jobId: "j1", title: expect.stringMatching(/^Draft quote ready · \$/) });
});

test("leaves a lead alone once it moved on, and respects the daily cap", async () => {
  const moved = fakeDb({ jobRooms: "{}", status: "quoted" });
  expect((await draftLeadQuote(moved.client, lead)).ok).toBe(false);
  expect(moved.updates).toHaveLength(0);
  const capped = fakeDb({ jobRooms: "{}", draftsToday: 25 });
  expect(await draftLeadQuote(capped.client, lead)).toMatchObject({ ok: false, reason: "daily cap" });
  expect(callClaude).toHaveBeenCalledTimes(1); // only the "moved on" run reached the AI
});
