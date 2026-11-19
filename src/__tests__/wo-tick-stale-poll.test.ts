/**
 * "Checked boxes come back unchecked" (2026-11-21). The 15s poll's job read
 * went out, the tech ticked a work-order item, the tick synced and left the
 * queue, THEN the poll's (older) answer landed: nothing was left to overlay,
 * so the store took the stale blob and the box flipped back. A synced tick now
 * keeps guarding any read that started before it synced.
 */
let server: { id: string; rooms: string } = { id: "job1", rooms: "" };
let delays: number[] = [];
const netDelay = () => (delays.length ? delays.shift()! : 1);
let active = 0, maxActive = 0;
const track = <T,>(p: Promise<T>) => { active++; maxActive = Math.max(maxActive, active); return p.finally(() => { active--; }); };
jest.mock("../lib/supabase", () => ({
  supabase: {
    from: () => {
      let patch: Record<string, unknown> | null = null;
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.update = (p: Record<string, unknown>) => { patch = p; return b; };
      b.eq = () => b;
      // Each request takes a moment, like the network: reads and writes from
      // different flushes can interleave unless something serializes them.
      b.then = (res: (v: unknown) => unknown) => {
        const p = patch;
        if (p) return track(new Promise((r) => setTimeout(r, netDelay())).then(() => { server = { ...server, ...(p as { rooms: string }) }; return { error: null }; })).then(res);
        const snap = { ...server };
        return track(new Promise((r) => setTimeout(r, netDelay())).then(() => ({ data: [snap], error: null }))).then(res);
      };
      return b;
    },
  },
}));

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

import { createSerializer } from "../lib/job-serial";
import { applyWoPending, enqueueWoToggle, flushWoQueue, tapsForRead, woKey, woPendingCount, SYNCED_KEEP_MS, type WoToggle } from "../lib/wo-queue";

const blob = (done: boolean) => JSON.stringify({
  jobNotes: "keep",
  workOrder: [
    { room: "Kitchen", detail: "Install range hood", done },
    { room: "Bath", detail: "Re-caulk tub", done: false },
  ],
});
const doneOf = (jobs: { rooms?: unknown }[]) => (JSON.parse(String(jobs[0].rooms)).workOrder as { done: boolean }[])[0].done;
const KEY = woKey({ room: "Kitchen", detail: "Install range hood" });

let now = 1_000_000;
beforeEach(() => {
  store.clear();
  server = { id: "job1", rooms: blob(false) };
  now = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => jest.restoreAllMocks());

it("a poll that started before the tick synced can't un-check it", async () => {
  // 1. The 15s poll sends its read: the box is still unchecked on the server.
  const pollStartedAt = Date.now();
  const staleRead = [{ ...server }];
  // 2. The tech ticks it; the tick is queued and synced.
  now += 300;
  enqueueWoToggle("job1", KEY, true);
  now += 400;
  await flushWoQueue("job1");
  expect(JSON.parse(server.rooms).workOrder[0].done).toBe(true);
  expect(JSON.parse(server.rooms).jobNotes).toBe("keep");
  expect(woPendingCount()).toBe(0); // nothing left to send
  // 3. The poll's old answer lands now. Before the fix: unchecked again.
  now += 200;
  expect(doneOf(applyWoPending(staleRead, pollStartedAt))).toBe(true);
});

it("a read started after the sync is trusted (another phone may have unticked it)", async () => {
  enqueueWoToggle("job1", KEY, true);
  await flushWoQueue("job1");
  now += 1000;
  const freshStartedAt = Date.now();
  server = { id: "job1", rooms: blob(false) }; // unticked elsewhere since
  expect(doneOf(applyWoPending([{ ...server }], freshStartedAt))).toBe(false);
});

it("unsynced taps always overlay; synced ones expire", async () => {
  enqueueWoToggle("job1", KEY, true);
  expect(doneOf(applyWoPending([{ id: "job1", rooms: blob(false) }], Date.now() + 99_999))).toBe(true);
  await flushWoQueue("job1");
  const syncedAt = Date.now();
  now += SYNCED_KEEP_MS + 1;
  expect(doneOf(applyWoPending([{ id: "job1", rooms: blob(false) }], syncedAt - 1))).toBe(false);
});

it("a tap made while a flush's request is in flight stays queued, then wins", async () => {
  delays = [5, 5];
  enqueueWoToggle("job1", KEY, true);
  const p = flushWoQueue("job1");
  await new Promise((r) => setTimeout(r, 2)); // the flush's read is on the wire
  enqueueWoToggle("job1", KEY, false); // un-ticked again before the write landed
  await p;
  expect(woPendingCount()).toBe(1);
  await flushWoQueue("job1");
  expect(JSON.parse(server.rooms).workOrder[0].done).toBe(false);
  expect(woPendingCount()).toBe(0);
});

it("tapsForRead picks the right taps", () => {
  const q: WoToggle[] = [
    { qid: "a", jobId: "j", key: "k1", done: true, ts: 1 },
    { qid: "b", jobId: "j", key: "k2", done: true, ts: 1, syncedAt: 500 },
    { qid: "c", jobId: "other", key: "k1", done: true, ts: 1 },
  ];
  expect(tapsForRead(q, "j", 400).map((x) => x.qid)).toEqual(["a", "b"]);
  expect(tapsForRead(q, "j", 600).map((x) => x.qid)).toEqual(["a"]);
  expect(tapsForRead(q, "j").map((x) => x.qid)).toEqual(["a", "b"]);
});

it("four quick taps + the 15s poll's own flush: every box stays checked on the server", async () => {
  const four = (d: boolean[]) => JSON.stringify({ workOrder: ["Hood", "Drywall", "Caulk", "Outlet"].map((detail, i) => ({ room: "Kitchen", detail, done: d[i] })) });
  server = { id: "job1", rooms: four([false, false, false, false]) };
  delays = [5, 1, 3, 1, 7, 1, 2, 4, 1, 6, 2, 1, 3, 1];
  const flushes: Promise<number>[] = [];
  for (const detail of ["Hood", "Drywall", "Caulk", "Outlet"]) {
    enqueueWoToggle("job1", woKey({ room: "Kitchen", detail }), true);
    flushes.push(flushWoQueue("job1")); // the tap's own sync
    if (detail === "Drywall") flushes.push(flushWoQueue()); // the poll's flush lands mid-burst
  }
  await Promise.all(flushes);
  expect((JSON.parse(server.rooms).workOrder as { done: boolean }[]).map((w) => w.done)).toEqual([true, true, true, true]);
  expect(woPendingCount()).toBe(0);
});

describe("job write queue (job-serial)", () => {
  it("runs one job's writes in order and says when a poll's read may be stale", async () => {
    let t = 100;
    const s = createSerializer(() => t);
    const order: string[] = [];
    let release!: () => void;
    const slow = s.runSerialized("j", () => new Promise<void>((r) => { release = () => { order.push("first"); r(); }; }));
    const second = s.runSerialized("j", async () => { order.push("second"); });
    expect(s.blobWrittenSince("j", 50)).toBe(true); // queued / in flight
    expect(s.blobWrittenSince("other", 50)).toBe(false);
    await new Promise((r) => setTimeout(r, 0)); // the first task has started
    t = 200;
    release();
    await Promise.all([slow, second]);
    expect(order).toEqual(["first", "second"]);
    expect(s.blobWrittenSince("j", 150)).toBe(true);  // poll sent at 150, write done at 200: keep the screen's copy
    expect(s.blobWrittenSince("j", 250)).toBe(false); // poll sent after: trust it
  });
});

it("a slow flush can't write back an older checklist over a newer tick (lost update)", async () => {
  maxActive = 0;
  const three = JSON.stringify({ workOrder: ["A", "B", "C"].map((detail) => ({ room: "Kitchen", detail, done: false })) });
  server = { id: "job1", rooms: three };
  // Request order under the old code: X read, X write, then the tap's flush
  // (Y) and the poll's flush (Z) both read; Y's write is slow, Z's is fast.
  delays = [1, 1, 1, 1, 30, 1, 1, 1];
  const k = (d: string) => woKey({ room: "Kitchen", detail: d });
  enqueueWoToggle("job1", k("A"), true);
  const x = flushWoQueue("job1");
  enqueueWoToggle("job1", k("B"), true);
  const y = flushWoQueue("job1");
  const z = flushWoQueue(); // the 15s poll
  await new Promise((r) => setTimeout(r, 10));
  enqueueWoToggle("job1", k("C"), true); // third tap while Y's write is still on the wire
  const w = flushWoQueue("job1");
  await Promise.all([x, y, z, w]);
  await flushWoQueue("job1");
  expect((JSON.parse(server.rooms).workOrder as { done: boolean }[]).map((t) => t.done)).toEqual([true, true, true]);
  // The rule that makes it safe: one read-merge-write at a time. The old code
  // let the tap's flush and the poll's flush read the blob together, so the
  // slower write could put back a checklist missing the newer tick.
  expect(maxActive).toBe(1);
});
