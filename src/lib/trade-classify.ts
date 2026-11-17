/**
 * Which trade a quote line belongs to — the ONE place this is decided
 * (validateQuote calls `pickTrade` for every line; tested in
 * trade-classify.test.ts).
 *
 * Precedence for a line sitting in bucket `bucket`:
 *   1. The owner picked the trade (`userClassified`: manual Add Item, or the
 *      trade picker on a quote line) → kept, never re-guessed.
 *   2. A deterministic override (`overrideTrade`) — narrow, high-confidence
 *      shapes the scorer historically got wrong (countertops, framing, window /
 *      door replacement, caulk, paint-the-noun, carpentry demo).
 *   3. The bucket is a real trade → kept, UNLESS the whole-line scorer finds no
 *      evidence for it and clear evidence for another trade (`rescues`). That is
 *      how "flood cut, pull wet insulation" stops landing in Plumbing because
 *      the AI saw "water damage".
 *   4. Otherwise the scorer's best trade, or General.
 *
 * The scorer reads the whole line (detail + comment) and its materials: the
 * work objects and the materials decide the trade. Damage CONTEXT words —
 * water damage, moisture, leak, wet, mold, flood — score for no trade on their
 * own; only a plumbing object (pipe, faucet, supply line, drain, valve…) makes
 * a line Plumbing.
 */
import { TRADE_CATEGORY_LIST } from "./line-canon";

export type TradeName = (typeof TRADE_CATEGORY_LIST)[number];

/** The parts of a quote line the classifier reads. */
export type ClassifiableItem = {
  detail?: string;
  comment?: string;
  materials?: { n?: string }[];
  userClassified?: boolean;
};

const canonicalName = (name: string): TradeName | null =>
  TRADE_CATEGORY_LIST.find((t) => t.toLowerCase() === (name || "").toLowerCase().trim()) ?? null;

const textOf = (item: ClassifiableItem): string => `${item.detail || ""} ${item.comment || ""}`.toLowerCase();
const matsOf = (item: ClassifiableItem): string =>
  (Array.isArray(item.materials) ? item.materials : []).map((m) => String(m?.n || "")).join(" ").toLowerCase();

/** Concrete / masonry / grade context — sealing or caulking here is exterior (General) work, not Painting. */
const MASONRY_RE = /\b(slab|concrete|foundation|driveway|sidewalk|patio|masonry|brick|block wall|stucco|mortar|grade|regrade|soil)\b/;

/**
 * Deterministic override pass — returns a trade when the line unambiguously
 * names the work, else null. Each rule exists because of a real misroute:
 *  - "Laminate countertop" → Flooring (because of "laminate").
 *  - "Demo rotten shower wall framing" → Exterior / Plumbing.
 *  - "Replace large windows" → Painting (bundled trim paint + caulk).
 *  - "Paint new six-panel door" → Carpentry.
 *  - "Seal slab cracks … self-leveling sealant" → Painting (caulk rule) — slab
 *    and masonry sealing is General.
 */
export function overrideTrade(item: ClassifiableItem): TradeName | null {
  const s = textOf(item);
  const mats = matsOf(item);
  // Countertops are CARPENTRY (travel with cabinets, not floors).
  if (/counter.?top|counter top|counter-top/.test(s)) return "Carpentry";
  // Unambiguous FLOORING work (2248 Horseshoe: LVP + stair carpet landed in Carpentry).
  if (
    /\b(lvp|luxury vinyl|vinyl plank|laminate floor|carpet|underlayment|carpet pad|tack strip|stair tread)\b/.test(mats) &&
    /\b(floor|flooring|carpet|lvp|vinyl|laminate|subfloor|underlayment|stair tread|tread|riser)\b/.test(s) &&
    !/counter/.test(s)
  ) {
    return "Flooring";
  }
  // Interior framing / studs / blocking / sistering — Carpentry. "stain-blocking
  // primer" / "blocking sealer" are PAINT products, not framing blocking.
  const sFraming = s.replace(/stain[\s-]*blocking|blocking[\s-]+(?:primer|sealer|paint)/g, " ");
  if (/\bframing\b|re.?frame|reframe|\bstuds?\b|\bblocking\b|\bjoists?\b|\bheaders?\b|sistering|\bsister\b/.test(sFraming)) return "Carpentry";
  // Full window / door REPLACEMENT — Carpentry, even with trim paint + perimeter caulk bundled in.
  if (
    /\breplace\b[^.]{0,40}\bwindows?\b/.test(s) ||
    /\bwindows?\b[^.]{0,40}\breplacement\b/.test(s) ||
    /\binstall\b[^.]{0,40}\b(new\s+)?windows?\b/.test(s) ||
    /\breplace\b[^.]{0,40}\bdoors?\b/.test(s) ||
    /\bdoors?\b[^.]{0,40}\breplacement\b/.test(s) ||
    /\binstall\b[^.]{0,40}\b(new\s+)?doors?\b/.test(s)
  ) {
    return "Carpentry";
  }
  // Caulk / sealant → Painting (Bernard's prompt rule), except: a plumbing
  // fixture replacement that includes the bead (scorer decides), and sealing
  // concrete / masonry / a slab joint, which is exterior General work.
  if (/\bcaulk\b|caulking|\bsealant\b|silicone bead/.test(s) &&
      !/(replac|new).*(faucet|toilet|tub|shower head|sink|fixture)|fixture.*(replac|new)/.test(s)) {
    return MASONRY_RE.test(s) ? "General" : "Painting";
  }
  // PAINT a door / window / trim / cabinet / baseboard → Painting (the verb defines the trade).
  if (
    /\b(paint|repaint|prime|primer|touch.?up.*paint)\b/.test(s) &&
    /\b(door|window|trim|cabinet|baseboard|casing|sash)\b/.test(s)
  ) {
    return "Painting";
  }
  // Demo of carpentry-class items → Carpentry — unless the pest / debris is the
  // OBJECT of the removal ("Remove wasp nest at door" is General).
  const pestRemoval =
    /\b(?:remove|clear|clean\s*out|knock\s*down|treat)\s+(?:(?:the|a|an|old|dead|active|all|any)\s+)*(?:wasp|hornet|bee|bird|spider|insect|pest)?s?\s*(?:nests?|hives?|webs?|cobwebs?|wasps|hornets|spiders|insects|pests)\b/.test(s) &&
    !/\bcarpenter\s+bees?\b|\btermites?\b|\b(?:bee|insect|pest)[\s-]*damage/.test(s);
  const debrisRemoval =
    /\b(?:remove|clear|clean\s*out|haul(?:\s*away)?|trash[\s-]*out)\s+(?:(?:the|all|any|old|leftover|left[\s-]*behind|tenant|remaining|excess)\s+)*(?:debris|trash|junk|belongings|furniture)\b/.test(s) &&
    !/\b(demo|tear.?out|rip.?out)\b/.test(s);
  if (/\b(demo|tear.?out|rip.?out|remove)\b/.test(s) &&
      /(countertop|cabinet|trim|frame|framing|stud|drywall|baseboard|\bdoor\b|\bwindow\b)/.test(s) &&
      !(pestRemoval || debrisRemoval)) {
    return "Carpentry";
  }
  return null;
}

/** [pattern, points] — every rule that matches adds its points once. */
type Rule = [RegExp, number];

/**
 * Text rules (detail + comment). Plumbing patterns name a plumbing OBJECT —
 * word-bounded so "drainage", "tube", "sinking", "disposal bags", "paint
 * sprayer" and "supply … line" across a sentence no longer count.
 */
const TEXT_RULES: Record<TradeName, Rule[]> = {
  Plumbing: [
    [/water.?heater|hot.?water.?(?:tank|heater)|tankless|\bwh\b.*replace|\banode\b|t\W?p valve|expansion tank/, 12],
    [/\bfaucets?\b|\btoilets?\b|\bsinks?\b|\b(?:bath)?tubs?\b|\bdrains?\b|drain line|p.?traps?\b|\bwax ring|\bflapper|fill valve|flush valve/, 10],
    [/garbage disposal|\bdisposer\b|disposal unit|(?:replace|repair|reset|unjam|install)\w*\s+(?:the\s+)?disposal\b/, 10],
    [/supply lines?|water lines?|shut.?off valve|\bshut.?offs?\b|angle stops?|\bvalves?\b|\bpipes?\b|piping|\bpex\b|copper (?:line|pipe)|\bpvc (?:pipe|drain|line)|\bsewer|\bsewage|sump pump|\bsump\b|clean.?outs?\b/, 10],
    [/(?:kitchen|sink|faucet)\s+sprayer|\bstopper\b|\baerator\b|\bdiverter\b|hose bibb?|\bspigot\b|sillcock|\bbidet\b|dryer.?vent|\bplumbing\b|\bplumber\b/, 10],
    [/\bshower\b(?!\s*(?:rod|curtain|door|glass))/, 10],
    [/caulk.*\b(tub|shower|sink|bath)|re.?caulk\s+(?:the\s+)?(?:tub|shower|sink)/, 8],
  ],
  Electrical: [
    [/\boutlets?\b|\breceptacles?\b|\bswitch(?:es)?\b|\bwire\b|wiring|breakers?\b|\bgfci\b|\bafci\b|light fixtures?|\bbulbs?\b|ceiling fan|recessed|dimmer|\belectrical\b|electrician|junction box|cover plates?/, 10],
    [/(?:breaker|electrical|electric|main|sub|service|circuit)[\s-]*panel|panel box/, 10],
    [/smoke.*alarm|smoke detector|co.*detect|carbon.?monoxide|\bdetectors?\b|fire.?alarm|fire.?ext/, 12],
    [/doorbell|\bchime\b/, 12],
  ],
  Carpentry: [
    // Drywall / sheetrock: hanging, patching, flood cuts, finishing.
    [/\bdrywall\b|sheetrock|gypsum|wall ?board|\bflood.?cut/, 12],
    [/\btape\b|\bmud\b|joint compound|\btexture\b|\bcorner bead\b|\bskim/, 6],
    [/\binsulation\b|vapor barrier|\bsheathing\b|\bosb\b|\bplywood\b|\brot(?:ted|ten)?\b|\bsubfloor\b(?=.*\b(?:rot|replace|sister))/, 8],
    [/\bdoors?\b|\bknobs?\b|\bhinges?\b|\blocks?\b|deadbolt|bifold|pocket.*door|barn.*door|\bblinds?\b|\bwindows?\b|\bscreens?\b|\bmirrors?\b|\bclosets?\b|\bshel(?:f|ves|ving)\b/, 10],
    [/\bgaskets?\b|weather.?strip|door sweep|threshold seal|\bglazing\b/, 8],
    [/towel.*bar|tp.*holder|toilet paper holder|\brods?\b|\bhandles?\b|\blatch(?:es)?\b|\bstrike\b|\bcabinets?\b|\bdrawers?\b|\btrim\b|\bcasing\b|\bstairs?\b|\bhandrail/, 8],
  ],
  HVAC: [
    [/condenser|\bfurnace\b|hvac|mini.?split|ductwork|\bducts?\b|thermostat|air handler|range.*hood.*vent|exhaust.*vent.*roof|air filter|furnace filter|\bfilters?\b(?=.*\b(?:hvac|furnace|air|return)\b)/, 12],
  ],
  Painting: [
    [/\bpaint\b|repaint|\bprime\b|\bprimer\b|touch.?up.*paint|paint.*touch|\bstain(?:ing)?\b(?!ed)(?=.*\b(?:deck|fence|wood|cabinet|trim)\b)/, 10],
    [/spackle|nail (?:holes?|pops?)|patch.*\bwalls?\b|\bwalls?\b.*patch|ceiling.*paint/, 6],
  ],
  Flooring: [
    [/\bfloor|carpet|\blvp\b|laminate|tile.*floor|vinyl.*floor|transition.*strip|baseboard|quarter.*round|threshold|subfloor|\brugs?\b|\bcove base\b|\bwall base\b|rubber base/, 11],
  ],
  General: [
    [/\bsiding\b|hardi.?plank|cement.?board|\bfascia\b|\bsoffit\b|t1.?11|stucco/, 10],
    [/\bslab\b|\bconcrete\b|\bfoundation\b|\bdriveway\b|\bsidewalk\b|\bpatio\b|\bmasonry\b|\bbrick\b|\bmortar\b/, 10],
    [/\bregrade\b|\bgrade\b|\bgrading\b|\bsoil\b|\bdirt\b|\brock\b|\bgravel\b|\bmulch\b|landscap|\bsod\b|\bslope\b|drainage/, 10],
    [/exterior|\bfence\b|\bgate\b|gutters?|downspouts?|\bporch\b|\bdeck\b|mailbox|\broof\b|shingles?/, 8],
    [/\boven\b|\bstove\b|\brange\b(?!.*hood)|dishwasher|fridge|refrigerator|\bwasher\b|\bdryer\b(?!.?vent)|appliance|microwave|water.?softener/, 9],
    [/\bwasps?\b|\bhornets?\b|\bnests?\b|\bhives?\b|\bpests?\b|\brodents?\b|\bmice\b|\bcobwebs?\b/, 10],
    [/\bclean(?:ing|ed)?\b(?!.?outs?\b)|\bhaul|\btrash\b|\bdebris\b|\bjunk\b|dump.*fee|\bmold\b|\bmildew\b/, 8],
  ],
};

/** Material rules — weaker than the text (a line's materials ride along with its task). */
const MAT_RULES: Record<TradeName, Rule[]> = {
  Plumbing: [
    [/water heater|tankless|hot water tank|anode rod|t.?p valve|expansion tank/, 6],
    [/\bfaucet|\btoilet|shower.?head|p.?trap|garbage disposal|\baerator|supply line|\bvalve|\bpex\b|\bpipe\b|wax ring|flapper|fill valve/, 5],
  ],
  Electrical: [
    [/\boutlet|\bswitch|\bbulb|light fixture|\bwire\b|breaker|\bgfci\b|smoke alarm|smoke detector|co detector/, 5],
  ],
  Carpentry: [
    [/drywall|sheetrock|joint compound|\bmud\b|drywall tape|mesh tape|corner bead|insulation|\bplywood|\bosb\b|\b2x\d/, 6],
    [/\bdoor|\bknob|\bhinge|\bblind|\bscreen\b|\bmirror|\bshelf|\bgasket|weatherstrip/, 5],
  ],
  HVAC: [[/condenser|furnace|\bhvac|thermostat|air filter|furnace filter/, 6]],
  Painting: [[/\bpaint\b|\bprimer\b|spackle|\broller\b/, 3]],
  Flooring: [[/carpet|\blvp\b|laminate|flooring|baseboard|underlayment|\brug\b|cove base|wall base|\broppe\b/, 5]],
  General: [
    [/\bconcrete\b|\bmortar\b|fill dirt|topsoil|\bsoil\b|\bgravel\b|\brock\b|\bmulch\b|landscape|backer rod/, 5],
  ],
};

/** Points per trade for one line (0 = no evidence). */
export function scoreTrades(item: ClassifiableItem): Record<TradeName, number> {
  const s = textOf(item);
  const mats = matsOf(item);
  const out = Object.fromEntries(TRADE_CATEGORY_LIST.map((t) => [t, 0])) as Record<TradeName, number>;
  for (const t of TRADE_CATEGORY_LIST) {
    for (const [re, pts] of TEXT_RULES[t]) if (re.test(s)) out[t] += pts;
    for (const [re, pts] of MAT_RULES[t]) if (re.test(mats)) out[t] += pts;
  }
  // A paint material on a plumbing line is the caulk/touch-up riding along.
  if (out.Plumbing > 0 && out.Painting <= 3) out.Painting = 0;
  // Repaint-only EXTERIOR work (awning / porch / siding / railing touch-up) is
  // Painting however many exterior nouns appear; repair verbs cancel the boost.
  if (/\bpaint\b|repaint|touch.?up/.test(s) &&
      /siding|awning|porch|railing|banister|fence|gate|exterior/.test(s) &&
      !/replace|repair|re.?secure|rebuild|realign|install/.test(s)) out.Painting += 12;
  return out;
}

/** The scorer's best trade and its points (General / 0 when nothing matched). Ties keep list order. */
export function bestTrade(item: ClassifiableItem): { trade: TradeName; score: number } {
  const sc = scoreTrades(item);
  let trade: TradeName = "General";
  let score = 0;
  for (const t of TRADE_CATEGORY_LIST) if (sc[t] > score) { trade = t; score = sc[t]; }
  return { trade, score };
}

/** Minimum points before the scorer may move a line out of a real trade bucket. */
const RESCUE_MIN = 8;

/**
 * Should a line the AI (or an old save) put in `bucket` move to the scorer's
 * best trade? Only with clear evidence: the best trade has ≥ RESCUE_MIN points
 * AND the bucket has none, or the best trade out-scores the bucket by more
 * than double plus a margin (drywall hang + tape + texture in "Painting").
 */
export function rescueTrade(item: ClassifiableItem, bucket: TradeName): TradeName | null {
  const sc = scoreTrades(item);
  const { trade, score } = bestTrade(item);
  if (trade === bucket || score < RESCUE_MIN) return null;
  const own = sc[bucket];
  if (own === 0 || score >= own * 2 + 6) return trade;
  return null;
}

/** The trade bucket a quote line belongs in (see the precedence at the top). */
export function pickTrade(item: ClassifiableItem, bucket: string): string {
  const canon = canonicalName(bucket);
  if (item.userClassified === true && canon) return canon;
  const override = overrideTrade(item);
  if (override) return override;
  if (canon) return rescueTrade(item, canon) ?? canon;
  return bestTrade(item).trade;
}
