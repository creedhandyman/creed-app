/**
 * The shared AI provider wrappers: callClaude (anthropic-server) owns the
 * Sonnet 5.5 server-side fallback + its one retry and the ai_usage row;
 * callOpenAI (openai-server) logs a row per call. Driven through their
 * interfaces with a fake fetch and a fake Supabase insert.
 */
const inserts: Record<string, unknown>[] = [];
let insertThrows = false;
jest.mock("@/lib/api-auth", () => ({
  serviceClient: () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (insertThrows) throw new Error("relation ai_usage does not exist");
        inserts.push({ table, ...row });
        return { error: null };
      },
    }),
  }),
}));

import { callClaude } from "@/lib/anthropic-server";
import { callOpenAI, openaiUsage } from "@/lib/openai-server";

type Call = { url: string; headers: Record<string, string>; body: unknown };
let calls: Call[] = [];
function fakeFetch(replies: Array<{ status: number; body: unknown }>) {
  calls = [];
  let i = 0;
  global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers || {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    });
    const r = replies[Math.min(i++, replies.length - 1)];
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      json: async () => JSON.parse(text),
      text: async () => text,
    } as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  inserts.length = 0;
  insertThrows = false;
  process.env.ANTHROPIC_API_KEY = "test-anthropic";
  process.env.OPENAI_API_KEY = "test-openai";
});

const okReply = {
  model: "claude-sonnet-5-5",
  content: [{ type: "text", text: "{}" }],
  usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 200 },
};

describe("callClaude", () => {
  it("adds the server-side fallback to a Sonnet 5.5 call and logs usage", async () => {
    fakeFetch([{ status: 200, body: okReply }]);
    const out = await callClaude(
      { model: "claude-sonnet-5-5", max_tokens: 2000, messages: [] },
      { orgId: "o1", userId: "u1", callType: "receipt" },
    );
    expect(out.status).toBe(200);
    expect(out.data).toEqual(okReply);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].headers["x-api-key"]).toBe("test-anthropic");
    expect(calls[0].headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
    expect(calls[0].body).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 2000, fallbacks: "default" });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      table: "ai_usage", org_id: "o1", user_id: "u1", call_type: "receipt", model: "claude-sonnet-5-5",
      input_tokens: 1000, output_tokens: 500, cache_read_tokens: 200,
    });
    // 1000×$2 + 500×$10 + 200×$0.2 per million
    expect(inserts[0].est_cost).toBeCloseTo(0.00704, 6);
  });

  it("retries once without the fallback when the API rejects it", async () => {
    fakeFetch([
      { status: 400, body: { error: { message: "Unknown beta: server-side-fallback" } } },
      { status: 200, body: okReply },
    ]);
    const out = await callClaude({ model: "claude-sonnet-5-5", messages: [] }, { callType: "tax" });
    expect(out.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect((calls[1].body as Record<string, unknown>).fallbacks).toBeUndefined();
    expect(calls[1].headers["anthropic-beta"]).toBeUndefined();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ call_type: "tax", org_id: null, user_id: null });
  });

  it("does not retry an unrelated 400, and still logs the call", async () => {
    fakeFetch([{ status: 400, body: { error: { message: "max_tokens too large" } } }]);
    const out = await callClaude({ model: "claude-sonnet-5-5", messages: [] }, {});
    expect(out.status).toBe(400);
    expect(calls).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ call_type: "other", input_tokens: 0, est_cost: 0 });
  });

  it("leaves non-5.5 models and an explicit fallbacks value alone", async () => {
    fakeFetch([{ status: 200, body: okReply }]);
    await callClaude({ model: "claude-sonnet-5", messages: [] }, {});
    await callClaude({ model: "claude-sonnet-5-5", fallbacks: "none", messages: [] }, {});
    expect(calls).toHaveLength(2);
    expect((calls[0].body as Record<string, unknown>).fallbacks).toBeUndefined();
    expect((calls[1].body as Record<string, unknown>).fallbacks).toBe("none");
    expect(calls.every((c) => c.headers["anthropic-beta"] === undefined)).toBe(true);
  });

  it("a failing usage insert never breaks the call", async () => {
    insertThrows = true;
    fakeFetch([{ status: 200, body: okReply }]);
    const out = await callClaude({ model: "claude-sonnet-5-5", messages: [] }, {});
    expect(out.status).toBe(200);
    expect(out.data).toEqual(okReply);
  });

  it("without a key, answers 500 and sends nothing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    fakeFetch([{ status: 200, body: okReply }]);
    const out = await callClaude({ model: "claude-sonnet-5-5" }, {});
    expect(out.status).toBe(500);
    expect(calls).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });
});

describe("callOpenAI", () => {
  it("posts the form with the key, returns the raw text, and logs image tokens", async () => {
    const body = { data: [{ b64_json: "AAAA" }], usage: { input_tokens: 300, output_tokens: 4000, input_tokens_details: { text_tokens: 100, image_tokens: 200 } } };
    fakeFetch([{ status: 200, body }]);
    const form = new FormData();
    const out = await callOpenAI("/v1/images/edits", form, { orgId: "o1", userId: "u1", callType: "render", model: "gpt-image-1", quality: "low" });
    expect(out).toEqual({ status: 200, ok: true, text: JSON.stringify(body) });
    expect(calls[0].url).toBe("https://api.openai.com/v1/images/edits");
    expect(calls[0].headers.Authorization).toBe("Bearer test-openai");
    expect(calls[0].body).toBe(form);
    expect(inserts[0]).toMatchObject({ org_id: "o1", user_id: "u1", call_type: "render", model: "gpt-image-1", input_tokens: 300, output_tokens: 4000 });
    // 100×$5 + 200×$10 + 4000×$40 per million
    expect(inserts[0].est_cost).toBeCloseTo(0.1625, 6);
  });

  it("logs a failed call at $0 and passes the error body through", async () => {
    fakeFetch([{ status: 429, body: "rate limited" }]);
    const out = await callOpenAI("/v1/audio/transcriptions", new FormData(), { callType: "transcribe", model: "whisper-1" });
    expect(out).toEqual({ status: 429, ok: false, text: "rate limited" });
    expect(inserts[0]).toMatchObject({ call_type: "transcribe", model: "whisper-1", est_cost: 0 });
  });

  it("a failing usage insert never breaks the call", async () => {
    insertThrows = true;
    fakeFetch([{ status: 200, body: { text: "hello" } }]);
    const out = await callOpenAI("/v1/audio/transcriptions", new FormData(), { model: "whisper-1" });
    expect(out.ok).toBe(true);
    expect(JSON.parse(out.text)).toEqual({ text: "hello" });
  });

  it("without a key, answers 503 and sends nothing", async () => {
    delete process.env.OPENAI_API_KEY;
    fakeFetch([{ status: 200, body: {} }]);
    const out = await callOpenAI("/v1/images/edits", new FormData(), { model: "gpt-image-1" });
    expect(out.status).toBe(503);
    expect(calls).toHaveLength(0);
  });
});

describe("openaiUsage", () => {
  it("falls back to a per-call image figure by quality when no usage is returned", () => {
    expect(openaiUsage("gpt-image-1", 200, JSON.stringify({ data: [] }), { quality: "high" }).estCost).toBeCloseTo(0.167);
    expect(openaiUsage("gpt-image-1", 200, "{}").estCost).toBeCloseTo(0.011);
  });
  it("prices Whisper by reported duration, else $0", () => {
    expect(openaiUsage("whisper-1", 200, JSON.stringify({ text: "x", usage: { type: "duration", seconds: 120 } })).estCost).toBeCloseTo(0.012);
    expect(openaiUsage("whisper-1", 200, JSON.stringify({ text: "x" })).estCost).toBe(0);
  });
});
