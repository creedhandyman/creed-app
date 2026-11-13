// Creed App — "is this line plumbing work?" for the quote's trade buckets.
//
// Why this exists: on a real walkthrough quote (2026-11-13) the AI put
// "Replace two shower valves" under CARPENTRY. validateQuote respects the
// AI's bucket whenever it's one of the 7 canonical trades, and the framing /
// demo overrides send anything that mentions studs, framing or removing
// drywall to Carpentry — so a valve swap that opens the wall for access could
// never be rescued. The customer saw plumbing under Carpentry on site.
//
// Rule: when a line's TASK (the detail after "Location —") names a plumbing
// fixture or part — shower/tub valve, valve kit or cartridge, faucet, supply
// line, shut-off / angle stop, toilet, sink/tub/shower drain, P-trap, PEX,
// SharkBite — it is PLUMBING, even when it also mentions the wall, access
// panel, drywall or framing that the valve work needs. validateQuote runs
// this right after the countertop and flooring overrides and before the
// framing / window / caulk / paint / demo ones.
//
// Deliberately NOT plumbing (returns false, so the existing rules decide):
//   - follow-on lines whose task STARTS with patch / drywall / texture /
//     paint / tile / grout / caulk / clean ("Patch drywall where the shower
//     valve was accessed" is the Carpentry half of a rule-5a split);
//   - bath accessories near a fixture (grab bar by the toilet, toilet paper
//     holder, towel bar, mirror, medicine cabinet, shower rod/curtain/door);
//   - cabinet / countertop / vanity-cabinet lines (sink + faucet reset
//     travels with the countertop under Carpentry per the prompt);
//   - electrical items near a fixture (light over the sink, exhaust fan by
//     the toilet, GFCI);
//   - only the LOCATION mentions a fixture ("Toilet Room — Replace door").
// The text checked is the line's detail only — inspector comments mention
// fixtures in passing ("door rubs against toilet") and would misroute.

const PLUMBING_PART = [
  // Valves by kind: shower/tub mixing valves, shut-offs, supply stops, toilet fill/flush.
  /\b(?:shower|tub|bath(?:tub)?|mixing|diverter|pressure[\s-]*balanc\w*|thermostatic|anti[\s-]*scald|shut[\s-]*off|stop|angle(?:[\s-]*stop)?|supply|water|main|fill|flush|hose[\s-]*bibb?|sillcock)\s+valves?\b/,
  // "Replace shower and tub valves", "two shower/tub valves".
  /\b(?:shower|tub)\s*(?:\/|and|&|or)\s*(?:shower|tub)\s+valves?\b/,
  /\bvalve\s+(?:cartridges?|kits?|stems?|bod(?:y|ies)|trim|rough[\s-]*ins?|replacement)\b/,
  /\b(?:shower|tub|faucet|valve)\s+cartridges?\b/,
  /\bangle\s+stops?\b/,
  /\bfaucets?\b/,
  /\btoilets?\b/,
  /\bsupply\s+(?:lines?|hoses?|tubes?)\b/,
  /\bshut[\s-]*offs?\b/,
  /\bpex\b/,
  /\bshark[\s-]*bites?\b/,
  /\bp[\s-]*traps?\b/,
  /\bwax\s+rings?\b/,
  /\b(?:sink|tub|shower|lav(?:atory)?|kitchen|bathroom)\s+drains?\b/,
  /\btub\s+spouts?\b/,
  /\bshower\s*heads?\b/,
];

/** Task starts with follow-on finish work → not the plumbing line itself. */
const FINISH_LEAD = /^(?:patch|repair\s+drywall|drywall|hang\s+drywall|texture|tape|mud|paint|repaint|prime|tile|retile|re-tile|grout|regrout|re-grout|caulk|re-?caulk|clean|haul)\b/;

const ACCESSORY = /grab[\s-]*bars?|towel[\s-]*(?:bars?|rings?|racks?|hooks?)|toilet[\s-]*(?:paper|tissue|roll)|tissue[\s-]*holder|\btp[\s-]*holder|medicine[\s-]*cabinet|\bmirrors?\b|shower[\s-]*(?:rods?|curtains?|doors?|enclosures?)|curtain[\s-]*rods?/;

const CARPENTRY_CASEWORK = /\bcabinets?\b|counter[\s-]*tops?|vanity\s+(?:cabinet|top|base)/;

const ELECTRICAL_NEAR = /\blights?\b|light\s+fixture|\bexhaust\s+fan|\bfans?\b|\boutlets?\b|\bgfci\b|\bswitch(?:es)?\b|smoke\s+(?:alarm|detector)/;

/** The task part of a detail: text after the first "—" (or " - "), else the whole detail. */
function taskText(detail: string): string {
  const d = (detail || "").toLowerCase();
  const em = d.indexOf("—");
  if (em >= 0) return d.slice(em + 1).trim();
  const dash = d.indexOf(" - ");
  if (dash >= 0) return d.slice(dash + 3).trim();
  return d.trim();
}

/** True when a quote line's task is plumbing work and must sit under Plumbing. */
export function isPlumbingWork(detail: string): boolean {
  const task = taskText(detail);
  if (!task) return false;
  if (FINISH_LEAD.test(task)) return false;
  if (ACCESSORY.test(task) || CARPENTRY_CASEWORK.test(task) || ELECTRICAL_NEAR.test(task)) return false;
  return PLUMBING_PART.some((re) => re.test(task));
}
