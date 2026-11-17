/**
 * Job summaries — a one-sentence line for the collapsed job card and a short
 * paragraph for the job detail screen, so nobody has to open the quote to see
 * what a job covers.
 *
 * Rules (tested in job-summary.test.ts):
 *  - AUTO text is computed from the quote lines every time it is shown, so it is
 *    always current with the saved quote — nothing to regenerate on save.
 *  - Lines come from ONE option on a three-tier quote: the accepted option, else
 *    the one it was sent as, else the recommended one (quote-totals `rowTier`) —
 *    never all three, which would describe work the customer isn't buying.
 *  - Overhead lines (job setup / cleanup) and supplies-only lines are skipped.
 *  - No quote lines yet (a lead) → the customer's own request (`leadDescription`).
 *  - The owner can EDIT either text. An edit is saved on the blob as
 *    `summaryEdit {short?, long?, sig}`, where `sig` is the quote-line signature
 *    at the time of the edit. The edit always wins; when the quote has changed
 *    since (`sig` differs) the screen offers "use the new summary" instead of
 *    silently overwriting the owner's words.
 */
import { isSuppliesOnlyLine } from "./line-canon";
import { rowTier } from "./quote-totals";
import { itemInTier, type TierKey } from "./tiers";
import type { RoomsBlob } from "./job-blob";
import { readTierRooms } from "./quote-blob";

type LineLike = { id?: string; detail?: unknown; laborHrs?: unknown; tiers?: TierKey[] | null; tier?: string | null };
type RoomLike = { name?: unknown; items?: unknown };

export type SummaryEdit = { short?: string; long?: string; sig: string };

export interface JobSummary {
  /** One sentence for the collapsed card ("" when there is nothing to say). */
  short: string;
  /** A short paragraph for the detail screen. */
  long: string;
  /** Where the text came from. */
  source: "edited" | "quote" | "lead" | "none";
  /** The auto text, for "use the new summary" / reset. */
  auto: { short: string; long: string };
  /** The owner edited it and the quote lines changed since. */
  stale: boolean;
  /** The current quote-line signature (stored with an edit). */
  sig: string;
}

const OVERHEAD_RE = /\bjob\s*set-?up\b[^—]*\bclean-?\s*up\b|\blarge-job overhead\b/i;
const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** One quote line split into where it is and what the task is. */
export type SummaryTask = { place: string; task: string; hrs: number };

/** "Unit B — Bathroom — Re-caulk tub" → place "Unit B Bathroom", task "Re-caulk tub". */
export function splitDetail(detail: string): { place: string; task: string } {
  const parts = clean(detail).replace(/^\[T&M\]\s*/i, "").split(/\s+[—–]\s+|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return { place: "", task: (parts[0] || "").replace(/^\[T&M\]\s*/i, "") };
  const task = parts[parts.length - 1].replace(/^\[T&M\]\s*/i, "");
  return { place: parts.slice(0, -1).join(" "), task };
}

/** Which option a summary describes (null = not a three-tier quote). */
export function summaryTier(blob: RoomsBlob): TierKey | null {
  return blob?.tieredQuote === true ? rowTier(blob) : null;
}

/** The quote lines a summary describes, in quote order. */
export function summaryTasks(blob: RoomsBlob): SummaryTask[] {
  const rooms = readTierRooms<RoomLike>(blob);
  const tier = summaryTier(blob);
  const all: (LineLike & { _trade: string })[] = [];
  for (const r of rooms) {
    const items = Array.isArray(r?.items) ? (r.items as LineLike[]) : [];
    for (const it of items) if (it && typeof it === "object") all.push({ ...it, _trade: clean(r?.name) });
  }
  let lines = tier ? all.filter((it) => itemInTier(it, tier)) : all;
  // An option with nothing in it (odd data) — describe every line rather than nothing.
  if (tier && lines.length === 0) lines = all;
  const out: SummaryTask[] = [];
  for (const it of lines) {
    const detail = clean(it.detail);
    if (!detail || OVERHEAD_RE.test(detail) || isSuppliesOnlyLine(detail)) continue;
    const { place, task } = splitDetail(detail);
    if (!task) continue;
    const hrs = typeof it.laborHrs === "number" && Number.isFinite(it.laborHrs) ? it.laborHrs : 0;
    out.push({ place, task, hrs });
  }
  return out;
}

/** A stable fingerprint of what the summary describes (changes when the quote's lines do). */
export function summarySig(blob: RoomsBlob): string {
  const tasks = summaryTasks(blob);
  const lead = tasks.length ? "" : clean(blob?.leadDescription);
  const s = tasks.map((t) => `${t.place}|${t.task}`).join("\n") + "#" + lead;
  // djb2 — short, deterministic, no crypto needed.
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const lowerFirst = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const upperFirst = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const stripEnd = (s: string): string => s.replace(/[.;,\s]+$/, "");

function joinList(xs: string[]): string {
  if (xs.length <= 1) return xs[0] || "";
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`;
}

/** Places in order of first appearance, de-duplicated (case-insensitive). */
function placesOf(tasks: SummaryTask[]): string[] {
  const seen = new Map<string, string>();
  for (const t of tasks) {
    if (!t.place) continue;
    const k = t.place.toLowerCase();
    if (!seen.has(k)) seen.set(k, t.place);
  }
  return [...seen.values()];
}

/** First sentence of free text, capped near `max` chars at a word break. */
export function firstSentence(text: string, max = 140): string {
  const s = clean(text);
  if (!s) return "";
  const m = s.match(/^(.{20,}?[.!?])(\s|$)/);
  let out = m ? m[1] : s;
  if (out.length > max) out = out.slice(0, max).replace(/\s+\S*$/, "").replace(/[,;:\s]+$/, "") + "…";
  return out;
}

const SHORT_TASKS = 3;
const SHORT_MAX = 150;

/** The auto one-sentence summary. */
export function autoShort(blob: RoomsBlob): string {
  const tasks = summaryTasks(blob);
  if (!tasks.length) return firstSentence(clean(blob?.leadDescription));
  // Biggest jobs first for the headline, quote order among equals.
  const ranked = tasks.map((t, i) => ({ t, i })).sort((a, b) => b.t.hrs - a.t.hrs || a.i - b.i).map((x) => x.t);
  const names: string[] = [];
  for (const t of ranked) {
    const n = lowerFirst(stripEnd(t.task));
    if (!names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
  }
  const places = placesOf(tasks);
  const lead = places.length === 1 ? `${places[0]}: ` : places.length === 2 ? `${places[0]} and ${places[1]}: ` : "";
  const build = (k: number): string => {
    const shown = names.slice(0, k);
    const more = names.length - k;
    const list = more > 0 ? `${shown.join(", ")}, and ${more} more` : joinList(shown);
    return `${lead}${upperFirst(list)}.`;
  };
  let k = Math.min(SHORT_TASKS, names.length);
  let out = build(k);
  while (out.length > SHORT_MAX && k > 1) out = build(--k);
  if (out.length > SHORT_MAX) out = out.slice(0, SHORT_MAX - 1).replace(/\s+\S*$/, "") + "…";
  return out;
}

const LONG_PER_PLACE = 6;
const LONG_PLACES = 6;

/** The auto paragraph: what the job covers, grouped by place. */
export function autoLong(blob: RoomsBlob): string {
  const tasks = summaryTasks(blob);
  if (!tasks.length) {
    const lead = clean(blob?.leadDescription);
    return lead.length > 600 ? lead.slice(0, 600).replace(/\s+\S*$/, "") + "…" : lead;
  }
  const groups = new Map<string, { place: string; tasks: string[] }>();
  for (const t of tasks) {
    const k = t.place.toLowerCase();
    const g = groups.get(k) ?? { place: t.place, tasks: [] };
    const n = lowerFirst(stripEnd(t.task));
    if (!g.tasks.some((x) => x.toLowerCase() === n.toLowerCase())) g.tasks.push(n);
    groups.set(k, g);
  }
  const all = [...groups.values()];
  const sentences = all.slice(0, LONG_PLACES).map((g) => {
    const shown = g.tasks.slice(0, LONG_PER_PLACE);
    const more = g.tasks.length - shown.length;
    const list = more > 0 ? `${shown.join(", ")}, plus ${more} more` : joinList(shown);
    return g.place ? `${g.place}: ${list}.` : `${upperFirst(list)}.`;
  });
  const restPlaces = all.slice(LONG_PLACES);
  if (restPlaces.length) {
    const n = restPlaces.reduce((s, g) => s + g.tasks.length, 0);
    sentences.push(`Also ${n} more item${n === 1 ? "" : "s"} in ${joinList(restPlaces.map((g) => g.place || "other areas"))}.`);
  }
  const hrs = tasks.reduce((s, t) => s + t.hrs, 0);
  const count = tasks.length;
  const size = hrs > 0
    ? `${count} item${count === 1 ? "" : "s"}, about ${hrs < 10 ? Math.round(hrs * 2) / 2 : Math.round(hrs)} labor hour${hrs === 1 ? "" : "s"}.`
    : `${count} item${count === 1 ? "" : "s"}.`;
  return `${sentences.join(" ")} ${size}`;
}

/** Read a saved owner edit off the blob (null when absent or malformed). */
export function readSummaryEdit(blob: RoomsBlob): SummaryEdit | null {
  const e = blob?.summaryEdit as Record<string, unknown> | undefined;
  if (!e || typeof e !== "object") return null;
  const short = clean(e.short);
  const long = typeof e.long === "string" ? e.long.trim() : "";
  if (!short && !long) return null;
  return { ...(short ? { short } : {}), ...(long ? { long } : {}), sig: typeof e.sig === "string" ? e.sig : "" };
}

/** Everything the card + detail screen show. */
export function jobSummary(blob: RoomsBlob): JobSummary {
  const auto = { short: autoShort(blob), long: autoLong(blob) };
  const sig = summarySig(blob);
  const hasQuote = summaryTasks(blob).length > 0;
  const base: "quote" | "lead" | "none" = hasQuote ? "quote" : auto.short || auto.long ? "lead" : "none";
  const edit = readSummaryEdit(blob);
  if (!edit) return { short: auto.short, long: auto.long, source: base, auto, stale: false, sig };
  return {
    short: edit.short || auto.short,
    long: edit.long || auto.long,
    source: "edited",
    auto,
    stale: edit.sig !== sig,
    sig,
  };
}

/**
 * The blob delta that saves an owner edit. Text equal to the auto text is not
 * stored (so it keeps following the quote); both empty → the edit is removed
 * (`summaryEdit: null`), i.e. back to automatic.
 */
export function summaryEditDelta(blob: RoomsBlob, short: string, long: string): { summaryEdit: SummaryEdit | null } {
  const auto = { short: autoShort(blob), long: autoLong(blob) };
  const s = clean(short);
  const l = long.trim();
  const keepS = s && s !== auto.short ? s : "";
  const keepL = l && clean(l) !== clean(auto.long) ? l : "";
  if (!keepS && !keepL) return { summaryEdit: null };
  return { summaryEdit: { ...(keepS ? { short: keepS } : {}), ...(keepL ? { long: keepL } : {}), sig: summarySig(blob) } };
}

/** Just the card line (cheaper than `jobSummary` for a long list). */
export function summaryLine(blob: RoomsBlob): string {
  return readSummaryEdit(blob)?.short || autoShort(blob);
}
