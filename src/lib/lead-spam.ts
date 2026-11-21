/**
 * Public lead form spam rules — PURE (tested in lead-spam.test.ts). The
 * /api/leads route runs them in this order:
 *
 *   1. botCheck     — honeypot filled, or sent faster than a person can type
 *                     (< MIN_FILL_MS after the form appeared) → dropped
 *                     silently (the bot is told "ok").
 *   2. rate limits  — lib/rate-limit.ts (per address) + per email, below.
 *   3. classifyLead — vendor pitches (SEO, marketing, "we offer", link
 *                     lists…). "spam" → held for review; "borderline" → the
 *                     AI decides (lib/lead-guard.ts); "ok" → a normal lead.
 *
 * Held submissions never create a lead, alert or text anyone; the owner sees
 * them in Jobs → "Held as possible spam" and can restore one in one tap.
 * Wrong in the safe direction on purpose: a real request that merely
 * mentions a website or Google stays a lead.
 */

/** Faster than this from form shown to submit = a bot. */
export const MIN_FILL_MS = 3000;
/** A start time older than this is a stale/forged stamp, not a slow person. */
const MAX_FILL_MS = 7 * 86_400_000;

export interface Submission {
  name?: string;
  email?: string;
  phone?: string;
  street?: string;
  city?: string;
  description?: string;
}

export type BotVerdict = { bot: false; noTimer: boolean } | { bot: true; why: "honeypot" | "too_fast" };

/**
 * `hp` = the hidden honeypot field; `startedAt` = when the form appeared
 * (ms since epoch, sent by the form). A form that sends no start time (an
 * old cached page, or a script posting straight to the API) isn't dropped;
 * the classifier counts it as one more spam signal instead.
 */
export function botCheck(o: { hp?: unknown; startedAt?: unknown; now?: number }): BotVerdict {
  if (typeof o.hp === "string" ? o.hp.trim() : o.hp) return { bot: true, why: "honeypot" };
  const started = Number(o.startedAt);
  if (!Number.isFinite(started) || started <= 0) return { bot: false, noTimer: true };
  const elapsed = (o.now ?? Date.now()) - started;
  if (elapsed > MAX_FILL_MS || elapsed < -60_000) return { bot: false, noTimer: true }; // clock skew / forged
  if (elapsed < MIN_FILL_MS) return { bot: true, why: "too_fast" };
  return { bot: false, noTimer: false };
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+|\b[a-z0-9-]{2,}\.(?:com|net|org|io|co|biz|info|agency|digital|online|site|xyz|us|in|ae|pk)(?:\/[^\s<>"']*)?\b/gi;

/** Strong pitch phrases: a customer asking for a repair doesn't write these. */
const STRONG: [RegExp, string][] = [
  [/\bwe (?:offer|provide|specialize|specialise|help (?:businesses|companies|contractors|handymen))\b/i, "\"we offer\""],
  [/\bour (?:services|agency|team of experts|company offers|packages|pricing plans?)\b/i, "\"our services\""],
  [/\bseo\b|search engine optimi[sz]ation/i, "SEO"],
  [/\brank(?:ing)? (?:#?1|higher|first|on (?:the )?(?:first page|top)|on google|your (?:website|site|business))|first page (?:of|on) google|top of google|google (?:ranking|first page)/i, "Google ranking"],
  [/\b(?:digital |internet |online )?marketing (?:services|agency|campaign|solutions?|expert)|digital marketing\b/i, "marketing services"],
  [/\bweb(?:site)? (?:design|development|redesign|developer)|(?:re)?design (?:your|a new) website|build (?:you )?a (?:new )?website|app development/i, "web design"],
  [/\blead generation|\bexclusive leads|\bqualified leads|booked (?:jobs|appointments) (?:for|to) you|appointment setting|cold calling/i, "lead generation"],
  [/\bpartnership|\bpartner with (?:you|your)|\bcollaborat(?:e|ion) opportunit/i, "partnership"],
  [/\bback ?links?\b|\bguest post|\blink building|\bdomain authority\b|\bDA\s?\d{2}\b/i, "backlinks"],
  [/\bsocial media (?:management|marketing|manager|presence)|\bgoogle (?:business profile|my business|maps) (?:optimi|ranking|listing services)|\bgmb\b/i, "social / GMB services"],
  [/\b(?:grow|scale) your (?:business|company|revenue)|increase your (?:sales|traffic|leads|revenue|calls|online presence)|more (?:customers|clients|leads) for your business/i, "\"grow your business\""],
  [/\bvirtual assistants?\b|\boutsourc(?:e|ing)\b|\boffshore (?:team|staff)/i, "outsourcing"],
  [/\bbusiness (?:loan|funding|financing)|\bmerchant (?:services|cash advance)|\bcredit card processing|\bworking capital\b/i, "financing pitch"],
  [/\b(?:i|we) (?:came across|found|noticed|visited|checked) your (?:website|site|business|listing|profile)|\byour website (?:is|has|could|needs|isn'?t)/i, "\"I came across your website\""],
  [/\bdear (?:business )?owner\b|\bhi (?:business owner|there,? i'?m)|\bto whom it may concern\b/i, "cold-email opener"],
  [/\bunsubscribe\b|\breply (?:stop|"?no"?) to (?:opt|stop)|\bif you(?:'re| are) not interested\b/i, "unsubscribe line"],
  [/\bfree (?:audit|seo|website (?:audit|analysis)|marketing (?:audit|consultation))|\bno[- ]obligation (?:audit|proposal)/i, "free audit offer"],
  [/\b(?:per|a|\/)\s?month\b.*\b(?:package|plan|service)|\$\d+\s?(?:\/|per)\s?(?:mo|month)\b/i, "monthly pricing"],
  [/\b(?:google|yelp|5[- ]star) reviews? (?:for|to) your|\bboost your reviews\b|\bbuy reviews\b/i, "reviews service"],
];

/** Weak hints: fine alone, add up with others. */
const WEAK: [RegExp, string][] = [
  [/\bwebsite\b/i, "mentions a website"],
  [/\bbusiness owner\b|\byour business\b|\byour company\b/i, "talks about \"your business\""],
  [/\bclients\b|\bROI\b|\bconversion/i, "sales language"],
  [/\bcontact me\b|\blet me know if you(?:'re| are) interested\b|\bschedule a (?:quick )?call\b|\bbook a (?:quick )?call\b|\bquick call\b/i, "asks for a sales call"],
];

/** Words of a real repair request: they pull the score down. */
const JOB_WORDS = /\b(?:fix|repair|install|replace|leak(?:s|ing|y)?|drip(?:s|ping)?|broken|door|drywall|paint(?:ing)?|fence|faucet|toilet|sink|deck|ceiling|cabinet|window|gutter|hang|mount|tile|outlet|switch|light fixture|ceiling fan|caulk|grout|trim|baseboard|shelf|shelves|disposal|garage|roof|siding|patio|stairs?|railing|hole|crack|water heater|smoke detector|blinds|tv|furniture|assemble|pressure wash|tenant|rental|move[- ]out|turnover|bathroom|kitchen|basement|closet)\b/gi;

/** Company-ish names on a "customer" request. */
const COMPANY_NAME = /\b(?:llc|inc|ltd|agency|solutions|media|marketing|digital|seo|technologies|tech|consulting|consultants|studio|labs|group)\b/i;

export interface SpamResult {
  score: number;
  verdict: "ok" | "borderline" | "spam";
  reasons: string[];
  urls: number;
}

/** Score ≥ SPAM_AT = held; BORDERLINE_AT..SPAM_AT-1 = the AI decides. */
export const SPAM_AT = 5;
export const BORDERLINE_AT = 2;

export function classifyLead(s: Submission, o: { noTimer?: boolean } = {}): SpamResult {
  const text = `${s.description || ""}`.slice(0, 6000);
  const all = `${s.name || ""}\n${text}`;
  const reasons: string[] = [];
  let score = 0;

  const urls = (text.match(URL_RE) || []).length;
  if (urls >= 2) { score += 3; reasons.push(`${urls} links`); }
  else if (urls === 1) { score += 1; reasons.push("a link"); }

  let strong = 0;
  for (const [re, label] of STRONG) {
    if (re.test(all)) { strong++; reasons.push(label); }
  }
  score += Math.min(strong, 4) * 3;

  for (const [re, label] of WEAK) {
    if (re.test(all)) { score += 1; reasons.push(label); }
  }

  if (COMPANY_NAME.test(s.name || "")) { score += 2; reasons.push("company name"); }
  if (/@(?:[a-z0-9-]+\.)*(?:agency|digital|marketing|seo)[a-z0-9-]*\./i.test(s.email || "")) { score += 2; reasons.push("marketing email domain"); }
  if (!s.street && !s.city) { score += 1; reasons.push("no address"); }
  if (o.noTimer) { score += 1; reasons.push("no form timer"); }
  if (text.length > 1200) { score += 1; reasons.push("very long message"); }

  // A real job request: every repair word counts down (to −3), but never
  // cancels a link list or a stack of pitch phrases on its own.
  const jobHits = new Set((text.match(JOB_WORDS) || []).map((w) => w.toLowerCase())).size;
  const relief = Math.min(jobHits, 3);
  if (relief) { score -= relief; reasons.push(`${jobHits} repair word${jobHits === 1 ? "" : "s"} (−${relief})`); }

  const verdict: SpamResult["verdict"] = score >= SPAM_AT ? "spam" : score >= BORDERLINE_AT ? "borderline" : "ok";
  return { score, verdict, reasons, urls };
}

/** What the AI is asked for a borderline submission (lib/lead-guard.ts). */
export function aiPrompt(s: Submission): string {
  return [
    "A handyman / home-repair business got this through the \"request a quote\" form on its website.",
    "Decide: is it a REAL request for work from a customer or property manager (job), or a vendor / marketer / salesperson pitching their own product or service to the business (solicitation)?",
    "Pitches include SEO, marketing, web design, leads, reviews, financing, software, outsourcing, partnerships and link lists. A customer who mentions their own website or Google is still a job.",
    'Answer with JSON only: {"verdict":"job"|"solicitation","reason":"<10 words"}',
    "",
    `Name: ${(s.name || "").slice(0, 120)}`,
    `Email: ${(s.email || "").slice(0, 120)}`,
    `Address given: ${s.street || s.city ? "yes" : "no"}`,
    "Message:",
    (s.description || "").slice(0, 3000),
  ].join("\n");
}

/** The AI's answer → "job" | "solicitation" | null (unreadable = undecided). */
export function readAiVerdict(text: string): { verdict: "job" | "solicitation"; reason: string } | null {
  const m = (text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { verdict?: string; reason?: string };
    if (j.verdict !== "job" && j.verdict !== "solicitation") return null;
    return { verdict: j.verdict, reason: String(j.reason || "").slice(0, 120) };
  } catch {
    return null;
  }
}

/** Per-email cap (on top of the per-address limits): a person sends one or two. */
export const EMAIL_LIMITS = { perHour: 3, perDay: 6 };

export function emailVerdict(c: { hour: number; day: number }): boolean {
  return c.hour < EMAIL_LIMITS.perHour && c.day < EMAIL_LIMITS.perDay;
}
