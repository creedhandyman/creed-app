/**
 * Recover a quote from an AI reply that was cut off mid-JSON.
 *
 * A very long quote can hit the model's output limit; the reply then ends in
 * the middle of a line item and JSON.parse throws — which used to throw the
 * WHOLE quote away ("AI error", start over) even though 95% of it had
 * arrived. salvageJson keeps every complete line item and closes the
 * brackets the model never got to. Pure; tested in json-salvage.test.ts.
 */

export interface Salvaged {
  value: unknown;
  /** True when the reply was incomplete and had to be repaired. */
  truncated: boolean;
}

/** Parse the first JSON object in `text`. Returns null when there is none or
 *  nothing usable could be recovered. */
export function salvageJson(text: string): Salvaged | null {
  const start = (text || "").indexOf("{");
  if (start < 0) return null;
  const src = text.slice(start);

  // Walk the text once, tracking open brackets (outside strings). After each
  // closing brace, remember "the text up to here + what is still open" — a
  // point where the document could be cut and closed cleanly.
  const stack: string[] = [];
  const cuts: { end: number; open: string }[] = [];
  let inStr = false, esc = false, completeAt = -1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      stack.pop();
      if (stack.length === 0) { completeAt = i + 1; break; }
      if (ch === "}") cuts.push({ end: i + 1, open: stack.join("") });
    }
  }

  if (completeAt > 0) {
    try { return { value: JSON.parse(src.slice(0, completeAt)), truncated: false }; } catch { /* fall through to repair */ }
  }

  const close = (open: string) =>
    open.split("").reverse().map((c) => (c === "{" ? "}" : "]")).join("");
  // Prefer the last point where a LINE ITEM just finished — inside
  // root{ rooms[ room{ items[ — so a half-written item (no hours yet, half
  // its materials) is dropped rather than kept as a wrong line. Fall back to
  // any earlier clean cut.
  const itemCuts = cuts.filter((c) => c.open === "{[{[");
  for (const list of [itemCuts, cuts]) {
    for (let i = list.length - 1; i >= 0 && i >= list.length - 40; i--) {
      const c = list[i];
      try { return { value: JSON.parse(src.slice(0, c.end) + close(c.open)), truncated: true }; } catch { /* try an earlier cut */ }
    }
  }
  return null;
}
