import {
  ruleMatchesLine, evaluateLine, conditionMet, areaOf, suggestionDetail, type ScopeRule,
} from "../lib/scope-rules";

// The patterns stored on the shared door rules in `scope_rules`. Keep this file
// and the DB rows in step: the SQL that sets applies_pattern pastes these.
const HW = "knob|handle|lever|hinges?|closer|stop(?:per)?|sweep|threshold|weather\\w*|lock|latch|strike|bumper|hardware|deadbolt|jamb|casing|trim|frame|seal|screen";
const VERB = "(?=.*\\b(?:replace|install|swap|hang|new)\\b)";
const NOT_HW_BEFORE = `(?!.*\\b(?:${HW})\\b[^—]*\\bdoors?\\b)`;
const NOT_HW_AFTER = `\\bdoors?\\b(?!\\s*(?:${HW}|rollers?|tracks?|opener))`;
// "Front door — Replace weatherstripping": the first verb's object is hardware.
const NOT_HW_OBJECT = `(?!(?:.*—)?\\s*(?:replace|install|swap|hang|new)\\b\\s+(?:\\w+\\s+){0,2}(?:${HW})\\b)`;
const EXT_ADJ = "front|entry|exterior|back|rear|side|garage|patio|sliding|storm|french";
const ADJ_DOOR = "\\s+(?:\\w+\\s+)?(?:entry\\s+)?doors?\\b";
const OTHER_TYPES = "pocket|bi-?fold|barn|dutch|exterior";

export const INTERIOR_DOOR = `^(?!.*\\b(?:${EXT_ADJ})${ADJ_DOOR})(?!\\s*(?:entry|foyer)\\b)(?!.*\\b(?:${OTHER_TYPES})\\b)${NOT_HW_BEFORE}${NOT_HW_OBJECT}${VERB}.*${NOT_HW_AFTER}`;
export const ENTRY_DOOR = `^(?!.*\\b(?:patio|sliding|storm|french|garage)${ADJ_DOOR})${NOT_HW_BEFORE}${NOT_HW_OBJECT}${VERB}(?=.*(?:\\b(?:front|entry|exterior|back|rear|side)\\s+(?:entry\\s+)?doors?\\b|\\bexterior\\b|^\\s*(?:entry|foyer)\\b)).*${NOT_HW_AFTER}`;
export const JAMB = "\\b(?:repair|rotted?|damaged?|kicked|split|splintered|replace)\\b.*\\b(?:door\\s+)?jambs?\\b|\\bjambs?\\b.*\\b(?:repair|rotted?|damaged?|kicked|split|splintered)\\b";
export const ANY_DOOR = `(?:${INTERIOR_DOOR})|(?:${ENTRY_DOOR})|(?:${JAMB})`;

const match = (pattern: string, line: string) =>
  ruleMatchesLine({ applies_pattern: pattern, applies_kb_ids: [] } as unknown as ScopeRule, line);

describe("door patterns", () => {
  const interior = [
    "Bedroom 2 — Replace interior door with new pre-hung door, hinges, knob, shims",
    "Hallway — Install new interior door slab",
    "Replace door",
    "Bathroom — Replace damaged door and install new hinges",
    "Master closet — Hang new door",
  ];
  const notInterior = [
    "Bedroom — Replace door knob",
    "Bedroom — Replace interior door knob or lever",
    "Install door stop",
    "Replace door hinges",
    "Front door — Replace deadbolt",
    "Replace deadbolt on front door",
    "Install door sweep",
    "Replace door weatherstripping",
    "Entry — Replace entry door",
    "Replace front entry door with new pre-hung",
    "Replace patio door",
    "Replace sliding glass door roller",
    "Pocket door repair",
    "Paint interior doors",
    "Front bedroom — Replace door knob",
  ];
  it.each(interior)("interior matches: %s", (l) => expect(match(INTERIOR_DOOR, l)).toBe(true));
  it.each(notInterior)("interior ignores: %s", (l) => expect(match(INTERIOR_DOOR, l)).toBe(false));

  const entry = [
    "Entry — Replace front door with new pre-hung exterior door",
    "Replace back door",
    "Install new exterior door",
    "Front entry door — replace",
    "Entry — Replace door",
  ];
  const notEntry = [
    "Replace front door deadbolt",
    "Front door — Replace weatherstripping",
    "Bedroom — Replace interior door",
    "Replace patio door",
    "Replace storm door closer",
    "Replace door",
  ];
  it.each(entry)("entry matches: %s", (l) => expect(match(ENTRY_DOOR, l)).toBe(true));
  it.each(notEntry)("entry ignores: %s", (l) => expect(match(ENTRY_DOOR, l)).toBe(false));

  it("matches jamb repair, not hardware", () => {
    expect(match(JAMB, "Entry — Repair rotted door jamb")).toBe(true);
    expect(match(JAMB, "Front door — kicked in, repair jamb and strike")).toBe(true);
    expect(match(JAMB, "Replace deadbolt")).toBe(false);
  });
  it("ANY_DOOR covers all three groups", () => {
    expect(match(ANY_DOOR, "Replace interior door")).toBe(true);
    expect(match(ANY_DOOR, "Replace front door")).toBe(true);
    expect(match(ANY_DOOR, "Repair rotted jamb")).toBe(true);
    expect(match(ANY_DOOR, "Paint ceiling")).toBe(false);
  });
});

const rule = (o: Partial<ScopeRule>): ScopeRule => ({
  id: "r", org_id: null, name: "n", applies_kb_ids: [], applies_pattern: "door", kind: "add_item",
  severity: "recommended", condition: {}, sets_key: null, options: null, question: null,
  suggestion: "do the thing", labor_hours: 1, unit: "door", mat_hint: null,
  qty_basis: "per_trigger", reason: null, ...o,
});

describe("evaluateLine", () => {
  const ask = rule({ id: "ask", kind: "ask_question", sets_key: "existing_finish", options: ["stained", "painted"], question: "Finish?", suggestion: null, severity: "required" });
  const stain = rule({ id: "stain", condition: { existing_finish: "stained" }, severity: "required" });
  const paint = rule({ id: "paint", condition: { existing_finish: "painted" } });
  const always = rule({ id: "always" });
  const lead = rule({ id: "lead", kind: "warn", condition: { home_built_before_1978: true } });
  const rules = [paint, always, stain, ask, lead];

  it("before any answer: asks the finish question, offers only unconditional lines", () => {
    const r = evaluateLine(rules, "Replace door", undefined);
    expect(r.questions.map((q) => q.key)).toEqual(["existing_finish", "home_built_before_1978"]);
    expect(r.suggestions.map((s) => s.id)).toEqual(["always"]);
    expect(r.warnings).toEqual([]);
  });

  it("the answer unlocks the matching lines and stops the question", () => {
    const r = evaluateLine(rules, "Replace door", { answers: { existing_finish: "stained" } });
    expect(r.questions.map((q) => q.key)).toEqual(["home_built_before_1978"]);
    expect(r.suggestions.map((s) => s.id)).toEqual(["stain", "always"]); // required first
  });

  it("boolean observations use yes/no", () => {
    const r = evaluateLine(rules, "Replace door", { answers: { existing_finish: "painted", home_built_before_1978: "yes" } });
    expect(r.warnings.map((w) => w.id)).toEqual(["lead"]);
    expect(r.questions).toEqual([]);
  });

  it("added and dismissed rules do not come back", () => {
    const r = evaluateLine(rules, "Replace door", { answers: { existing_finish: "painted" }, added: ["paint"], dismissed: ["always"] });
    expect(r.suggestions).toEqual([]);
  });

  it("once-per-job rules are skipped when another line already showed them", () => {
    const once = rule({ id: "once", qty_basis: "once_per_job" });
    expect(evaluateLine([once], "Replace door", undefined, { skipOnce: new Set(["once"]) }).suggestions).toEqual([]);
    expect(evaluateLine([once], "Replace door", undefined).suggestions.length).toBe(1);
  });

  it("matches by price_book id when the line has one", () => {
    const byId = rule({ id: "byid", applies_pattern: null, applies_kb_ids: ["DL-004"] });
    expect(evaluateLine([byId], "anything", undefined, { kbIds: ["DL-004"] }).suggestions.length).toBe(1);
    expect(evaluateLine([byId], "anything", undefined).suggestions.length).toBe(0);
  });

  it("a bad or oversized pattern never throws", () => {
    expect(ruleMatchesLine(rule({ applies_pattern: "([" }), "door")).toBe(false);
    expect(ruleMatchesLine(rule({ applies_pattern: "a".repeat(2100) }), "door")).toBe(false);
  });
});

describe("helpers", () => {
  it("conditionMet", () => {
    expect(conditionMet({}, undefined)).toBe(true);
    expect(conditionMet({ a: true }, { a: "yes" })).toBe(true);
    expect(conditionMet({ a: true }, { a: "no" })).toBe(false);
    expect(conditionMet({ a: "x" }, undefined)).toBe(false);
  });
  it("areaOf / suggestionDetail keep two rooms apart", () => {
    expect(areaOf("Bedroom 2 — Replace door")).toBe("Bedroom 2");
    expect(areaOf("Replace door")).toBe("");
    const r = rule({ suggestion: "Fill and caulk" });
    expect(suggestionDetail(r, "Bedroom 2 — Replace door")).toBe("Bedroom 2 — Fill and caulk");
    expect(suggestionDetail(r, "Replace door")).toBe("Fill and caulk");
  });
});
