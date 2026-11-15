import { clientIp, addressTag, memoryLimit, resetMemoryLimits, formVerdict, publicFormLimit, LEAD_LIMITS } from "@/lib/rate-limit";

const req = (h: Record<string, string>) => ({ headers: { get: (k: string) => h[k.toLowerCase()] ?? null } });

describe("clientIp / addressTag", () => {
  test("takes the first forwarded hop, then x-real-ip", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(req({ "x-vercel-forwarded-for": "192.0.2.9", "x-forwarded-for": "203.0.113.7" }))).toBe("192.0.2.9");
    expect(clientIp(req({}))).toBe("");
  });

  test("the tag is stable, one-way and never the address itself", () => {
    const a = addressTag("203.0.113.7");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(addressTag("203.0.113.7"));
    expect(a).not.toBe(addressTag("203.0.113.8"));
    expect(a).not.toContain("203");
    expect(addressTag("")).toBe("");
  });
});

describe("memoryLimit", () => {
  beforeEach(() => resetMemoryLimits());

  test("allows up to max in the window, then refuses until it slides", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(memoryLimit("k", 3, 60_000, t0 + i)).toBe(true);
    expect(memoryLimit("k", 3, 60_000, t0 + 10)).toBe(false);
    expect(memoryLimit("other", 3, 60_000, t0 + 10)).toBe(true); // keys are separate
    expect(memoryLimit("k", 3, 60_000, t0 + 60_001)).toBe(true); // the first hit aged out
  });
});

describe("formVerdict", () => {
  test("an address is stopped at its hourly or daily cap", () => {
    expect(formVerdict({ addressHour: 4, addressDay: 4, orgHour: 4 })).toEqual({ ok: true });
    expect(formVerdict({ addressHour: LEAD_LIMITS.perAddressHour, addressDay: 5, orgHour: 5 })).toEqual({ ok: false, why: "address" });
    expect(formVerdict({ addressHour: 0, addressDay: LEAD_LIMITS.perAddressDay, orgHour: 0 })).toEqual({ ok: false, why: "address" });
  });
  test("a flood from many addresses is stopped by the business cap", () => {
    expect(formVerdict({ addressHour: 1, addressDay: 1, orgHour: LEAD_LIMITS.perOrgHour })).toEqual({ ok: false, why: "org" });
  });
});

describe("publicFormLimit", () => {
  /** Fake `jobs` count: rows are { org, at, from }. */
  function fakeDb(rows: { org: string; at: number; from: string }[], fail = false) {
    const seen: string[] = [];
    const from = () => {
      const f: { org?: string; since?: number; like?: string } = {};
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (_c: string, v: string) => { f.org = v; return q; };
      q.gte = (_c: string, v: string) => { f.since = Date.parse(v); return q; };
      q.like = (_c: string, v: string) => { f.like = v; seen.push(v); return q; };
      q.then = (res: (v: unknown) => unknown) => {
        if (fail) return Promise.resolve({ count: null, error: { message: "boom" } }).then(res);
        const m = /"leadFrom":"([0-9a-f]*)/.exec(f.like || "");
        const tag = m ? m[1] : "";
        const n = rows.filter((r) => r.org === f.org && r.at >= (f.since || 0) && (tag ? r.from === tag : true)).length;
        return Promise.resolve({ count: n, error: null }).then(res);
      };
      return q;
    };
    return { client: { from } as never, seen };
  }
  const now = Date.parse("2026-11-14T18:00:00Z");
  const min = 60_000;

  test("the sixth lead from one address in an hour is refused; another address still gets through", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ org: "o1", at: now - (i + 1) * min, from: "aaaa" }));
    const db = fakeDb(rows);
    expect(await publicFormLimit(db.client, { orgId: "o1", tag: "aaaa", now })).toEqual({ ok: false, why: "address" });
    expect(await publicFormLimit(db.client, { orgId: "o1", tag: "bbbb", now })).toEqual({ ok: true });
    expect(await publicFormLimit(db.client, { orgId: "o2", tag: "aaaa", now })).toEqual({ ok: true }); // per business
  });

  test("older leads only count toward the day", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ org: "o1", at: now - (120 + i) * min, from: "aaaa" }));
    expect(await publicFormLimit(fakeDb(rows).client, { orgId: "o1", tag: "aaaa", now })).toEqual({ ok: true });
    const many = Array.from({ length: 15 }, (_, i) => ({ org: "o1", at: now - (120 + i * 30) * min, from: "aaaa" }));
    expect(await publicFormLimit(fakeDb(many).client, { orgId: "o1", tag: "aaaa", now })).toEqual({ ok: false, why: "address" });
  });

  test("many addresses at once hit the business cap", async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ org: "o1", at: now - (i % 50) * min, from: `a${i.toString(16).padStart(3, "0")}` }));
    expect(await publicFormLimit(fakeDb(rows).client, { orgId: "o1", tag: "ffff", now })).toEqual({ ok: false, why: "org" });
  });

  test("no address (local dev) skips the per-address check; a failed read lets the lead through", async () => {
    const rows = Array.from({ length: 9 }, () => ({ org: "o1", at: now - min, from: "" }));
    expect(await publicFormLimit(fakeDb(rows).client, { orgId: "o1", tag: "", now })).toEqual({ ok: true });
    expect(await publicFormLimit(fakeDb(rows, true).client, { orgId: "o1", tag: "aaaa", now })).toEqual({ ok: true });
  });
});
