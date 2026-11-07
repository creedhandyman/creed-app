import {
  CHECKOUT_TTL_SEC,
  checkoutCancelUrl,
  checkoutExpiresAt,
  expireOpenJobSessions,
  type CheckoutSessionsApi,
  type OpenSession,
} from "@/lib/checkout-sessions";

const JOB = "job-1";

function fakeApi(pages: OpenSession[][], opts: { failExpire?: string[]; failList?: boolean } = {}) {
  const listCalls: Parameters<CheckoutSessionsApi["list"]>[0][] = [];
  const expired: string[] = [];
  let i = 0;
  const api: CheckoutSessionsApi = {
    async list(params) {
      listCalls.push(params);
      if (opts.failList) throw new Error("stripe down");
      const data = pages[i] ?? [];
      i++;
      return { data, has_more: i < pages.length };
    },
    async expire(id) {
      if (opts.failExpire?.includes(id)) throw new Error("already complete");
      expired.push(id);
      return {};
    },
  };
  return { api, listCalls, expired };
}

test("expires only this job's open sessions, across pages", async () => {
  const now = Date.UTC(2026, 10, 7, 2, 0, 0);
  const { api, listCalls, expired } = fakeApi([
    [{ id: "cs_a", metadata: { job_id: JOB } }, { id: "cs_b", metadata: { job_id: "other" } }],
    [{ id: "cs_c", metadata: { job_id: JOB } }, { id: "cs_sub", metadata: null }],
  ]);
  const out = await expireOpenJobSessions(api, JOB, now);
  expect(out).toEqual(["cs_a", "cs_c"]);
  expect(expired).toEqual(["cs_a", "cs_c"]);
  // Open sessions only, looking back past the old 24 h lifetime, paging on.
  expect(listCalls[0]).toMatchObject({ status: "open", limit: 100, created: { gte: now / 1000 - 25 * 3600 } });
  expect(listCalls[1]).toMatchObject({ starting_after: "cs_b" });
});

test("a session that can't be expired (already paid) is skipped; a list failure never throws", async () => {
  const a = fakeApi([[{ id: "cs_done", metadata: { job_id: JOB } }, { id: "cs_open", metadata: { job_id: JOB } }]], { failExpire: ["cs_done"] });
  expect(await expireOpenJobSessions(a.api, JOB)).toEqual(["cs_open"]);

  const err = jest.spyOn(console, "error").mockImplementation(() => {});
  const b = fakeApi([], { failList: true });
  await expect(expireOpenJobSessions(b.api, JOB)).resolves.toEqual([]);
  err.mockRestore();
});

test("sessions live one hour", () => {
  expect(CHECKOUT_TTL_SEC).toBe(3600);
  expect(checkoutExpiresAt(1_000_000_000_000)).toBe(1_000_000_000 + 3600);
});

test("cancel goes back to the job page, never back into /pay", () => {
  const o = "https://www.creedhm.com";
  expect(checkoutCancelUrl(o, `${o}/status?job=1&t=x`)).toBe(`${o}/status?job=1&t=x`);
  expect(checkoutCancelUrl(o, `${o}/pay?job=1&t=x`)).toBe(`${o}/status?job=1&t=x`);
  expect(checkoutCancelUrl(o, "")).toBe(`${o}/payment/cancel`);
  expect(checkoutCancelUrl(o, "https://evil.example/status?job=1")).toBe(`${o}/payment/cancel`);
});
