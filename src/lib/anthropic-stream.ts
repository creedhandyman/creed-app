/**
 * Read a STREAMED Anthropic Messages reply and rebuild the same message object
 * a non-streamed call returns ({model, content, stop_reason, usage, …}).
 *
 * Why streaming: a long quote can take minutes to write. A non-streamed call
 * gives nothing until the end, so when the server function's time limit hits
 * first the whole reply is lost. Reading the stream lets callClaude stop at a
 * deadline and hand back what was written so far, marked as cut off
 * (stop_reason "max_tokens" + `cut: "deadline"`); the quote parser then keeps
 * every complete line (json-salvage.ts).
 *
 * Pure apart from the stream it is given; tested in anthropic-stream.test.ts.
 */

type Block = Record<string, unknown> & { type?: string };

export interface StreamedMessage extends Record<string, unknown> {
  content: Block[];
  stop_reason: string | null;
  usage: Record<string, unknown>;
  /** Set when the reply did not finish on its own. */
  cut?: "deadline" | "stream_ended";
}

export interface ReadOpts {
  /** Stop reading at this time (ms epoch) and return the partial reply. */
  deadlineAt?: number;
  now?: () => number;
}

/** Fold one server-sent event into the message being built. Returns an API
 *  error object when the event is an `error` event. */
export function applyStreamEvent(msg: StreamedMessage, ev: Record<string, unknown>): Record<string, unknown> | null {
  const type = ev.type;
  if (type === "message_start") {
    const m = (ev.message || {}) as Record<string, unknown>;
    Object.assign(msg, m, {
      content: Array.isArray(m.content) ? [...(m.content as Block[])] : [],
      usage: { ...((m.usage as Record<string, unknown>) || {}) },
    });
  } else if (type === "content_block_start") {
    const i = Number(ev.index);
    if (Number.isInteger(i) && i >= 0) msg.content[i] = { ...((ev.content_block as Block) || {}) };
  } else if (type === "content_block_delta") {
    const block = msg.content[Number(ev.index)];
    const d = (ev.delta || {}) as Record<string, unknown>;
    if (block) {
      if (d.type === "text_delta") block.text = String(block.text ?? "") + String(d.text ?? "");
      else if (d.type === "thinking_delta") block.thinking = String(block.thinking ?? "") + String(d.thinking ?? "");
      else if (d.type === "signature_delta") block.signature = String(block.signature ?? "") + String(d.signature ?? "");
      else if (d.type === "input_json_delta") block.partial_json = String(block.partial_json ?? "") + String(d.partial_json ?? "");
    }
  } else if (type === "content_block_stop") {
    // A tool call's input arrives as JSON text; turn it into the object.
    const block = msg.content[Number(ev.index)];
    if (block && typeof block.partial_json === "string") {
      try { block.input = block.partial_json ? JSON.parse(block.partial_json) : {}; } catch { /* leave input as sent */ }
      delete block.partial_json;
    }
  } else if (type === "message_delta") {
    Object.assign(msg, (ev.delta as Record<string, unknown>) || {});
    Object.assign(msg.usage, (ev.usage as Record<string, unknown>) || {});
  } else if (type === "error") {
    return (ev.error as Record<string, unknown>) || { message: "stream error" };
  }
  return null;
}

/** Rough token count for a reply that was cut before its final usage arrived. */
function estimateOutputTokens(msg: StreamedMessage): number {
  let chars = 0;
  for (const b of msg.content) if (b && typeof b.text === "string") chars += b.text.length;
  return Math.ceil(chars / 3.5);
}

export async function readMessageStream(
  body: ReadableStream<Uint8Array>,
  opts: ReadOpts = {},
): Promise<{ message: StreamedMessage; error: Record<string, unknown> | null }> {
  const now = opts.now ?? Date.now;
  const msg: StreamedMessage = { content: [], stop_reason: null, usage: {} };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let finished = false;
  let error: Record<string, unknown> | null = null;

  const handle = (rawEvent: string) => {
    // One event = lines; the payload is on the "data:" line(s).
    const data = rawEvent
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(data); } catch { return; }
    if (ev.type === "message_stop") { finished = true; return; }
    error = applyStreamEvent(msg, ev) ?? error;
  };

  try {
    while (!finished && !error) {
      const left = opts.deadlineAt === undefined ? Infinity : opts.deadlineAt - now();
      if (left <= 0) { msg.cut = "deadline"; break; }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([
        reader.read(),
        ...(Number.isFinite(left)
          ? [new Promise<"deadline">((resolve) => { timer = setTimeout(() => resolve("deadline"), left); })]
          : []),
      ]);
      if (timer) clearTimeout(timer);
      if (next === "deadline") { msg.cut = "deadline"; break; }
      if (next.done) break;
      buf += decoder.decode(next.value, { stream: true });
      let sep: number;
      while ((sep = buf.search(/\r?\n\r?\n/)) >= 0) {
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep).replace(/^\r?\n\r?\n/, "");
        handle(raw);
        if (finished || error) break;
      }
    }
  } finally {
    // Stops the upstream generation when we leave early.
    try { await reader.cancel(); } catch { /* already closed */ }
  }

  if (!error && !finished && !msg.cut && !msg.stop_reason) msg.cut = "stream_ended";
  if (msg.cut) {
    msg.stop_reason = "max_tokens";
    msg.usage.output_tokens = Math.max(Number(msg.usage.output_tokens) || 0, estimateOutputTokens(msg));
  }
  msg.content = msg.content.filter(Boolean);
  return { message: msg, error };
}
