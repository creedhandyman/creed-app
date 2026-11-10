import { bellThreadPhone, canAssign, canSeeThread, rowsToAssign, checkReply, crewJobIds, MAX_REPLY, previewOf, replyRole, summarizeThreads, type TextRow } from "../lib/sms-threads";

const row = (over: Partial<TextRow>): TextRow => ({
  id: Math.random().toString(36).slice(2),
  direction: "in",
  contact_phone: "+13165550142",
  job_id: null,
  customer_id: null,
  match_status: null,
  recipient_role: null,
  kind: "reply",
  body: "hi",
  status: "received",
  error: null,
  media: null,
  read_at: null,
  created_at: "2026-11-10T10:00:00Z",
  ...over,
});

describe("summarizeThreads", () => {
  it("one row per phone, newest conversation first", () => {
    const out = summarizeThreads([
      row({ contact_phone: "+13165550001", created_at: "2026-11-10T09:00:00Z" }),
      row({ contact_phone: "+13165550002", created_at: "2026-11-10T11:00:00Z" }),
      row({ contact_phone: "+13165550001", created_at: "2026-11-10T12:00:00Z", direction: "out", body: "On my way", status: "delivered" }),
    ]);
    expect(out.map((t) => t.phone)).toEqual(["+13165550001", "+13165550002"]);
    expect(out[0]).toMatchObject({ lastDirection: "out", preview: "On my way", count: 2, unread: 1 });
  });

  it("counts only unread received texts and keeps the newest job", () => {
    const [t] = summarizeThreads([
      row({ job_id: "old", created_at: "2026-11-01T00:00:00Z", read_at: "2026-11-01T01:00:00Z" }),
      row({ job_id: "new", created_at: "2026-11-09T00:00:00Z" }),
      row({ created_at: "2026-11-10T00:00:00Z" }),
      row({ direction: "out", created_at: "2026-11-08T00:00:00Z", job_id: "old" }),
    ]);
    expect(t.unread).toBe(2);
    expect(t.jobId).toBe("new");
    expect(t.jobIds).toEqual(["new", "old"]);
  });

  it("skips rows with no contact number (sent before the migration)", () => {
    expect(summarizeThreads([row({ contact_phone: null })])).toEqual([]);
  });

  it("lists every customer the conversation touches", () => {
    const [t] = summarizeThreads([
      row({ customer_id: "c1", created_at: "2026-11-01T00:00:00Z" }),
      row({ customer_id: "c2", created_at: "2026-11-02T00:00:00Z" }),
      row({ customer_id: "c1", created_at: "2026-11-03T00:00:00Z" }),
    ]);
    expect(t.customerIds).toEqual(["c1", "c2"]);
  });

  it("match comes from the newest received text", () => {
    const [t] = summarizeThreads([
      row({ match_status: "unknown", created_at: "2026-11-01T00:00:00Z" }),
      row({ match_status: "several", created_at: "2026-11-02T00:00:00Z" }),
      row({ direction: "out", created_at: "2026-11-03T00:00:00Z" }),
    ]);
    expect(t.match).toBe("several");
  });
});

describe("previewOf", () => {
  it("words first, then photos", () => {
    expect(previewOf({ body: "  Tuesday\n works ", media: null, status: "", kind: "" })).toBe("Tuesday works");
    expect(previewOf({ body: "", media: [{ url: "a" }], status: "", kind: "" })).toBe("Photo");
    expect(previewOf({ body: "", media: [{ url: "a" }, { url: "b" }], status: "", kind: "" })).toBe("2 photos");
  });
});

describe("replyRole", () => {
  it("follows the last text we sent", () => {
    expect(replyRole([
      row({ direction: "out", recipient_role: "resident", created_at: "2026-11-02T00:00:00Z" }),
      row({ direction: "out", recipient_role: "customer", created_at: "2026-11-01T00:00:00Z" }),
    ])).toBe("resident");
  });
  it("else a resident match, else customer", () => {
    expect(replyRole([row({ match_status: "resident" })])).toBe("resident");
    expect(replyRole([row({ match_status: "unknown" })])).toBe("customer");
  });
});

describe("crew visibility", () => {
  const jobs = crewJobIds(
    " sam lee ",
    [
      { job_id: "j1", note: "9:00 AM · 👷 Sam Lee, Pat" },
      { job_id: "j2", note: "👷 Pat" },
      { job_id: null, note: "👷 Sam Lee" },
    ],
    [{ id: "j3", requested_tech: "Sam Lee" }, { id: "j4", requested_tech: "Pat" }],
  );

  it("their schedule rows and requested-tech jobs, any case", () => {
    expect([...jobs].sort()).toEqual(["j1", "j3"]);
    expect(crewJobIds("", [{ job_id: "j1", note: "👷 Sam" }], []).size).toBe(0);
  });

  it("crew see conversations on their jobs; owners and managers see all", () => {
    expect(canSeeThread("tech", ["j2", "j1"], jobs)).toBe(true);
    expect(canSeeThread("tech", ["j2"], jobs)).toBe(false);
    expect(canSeeThread("apprentice", [], jobs)).toBe(false);
    expect(canSeeThread("owner", [], jobs)).toBe(true);
    expect(canSeeThread("manager", ["j2"], new Set())).toBe(true);
  });
});

describe("checkReply", () => {
  it("needs words and refuses (never cuts) a long one", () => {
    expect(checkReply("  ")).toMatchObject({ ok: false });
    expect(checkReply(42)).toMatchObject({ ok: false });
    expect(checkReply(" Tuesday works ")).toEqual({ ok: true, text: "Tuesday works" });
    expect(checkReply("x".repeat(MAX_REPLY + 1))).toMatchObject({ ok: false });
  });
});

describe("bellThreadPhone", () => {
  const rows = [
    row({ contact_phone: "+1mgr", job_id: "j1", created_at: "2026-11-10T10:00:00Z" }),
    row({ contact_phone: "+1res", job_id: "j1", created_at: "2026-11-10T10:05:00Z" }),
    row({ contact_phone: "+1res", job_id: "j1", direction: "out", created_at: "2026-11-10T10:20:00Z" }),
    row({ contact_phone: "+1other", job_id: "j2", created_at: "2026-11-10T10:01:00Z" }),
  ];

  it("the number that texted on that job just before the alert", () => {
    expect(bellThreadPhone(rows, "j1", "2026-11-10T10:00:01Z")).toBe("+1mgr");
    expect(bellThreadPhone(rows, "j1", "2026-11-10T10:05:01Z")).toBe("+1res");
  });

  it("else the job's newest received text, else nothing", () => {
    expect(bellThreadPhone(rows, "j1", "2026-11-10T09:00:00Z")).toBe("+1res");
    expect(bellThreadPhone(rows, "j1", undefined)).toBe("+1res");
    expect(bellThreadPhone(rows, "j9", "2026-11-10T10:00:01Z")).toBeNull();
  });
});

describe("re-filing a conversation", () => {
  it("takes texts with no job and texts on the guessed job, nothing else", () => {
    const rows = [
      { id: "a", job_id: null },
      { id: "b", job_id: "guess" },
      { id: "c", job_id: "other" },
    ];
    expect(rowsToAssign(rows, "guess")).toEqual(["a", "b"]);
    expect(rowsToAssign(rows, null)).toEqual(["a"]);
  });

  it("only unknown, Check match or just-linked conversations", () => {
    expect(canAssign({ match: "unknown", jobId: null, customerId: null })).toBe(true);
    expect(canAssign({ match: "several", jobId: "j", customerId: "c" })).toBe(true);
    expect(canAssign({ match: "linked", jobId: "j", customerId: "c" })).toBe(true);
    expect(canAssign({ match: "thread", jobId: "j", customerId: "c" })).toBe(false);
    expect(canAssign({ match: "customer", jobId: null, customerId: "c" })).toBe(false);
  });
});
