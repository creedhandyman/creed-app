import { readMessageStream } from "../lib/anthropic-stream";

const enc = new TextEncoder();
const sse = (ev: Record<string, unknown>) => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;

/** A stream that hands out the given chunks; `hang` = never closes after them. */
function streamOf(chunks: string[], hang = false): { body: ReadableStream<Uint8Array>; cancelled: () => boolean } {
  let i = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
      else if (!hang) controller.close();
      else return new Promise<void>(() => undefined);
    },
    cancel() { cancelled = true; },
  });
  return { body, cancelled: () => cancelled };
}

const start = sse({
  type: "message_start",
  message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null,
    usage: { input_tokens: 1200, cache_read_input_tokens: 9000, output_tokens: 1 } },
});
const text = (t: string) => sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } });
const open = sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });

describe("readMessageStream", () => {
  it("rebuilds the message a non-streamed call would have returned", async () => {
    const all = [
      start, open, text('{"rooms":'), sse({ type: "ping" }), text("[]}"),
      sse({ type: "content_block_stop", index: 0 }),
      sse({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 42 } }),
      sse({ type: "message_stop" }),
    ].join("");
    // Split mid-event to prove chunk boundaries don't matter.
    const cut = Math.floor(all.length / 2) + 3;
    const { message, error } = await readMessageStream(streamOf([all.slice(0, cut), all.slice(cut)]).body);
    expect(error).toBeNull();
    expect(message.model).toBe("claude-sonnet-5-5");
    expect(message.content).toEqual([{ type: "text", text: '{"rooms":[]}' }]);
    expect(message.stop_reason).toBe("end_turn");
    expect(message.usage).toEqual({ input_tokens: 1200, cache_read_input_tokens: 9000, output_tokens: 42 });
    expect(message.cut).toBeUndefined();
  });

  it("at the deadline returns what was written, marked as cut off, and stops the upstream", async () => {
    let t = 0;
    const s = streamOf([start + open + text("a".repeat(700))], true);
    const { message, error } = await readMessageStream(s.body, { deadlineAt: 100, now: () => (t += 60) });
    expect(error).toBeNull();
    expect(message.cut).toBe("deadline");
    expect(message.stop_reason).toBe("max_tokens");
    expect((message.content[0].text as string).length).toBe(700);
    expect(message.usage.output_tokens).toBe(200); // estimated from the text
    expect(s.cancelled()).toBe(true);
  });

  it("a hung stream is cut by the timer, not just between chunks", async () => {
    const s = streamOf([start + open + text("partial")], true);
    const { message } = await readMessageStream(s.body, { deadlineAt: Date.now() + 40 });
    expect(message.cut).toBe("deadline");
    expect(message.content[0].text).toBe("partial");
  });

  it("a stream that just ends is treated as cut off too", async () => {
    const { message } = await readMessageStream(streamOf([start + open + text("half a quo")]).body);
    expect(message.cut).toBe("stream_ended");
    expect(message.stop_reason).toBe("max_tokens");
  });

  it("reports an error event", async () => {
    const { error } = await readMessageStream(
      streamOf([start + sse({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })]).body,
    );
    expect(error).toEqual({ type: "overloaded_error", message: "Overloaded" });
  });

  it("keeps a refusal's stop details", async () => {
    const { message } = await readMessageStream(streamOf([
      start + sse({ type: "message_delta", delta: { stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" } }, usage: { output_tokens: 0 } }) + sse({ type: "message_stop" }),
    ]).body);
    expect(message.stop_reason).toBe("refusal");
    expect(message.stop_details).toEqual({ type: "refusal", category: "cyber" });
  });
});
