/**
 * RoomItem.aiHrs — the AI parser's own hours for a line, before the labor
 * calibration scaled them — only means something on the job it was parsed
 * for: learning.ts grades it against THAT job's clocked hours. Anything that
 * reuses a quote's lines on another job (service templates, recurring visits)
 * must drop it, or one old estimate gets graded again on every copy. Customer
 * payloads drop it too — it's internal pricing provenance.
 *
 * Kept free of imports so server routes can use it without pulling in the
 * parser.
 */

type Obj = Record<string, unknown>;

/** A copy of a rooms array with every item's aiHrs removed. */
export function stripAiHrs<T>(rooms: T): T {
  if (!Array.isArray(rooms)) return rooms;
  return rooms.map((r) => {
    if (!r || typeof r !== "object" || !Array.isArray((r as Obj).items)) return r;
    return {
      ...(r as Obj),
      items: ((r as Obj).items as unknown[]).map((it) => {
        if (!it || typeof it !== "object" || !("aiHrs" in (it as Obj))) return it;
        const { aiHrs: _drop, ...rest } = it as Obj;
        void _drop;
        return rest;
      }),
    };
  }) as T;
}

/** The same for a job's stored rooms blob — `{ rooms: [...] }` or a legacy
 *  bare array, as a JSON string or an object. Returns the same shape it was
 *  given; anything malformed comes back unchanged. */
export function stripAiHrsFromBlob<T>(raw: T): T {
  try {
    const blob = typeof raw === "string" ? JSON.parse(raw) : raw;
    let out: unknown;
    if (Array.isArray(blob)) out = stripAiHrs(blob);
    else if (blob && typeof blob === "object" && Array.isArray((blob as Obj).rooms)) {
      out = { ...(blob as Obj), rooms: stripAiHrs((blob as Obj).rooms) };
    } else return raw;
    return (typeof raw === "string" ? JSON.stringify(out) : out) as T;
  } catch {
    return raw;
  }
}
