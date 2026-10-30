import { createBlobWriter, addPhoto, SKIP, type BlobRemote, type BlobLocal } from "../lib/job-write";

/** In-memory server + screen copy, with latency and failure injection. */
function world(initial: Record<string, string | null>) {
  const server = new Map<string, string | null>(Object.entries(initial));
  const screen = new Map<string, Record<string, unknown>>();
  const log: string[] = [];
  const f = { failWrite: false, failRead: false, beforeRead: undefined as undefined | (() => void) };
  const tick = () => new Promise((r) => setTimeout(r, 2));
  const remote: BlobRemote = {
    async read(id) {
      await tick();
      f.beforeRead?.();
      if (f.failRead) throw new Error("net");
      return server.has(id) ? { rooms: server.get(id) } : null;
    },
    async write(id, rooms) {
      await tick();
      log.push(`write ${id}`);
      if (f.failWrite) { f.failWrite = false; return false; }
      server.set(id, rooms);
      return true;
    },
  };
  const local: BlobLocal = {
    get: (id) => screen.get(id) ?? null,
    merge: (id, d) => { screen.set(id, { ...(screen.get(id) ?? {}), ...d }); },
  };
  const blob = (id: string) => JSON.parse(server.get(id) as string);
  return { server, screen, log, f, remote, local, blob };
}

describe("patchBlob", () => {
  it("updates the screen copy synchronously, before the network", async () => {
    const w = world({ j1: JSON.stringify({ a: 1 }) });
    const { patchBlob } = createBlobWriter(w.remote, w.local);
    const p = patchBlob("j1", { jobNumber: "42" });
    expect(w.screen.get("j1")).toEqual({ jobNumber: "42" }); // instant
    expect(w.log).toEqual([]); // nothing written yet
    expect(await p).toEqual({ ok: true, changed: true });
    expect(w.blob("j1")).toEqual({ a: 1, jobNumber: "42" });
  });

  it("merges onto the SERVER blob, so keys the server set survive a stale screen copy", async () => {
    const w = world({ j1: JSON.stringify({ rooms: [1], approval: { by: "customer" } }) });
    w.screen.set("j1", { rooms: [1] }); // the stale store has no approval
    const { patchBlob } = createBlobWriter(w.remote, w.local);
    await patchBlob("j1", { jobNotes: "hi" });
    expect(w.blob("j1")).toEqual({ rooms: [1], approval: { by: "customer" }, jobNotes: "hi" });
  });

  it("serializes concurrent callers — no lost updates", async () => {
    const w = world({ j1: JSON.stringify({ n: 0 }) });
    const { patchBlob } = createBlobWriter(w.remote, w.local);
    const bump = (b: Record<string, unknown>) => ({ n: ((b.n as number) || 0) + 1 });
    const results = await Promise.all(Array.from({ length: 6 }, () => patchBlob("j1", bump)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(w.blob("j1").n).toBe(6);
  });

  it("applies calls in the order they were made", async () => {
    const w = world({ j1: JSON.stringify({}) });
    const { patchBlob } = createBlobWriter(w.remote, w.local);
    await Promise.all([patchBlob("j1", { v: "first" }), patchBlob("j1", { v: "second" }), patchBlob("j1", { v: "third" })]);
    expect(w.blob("j1").v).toBe("third");
  });

  it("writes nothing when the values already match, or the change skips", async () => {
    const w = world({ j1: JSON.stringify({ jobNumber: "42" }) });
    const { patchBlob } = createBlobWriter(w.remote, w.local);
    expect(await patchBlob("j1", { jobNumber: "42" })).toEqual({ ok: true, changed: false });
    expect(await patchBlob("j1", () => SKIP)).toEqual({ ok: true, changed: false });
    expect(w.log).toEqual([]);
  });

  it("refuses to overwrite a blob it can't read, and treats an empty one as {}", async () => {
    const w = world({ bad: "{not json", empty: "", nul: null });
    const { patchBlob } = createBlobWriter(w.remote, w.local);
    expect(await patchBlob("bad", { a: 1 })).toEqual({ ok: false, reason: "unreadable" });
    expect(w.server.get("bad")).toBe("{not json");
    expect(await patchBlob("empty", { a: 1 })).toEqual({ ok: true, changed: true });
    expect(await patchBlob("nul", { a: 1 })).toEqual({ ok: true, changed: true });
    expect(w.blob("empty")).toEqual({ a: 1 });
  });

  it("reports a missing job, a refused write and a network failure — and keeps going", async () => {
    const w = world({ j1: JSON.stringify({}) });
    const { patchBlob } = createBlobWriter(w.remote, w.local);
    expect(await patchBlob("nope", { a: 1 })).toEqual({ ok: false, reason: "no-job" });
    w.f.failWrite = true;
    expect(await patchBlob("j1", { a: 1 })).toEqual({ ok: false, reason: "rejected" });
    w.f.failRead = true;
    expect(await patchBlob("j1", { a: 2 })).toEqual({ ok: false, reason: "network" });
    w.f.failRead = false;
    expect(await patchBlob("j1", { a: 3 })).toEqual({ ok: true, changed: true }); // queue still alive
    expect(w.blob("j1")).toEqual({ a: 3 });
  });

  it("a failed write leaves the optimistic value on screen (the poll reconciles it)", async () => {
    const w = world({ j1: JSON.stringify({ a: 1 }) });
    const { patchBlob } = createBlobWriter(w.remote, w.local);
    w.f.failWrite = true;
    await patchBlob("j1", { a: 2 });
    expect(w.screen.get("j1")).toEqual({ a: 2 });
    expect(w.blob("j1")).toEqual({ a: 1 });
  });

  it("a change that throws is reported, never thrown", async () => {
    const w = world({ j1: JSON.stringify({}) });
    const { patchBlob } = createBlobWriter(w.remote, w.local);
    const r = await patchBlob("j1", () => { throw new Error("bug"); });
    expect(r).toEqual({ ok: false, reason: "rejected" });
    expect(w.log).toEqual([]);
  });

  it("works with no screen copy at all", async () => {
    const w = world({ j1: JSON.stringify({}) });
    const { patchBlob } = createBlobWriter(w.remote);
    expect(await patchBlob("j1", { a: 1 })).toEqual({ ok: true, changed: true });
  });
});

describe("addPhoto", () => {
  it("appends once — a retried replay can't duplicate", async () => {
    const w = world({ j1: JSON.stringify({ photos: [{ url: "u0", type: "before" }] }) });
    const { patchBlob } = createBlobWriter(w.remote, w.local);
    const photo = { url: "u1", label: "", type: "work" };
    expect(await patchBlob("j1", addPhoto(photo))).toEqual({ ok: true, changed: true });
    expect(await patchBlob("j1", addPhoto(photo))).toEqual({ ok: true, changed: false });
    expect(w.blob("j1").photos).toEqual([{ url: "u0", type: "before" }, photo]);
  });

  it("starts the list when there is none", async () => {
    const w = world({ j1: JSON.stringify({ rooms: [] }) });
    const { patchBlob } = createBlobWriter(w.remote, w.local);
    await patchBlob("j1", addPhoto({ url: "u1" }));
    expect(w.blob("j1").photos).toEqual([{ url: "u1" }]);
  });
});

describe("runSerialized / settled", () => {
  it("another read-merge-write waits its turn behind queued patches", async () => {
    const w = world({ j1: JSON.stringify({}) });
    const { patchBlob, runSerialized } = createBlobWriter(w.remote, w.local);
    const order: string[] = [];
    const p1 = patchBlob("j1", { a: 1 }).then(() => order.push("patch"));
    const p2 = runSerialized("j1", async () => { order.push("task-start"); });
    await Promise.all([p1, p2]);
    expect(order).toEqual(["patch", "task-start"]);
  });

  it("a failing task doesn't block the next one", async () => {
    const w = world({ j1: JSON.stringify({}) });
    const { patchBlob, runSerialized } = createBlobWriter(w.remote, w.local);
    await expect(runSerialized("j1", async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(await patchBlob("j1", { a: 1 })).toEqual({ ok: true, changed: true });
  });

  it("settled resolves once everything queued so far is written", async () => {
    const w = world({ j1: JSON.stringify({}) });
    const { patchBlob, settled } = createBlobWriter(w.remote, w.local);
    void patchBlob("j1", { a: 1 });
    void patchBlob("j1", { b: 2 });
    await settled("j1");
    expect(w.blob("j1")).toEqual({ a: 1, b: 2 });
    await settled("never-written"); // nothing queued: resolves immediately
  });

  it("different jobs don't wait on each other", async () => {
    const w = world({ j1: JSON.stringify({}), j2: JSON.stringify({}) });
    const { patchBlob } = createBlobWriter(w.remote, w.local);
    await Promise.all([patchBlob("j1", { a: 1 }), patchBlob("j2", { b: 2 })]);
    expect(w.blob("j1")).toEqual({ a: 1 });
    expect(w.blob("j2")).toEqual({ b: 2 });
  });
});
