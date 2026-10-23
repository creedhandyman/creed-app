/* Spoken measurements → the inspection size boxes.

   Voice Walk transcripts often carry the size ("bedroom's about twelve by
   fourteen", "six foot privacy fence, about 120 feet long"), but only the
   AI item notes kept it — the W × L boxes stayed empty, so the quote fell
   back to an ESTIMATED room size. This pulls the size out of the text with
   plain rules (no AI call, nothing to pay for). Callers only fill boxes
   that are still empty, so a typed size always wins. */

export interface SpokenDims {
  /** Room: width (ft). Fence: HEIGHT (ft) — same box as the size card. */
  width?: number;
  /** Room: length (ft). Fence: run length (ft). */
  length?: number;
  /** Floor area when only "N square feet" was said. */
  sqft?: number;
}

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** "one hundred twenty" → "120", "twelve and a half" → "12.5", "six-foot" → "6 foot". */
export function wordsToDigits(text: string): string {
  const s = ` ${text.toLowerCase().replace(/(\d),(\d{3})/g, "$1$2").replace(/-/g, " ")} `;
  const tokens = s.split(/(\s+)/);
  const out: string[] = [];
  let acc: number | null = null;
  let pendingSpace = "";
  const flush = () => {
    if (acc != null) { out.push(String(acc)); acc = null; }
    if (pendingSpace) { out.push(pendingSpace); pendingSpace = ""; }
  };
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (/^\s+$/.test(tk)) { if (acc != null) pendingSpace = tk; else out.push(tk); continue; }
    const w = tk.replace(/[^a-z]/g, "");
    if (w in ONES || w in TENS) {
      const v = w in ONES ? ONES[w] : TENS[w];
      acc = acc == null ? v : (acc % 100 === 0 || (acc >= 20 && acc % 10 === 0 && v < 10)) ? acc + v : v;
      pendingSpace = "";
      continue;
    }
    if (w === "hundred" && acc != null) { acc *= 100; pendingSpace = ""; continue; }
    if (w === "hundred" && acc == null) { acc = 100; continue; }
    flush();
    out.push(tk);
  }
  flush();
  return out.join("")
    .replace(/(\d+)\s+and\s+(?:a\s+)?half\b/g, (_, n) => String(Number(n) + 0.5))
    .replace(/(\d+)\s+(?:and\s+)?a\s+half\b/g, (_, n) => String(Number(n) + 0.5))
    .replace(/\s+/g, " ")
    .trim();
}

const FT = String.raw`(?:feet|foot|ft\.?|')`;
const NUM = String.raw`(\d+(?:\.\d+)?)`;
/** A length: "12", "12 feet", "12 ft 6 in", "12'6\"". Returns feet. */
const LEN = String.raw`${NUM}\s*${FT}?(?:\s*(\d{1,2})\s*(?:inches|inch|in\.?|"))?`;

const toFeet = (ft: string, inch?: string) => {
  const v = Number(ft) + (inch ? Number(inch) / 12 : 0);
  return Math.round(v * 10) / 10;
};
const sane = (v: number, max: number) => v > 0 && v <= max;
/** Lumber / tile / board sizes ("2 by 4", "4 x 8 sheet", "12 by 24 tile") — not a room or a run. */
const LUMBER_AFTER = /^\s*(?:s\b|'s\b)?\s*(?:boards?|lumber|studs?|rails?|sheets?|plywood|tiles?|pickets?|posts?|joists?|framing|trim|pavers?|blocks?)/;
/** First "A by B" whose words after it don't make it a material size. */
function bySize(s: string): RegExpMatchArray | null {
  const re = new RegExp(String.raw`${LEN}\s*(?:by|x|×)\s*${LEN}`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const after = s.slice(m.index + m[0].length);
    if (!LUMBER_AFTER.test(after)) return m;
  }
  return null;
}

/** Pull a size out of a spoken description. null = nothing usable. */
export function spokenDims(text: string, kind: "room" | "fence" = "room"): SpokenDims | null {
  if (!text || !text.trim()) return null;
  const s = wordsToDigits(text);

  if (kind === "fence") {
    const out: SpokenDims = {};
    // Height: "6 foot tall", "6 ft high", "6 foot privacy fence", "6 foot fence"
    const h = s.match(new RegExp(String.raw`${NUM}\s*${FT}\s*(?:tall|high|privacy|wood|cedar|chain|vinyl|picket|fence)`));
    if (h && sane(Number(h[1]), 12)) out.width = Number(h[1]);
    // Length: "120 feet long", "120 linear feet", "120 feet of fence", "run is 120 feet"
    const l = s.match(new RegExp(String.raw`${NUM}\s*(?:linear\s*)?${FT}\s*(?:long|of\s+fence|of\s+fencing|run|section|stretch)`))
      || s.match(new RegExp(String.raw`${NUM}\s*linear`))
      || s.match(new RegExp(String.raw`(?:run|length|stretch|section)\s*(?:is|of|about|around|roughly)?\s*(?:about|around|roughly)?\s*${NUM}\s*${FT}?`));
    if (l && sane(Number(l[1]), 2000) && Number(l[1]) !== out.width) out.length = Number(l[1]);
    // "120 by 6" — the longer side is the run, the shorter the height.
    if (out.length == null || out.width == null) {
      const by = bySize(s);
      if (by) {
        const a = toFeet(by[1], by[2]), b = toFeet(by[3], by[4]);
        const run = Math.max(a, b), ht = Math.min(a, b);
        if (out.length == null && run >= 8 && sane(run, 2000)) out.length = run;
        if (out.width == null && ht >= 3 && sane(ht, 12)) out.width = ht;
      }
    }
    return out.width != null || out.length != null ? out : null;
  }

  // Room: "12 by 14", "12 x 14", "12 feet by 14 feet", "12'6\" by 10".
  const by = bySize(s);
  if (by) {
    const w = toFeet(by[1], by[2]), l = toFeet(by[3], by[4]);
    // A room side under 3 ft is a closet shelf or a material size, not a room.
    if (w >= 3 && l >= 3 && sane(w, 200) && sane(l, 200)) return { width: w, length: l };
  }
  const sq = s.match(new RegExp(String.raw`${NUM}\s*(?:square\s*(?:feet|foot|ft)|sq\.?\s*(?:ft|feet)|sf\b)`));
  if (sq && sane(Number(sq[1]), 20000)) return { sqft: Number(sq[1]) };
  return null;
}
