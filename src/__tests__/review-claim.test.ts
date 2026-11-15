import { claimReviewRequest, failStaleClaims, CLAIM_STALE_MS } from "@/lib/review-claim";

type Row = { id: string; status: string; sent_at: string | null; error?: string };

/** Just enough of the query builder: update + eq / is / not / lt + select. */
function fakeDb(rows: Row[]) {
  const from = () => {
    let patch: Partial<Row> = {};
    const tests: ((r: Row) => boolean)[] = [];
    const q: Record<string, unknown> = {};
    q.update = (p: Partial<Row>) => { patch = p; return q; };
    q.eq = (c: keyof Row, v: unknown) => { tests.push((r) => r[c] === v); return q; };
    q.is = (c: keyof Row, v: unknown) => { tests.push((r) => r[c] === v); return q; };
    q.not = (c: keyof Row, _op: string, v: unknown) => { tests.push((r) => r[c] !== v); return q; };
    q.lt = (c: keyof Row, v: string) => { tests.push((r) => String(r[c]) < v); return q; };
    q.select = () => q;
    q.then = (res: (v: unknown) => unknown) => {
      const hit = rows.filter((r) => tests.every((t) => t(r)));
      hit.forEach((r) => Object.assign(r, patch));
      return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(res);
    };
    return q;
  };
  return { from } as never;
}

test("two overlapping runs: only the first claim wins, so one text goes out", async () => {
  const rows: Row[] = [{ id: "r1", status: "scheduled", sent_at: null }];
  const db = fakeDb(rows);
  expect(await claimReviewRequest(db, "r1", "2026-11-14T18:00:00.000Z")).toBe(true);
  expect(await claimReviewRequest(db, "r1", "2026-11-14T18:00:01.000Z")).toBe(false);
  expect(rows[0].sent_at).toBe("2026-11-14T18:00:00.000Z");
});

test("a request that was already sent, failed or cancelled can't be claimed", async () => {
  const rows: Row[] = [
    { id: "a", status: "sent", sent_at: "2026-11-14T17:00:00.000Z" },
    { id: "b", status: "cancelled", sent_at: null },
  ];
  const db = fakeDb(rows);
  expect(await claimReviewRequest(db, "a", "2026-11-14T18:00:00.000Z")).toBe(false);
  expect(await claimReviewRequest(db, "b", "2026-11-14T18:00:00.000Z")).toBe(false);
});

test("a claim left by a dead run is marked failed, never sent again; a fresh claim is left alone", async () => {
  const now = Date.parse("2026-11-14T18:00:00.000Z");
  const rows: Row[] = [
    { id: "old", status: "scheduled", sent_at: new Date(now - CLAIM_STALE_MS - 60_000).toISOString() },
    { id: "fresh", status: "scheduled", sent_at: new Date(now - 60_000).toISOString() },
    { id: "waiting", status: "scheduled", sent_at: null },
  ];
  expect(await failStaleClaims(fakeDb(rows), now)).toBe(1);
  expect(rows.map((r) => r.status)).toEqual(["failed", "scheduled", "scheduled"]);
  expect(rows[0].error).toMatch(/not retried/);
});
