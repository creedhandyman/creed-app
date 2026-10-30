/**
 * Scope-completion rules — the "what did the quote forget?" layer.
 *
 * A rule (table `scope_rules`) attaches to a quote line and either suggests a
 * companion line (stain + clear coat for a new wood door), asks a question
 * (is the existing door stained or painted?) or warns (pre-1978 lead rule).
 * Everything here is PURE: the client loader lives in scope-rules-client.ts and
 * the card in QuoteForge. Nothing is ever added to a quote without the owner
 * tapping Add.
 */

export interface ScopeRule {
  id: string;
  org_id: string | null;
  name: string;
  applies_kb_ids: string[];
  applies_pattern: string | null;
  kind: "add_item" | "ask_question" | "warn";
  severity: "required" | "recommended" | "optional";
  condition: Record<string, unknown>;
  sets_key: string | null;
  options: string[] | null;
  question: string | null;
  suggestion: string | null;
  labor_hours: number;
  unit: string;
  mat_hint: string | null;
  qty_basis: "per_trigger" | "once_per_job";
  reason: string | null;
  active?: boolean;
}

/** What the owner has done with one quote line's rules. Lives on the line. */
export interface ScopeState {
  answers?: Record<string, string>;
  added?: string[];
  dismissed?: string[];
  /** Set on a line a rule added; such a line never triggers rules itself. */
  from?: string;
}

const SEVERITY_RANK = { required: 0, recommended: 1, optional: 2 } as const;
const MAX_PATTERN_LEN = 2000;

const patternCache = new Map<string, RegExp | null>();
function compile(pattern: string): RegExp | null {
  if (patternCache.has(pattern)) return patternCache.get(pattern) ?? null;
  let re: RegExp | null = null;
  if (pattern.length <= MAX_PATTERN_LEN) {
    try { re = new RegExp(pattern, "i"); } catch { re = null; }
  }
  patternCache.set(pattern, re);
  return re;
}

/** Does this rule attach to the line? A line that already knows its price_book
 *  ids (future strict-JSON quotes) matches on those; free text matches on the
 *  rule's pattern. */
export function ruleMatchesLine(rule: ScopeRule, text: string, kbIds?: string[]): boolean {
  if (kbIds && kbIds.length && rule.applies_kb_ids?.some((k) => kbIds.includes(k))) return true;
  if (!rule.applies_pattern) return false;
  const re = compile(rule.applies_pattern);
  return !!re && re.test(text);
}

/** answers use "yes"/"no" for booleans. */
function answerFor(answers: Record<string, string> | undefined, key: string): string | undefined {
  return answers?.[key];
}

function expected(v: unknown): string {
  return v === true ? "yes" : v === false ? "no" : String(v);
}

export function conditionMet(condition: Record<string, unknown> | null | undefined, answers?: Record<string, string>): boolean {
  if (!condition) return true;
  return Object.entries(condition).every(([k, v]) => answerFor(answers, k) === expected(v));
}

/** Condition keys that no answer has filled yet. */
export function missingKeys(condition: Record<string, unknown> | null | undefined, answers?: Record<string, string>): string[] {
  if (!condition) return [];
  return Object.keys(condition).filter((k) => answerFor(answers, k) === undefined);
}

export interface LineScope {
  /** Questions still to answer: ask_question rules, plus a yes/no for any
   *  observation key a rule needs but no question sets. */
  questions: { key: string | null; ruleId: string | null; text: string; options: string[]; severity: ScopeRule["severity"]; reason: string | null }[];
  /** Suggested lines the owner can add now. */
  suggestions: ScopeRule[];
  warnings: ScopeRule[];
}

const BOOL_QUESTIONS: Record<string, string> = {
  home_built_before_1978: "Was the home built before 1978?",
};

function humanKey(k: string): string {
  return BOOL_QUESTIONS[k] ?? `${k.replace(/_/g, " ")}?`;
}

/** Everything the card shows for one line. */
export function evaluateLine(
  rules: ScopeRule[],
  text: string,
  state: ScopeState | undefined,
  opts?: { kbIds?: string[]; skipOnce?: Set<string> },
): LineScope {
  const answers = state?.answers;
  const added = new Set(state?.added ?? []);
  const dismissed = new Set(state?.dismissed ?? []);
  const out: LineScope = { questions: [], suggestions: [], warnings: [] };
  const askedKeys = new Set<string>();
  const needKeys = new Set<string>();

  const matched = rules
    .filter((r) => r.active !== false && ruleMatchesLine(r, text, opts?.kbIds))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  for (const r of matched) {
    // once_per_job rules show on the first line they match, not on every door.
    // A question skipped here (shown on another line, or dismissed) still owns
    // its key: never re-ask it as a made-up yes/no — its answer goes job-wide
    // (once_per_job) or the owner chose not to answer.
    const skipped = (r.qty_basis === "once_per_job" && opts?.skipOnce?.has(r.id)) || dismissed.has(r.id);
    if (skipped) {
      if (r.kind === "ask_question" && r.sets_key) askedKeys.add(r.sets_key);
      continue;
    }
    if (r.kind === "ask_question") {
      if (r.sets_key) {
        if (answers?.[r.sets_key] !== undefined) continue;
        askedKeys.add(r.sets_key);
      }
      out.questions.push({
        key: r.sets_key, ruleId: r.id, text: r.question ?? r.name,
        options: r.options ?? [], severity: r.severity, reason: r.reason,
      });
      continue;
    }
    for (const k of missingKeys(r.condition, answers)) needKeys.add(k);
    if (!conditionMet(r.condition, answers)) continue;
    if (r.kind === "add_item") {
      if (!added.has(r.id)) out.suggestions.push(r);
    } else {
      out.warnings.push(r);
    }
  }

  // A rule waiting on an observation nobody asks about gets a yes/no question.
  for (const k of needKeys) {
    if (askedKeys.has(k)) continue;
    out.questions.push({ key: k, ruleId: null, text: humanKey(k), options: ["yes", "no"], severity: "recommended", reason: null });
  }
  return out;
}

/** "Bedroom 2 — Replace door" → "Bedroom 2". */
export function areaOf(detail: string): string {
  const i = detail.indexOf(" — ");
  return i > 0 ? detail.slice(0, i).trim() : "";
}

/** The text of a suggested line, prefixed with the trigger line's area so two
 *  doors in two rooms stay two lines (validateQuote dedupes on room|comment). */
export function suggestionDetail(rule: ScopeRule, triggerDetail: string): string {
  const area = areaOf(triggerDetail);
  const text = rule.suggestion ?? rule.name;
  return area ? `${area} — ${text}` : text;
}

/** suggestionDetail made unique among `taken` (lower-cased details already on
 *  the quote): two doors in one area each get their own line instead of
 *  validateQuote dropping the second as a duplicate. */
export function uniqueSuggestionDetail(rule: ScopeRule, triggerDetail: string, taken: Set<string>): string {
  const base = suggestionDetail(rule, triggerDetail);
  const norm = (d: string) => d.toLowerCase().replace(/\s+/g, " ").trim();
  if (!taken.has(norm(base))) return base;
  const area = areaOf(triggerDetail);
  const task = (area ? triggerDetail.slice(triggerDetail.indexOf(" — ") + 3) : triggerDetail).trim();
  const withTask = task ? `${base} (for: ${task})` : base;
  if (!taken.has(norm(withTask))) return withTask;
  for (let n = 2; ; n++) {
    const d = `${withTask} #${n}`;
    if (!taken.has(norm(d))) return d;
  }
}
