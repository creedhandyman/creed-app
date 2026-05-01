import type { Room, RoomItem, Material, InspectionRoom } from "./types";
import { db, supabase } from "./supabase";
import { MATERIALS_DB } from "./materials-db";

/* ====== PDF LOADING ====== */

declare global {
  interface Window {
    pdfjsLib: {
      GlobalWorkerOptions: { workerSrc: string };
      getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<PDFDoc> };
    };
  }
}

interface PDFDoc {
  numPages: number;
  getPage: (n: number) => Promise<PDFPage>;
}

interface PDFPage {
  getTextContent: () => Promise<{
    items: { transform: number[]; str: string }[];
  }>;
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
}

export async function loadPdf(): Promise<typeof window.pdfjsLib> {
  if (window.pdfjsLib) return window.pdfjsLib;
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      res(window.pdfjsLib);
    };
    s.onerror = () => rej(new Error("Failed to load PDF library"));
    document.head.appendChild(s);
    // Timeout after 15 seconds
    setTimeout(() => rej(new Error("PDF library load timed out")), 15000);
  });
}

export async function readPdf(file: File): Promise<string> {
  const lib = await loadPdf();
  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: buf }).promise;
  let txt = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    const c = await pg.getTextContent();
    const byY: Record<number, { x: number; s: string }[]> = {};
    c.items.forEach((it) => {
      const y = Math.round(it.transform[5]);
      if (!byY[y]) byY[y] = [];
      byY[y].push({ x: it.transform[4], s: it.str });
    });
    Object.keys(byY)
      .map(Number)
      .sort((a, b) => b - a)
      .forEach((y) => {
        const l = byY[y]
          .sort((a, b) => a.x - b.x)
          .map((x) => x.s)
          .join(" ")
          .trim();
        if (l) txt += l + "\n";
      });
    txt += "\n";
  }
  return txt;
}

/* ====== PDF PAGE RENDERING ====== */

// Upload a base64 `data:` URI to the public `receipts` bucket and return a
// fetchable HTTPS URL. Used to swap inline base64 images for URL-sourced
// images on the AI call so we dodge Vercel's 4.5 MB serverless body limit
// and can ship every page of a long inspection PDF in one request. Falls
// back to null on any failure — the caller should keep the original data
// URI and let the (smaller) base64 path handle it.
//
// Note: these uploads are ephemeral by intent — orphans accumulate under
// `ai-renders/` and can be swept by a periodic cleanup job. For Bernard's
// scale (a handful of PDFs/day) the storage cost is rounding-error.
export async function uploadDataUriToBucket(dataUri: string): Promise<string | null> {
  try {
    const match = dataUri.match(/^data:(image\/[\w+]+);base64,(.+)$/);
    if (!match) return null;
    const [, mime, b64] = match;
    const ext = mime.split("/")[1].split("+")[0]; // "jpeg" from "image/jpeg"
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: mime });
    const path = `ai-renders/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("receipts").upload(path, blob);
    if (error) return null;
    const { data } = supabase.storage.from("receipts").getPublicUrl(path);
    return data?.publicUrl || null;
  } catch {
    return null;
  }
}

export async function renderPdfPages(
  file: File,
  maxPages = 15,
  scale = 1.0,
  onProgress?: (rendered: number, total: number) => void
): Promise<string[]> {
  const lib = await loadPdf();
  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: buf }).promise;
  const images: string[] = [];
  const count = Math.min(pdf.numPages, maxPages);
  const MAX_DIM = 1200; // cap page dimensions for API size limits

  for (let i = 1; i <= count; i++) {
    const page = await pdf.getPage(i);
    let viewport = page.getViewport({ scale });

    // Downscale if page is too large
    if (viewport.width > MAX_DIM || viewport.height > MAX_DIM) {
      const ratio = Math.min(MAX_DIM / viewport.width, MAX_DIM / viewport.height);
      viewport = page.getViewport({ scale: scale * ratio });
    }

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL("image/jpeg", 0.4));
    canvas.remove();
    onProgress?.(i, count);
  }
  return images;
}

/* ====== AI PARSE ====== */

/**
 * Canonical list of trade-bucket names. The single ordering used by:
 *  - validateQuote's classifier (drops the per-function const that drifted)
 *  - QuoteForge's manual Add Item form (Trade dropdown)
 *  - AI prompt category names
 * Keep this and TRADE_CATEGORIES_PROMPT below in sync — adding a bucket
 * here means describing it in the prompt too.
 */
export const TRADE_CATEGORY_LIST = ["Painting", "Flooring", "Carpentry", "Plumbing", "Electrical", "Safety", "Appliances", "Exterior", "Compliance", "Cleaning/Hauling"] as const;

/**
 * Source-of-truth trade-categorization rules. Used by BOTH the inspection
 * parser (AI_SYSTEM_PROMPT_BASE) and the AI Assist Add flow in QuoteForge.
 * Anything that bins a line item into a trade bucket reads from here so
 * the rules can't drift between code paths. Bernard hit drift in real
 * quotes (interior framing landing in Exterior, caulking landing in
 * Cleaning/Hauling) when AI Assist had its own miniature one-line system
 * prompt that didn't carry these rules.
 */
export const TRADE_CATEGORIES_PROMPT = `- PAINTING: paint, primer, spackle, mesh tape, painter's tape, drop cloths, brushes, rollers, drywall patch, drywall mud + tape + finish prep, AND all caulking and sealant work (interior trim, baseboard, window, tub/shower bead, kitchen backsplash bead — every caulk line goes here unless it's a plumbing fixture replacement that explicitly includes the bead). No knobs, no fixtures, no blinds.
- FLOORING: LVP, carpet, tile, grout, cove base, transition strips, baseboards (sqft-priced).
- CARPENTRY: doors, knobs, locks, deadbolts, hinges, blinds, curtains, curtain rods, mirrors, medicine cabinets, cabinets, drawers, countertops (laminate/butcher block/quartz/granite/solid surface — including demo, template, install, sink/faucet reset, edge profile), interior framing and re-framing (studs, blocking, headers, joists), shower wall framing and shower-pan blocking, drywall blocking for grab bars / cabinets / TVs, structural sistering, window screens, window panes, window glass, closet rods/shelving. Demo of carpentry items (rotted framing, old cabinets, old countertops) when it's labor-hours work goes here too — only the actual disposal/dump fee belongs under Cleaning/Hauling.
- PLUMBING: faucets, toilets, tubs, sinks, drains, stoppers, aerators, valves, supply lines, dryer vents.
- ELECTRICAL: outlets, switches, switch/outlet plates, light fixtures, bulbs, light covers, ceiling fans (electrical).
- APPLIANCES: refrigerator, oven, stove, dishwasher, microwave, washer, dryer parts. NEVER condensers or HVAC parts.
- SAFETY: smoke alarms, CO detectors, fire extinguishers.
- COMPLIANCE: water heater, HVAC filters, breaker panel inspection, doorbell, thermostat.
- EXTERIOR: ONLY work physically on the exterior of the building — siding, roof, soffit, fascia, exterior trim, gutters, downspouts, fence, gates, exterior lights, exterior paint, landscaping, driveway/concrete repair, walkways, porches, decks. Interior structural work (interior framing, drywall, shower walls, bathroom re-framing) is NEVER Exterior — it's Carpentry. The test: if the worker is standing inside the unit doing the work, it's not Exterior.
- CLEANING/HAULING: ONLY debris removal, disposal/dump fees, final cleaning, interior trash-out (belongings left in unit), appliance deep clean. NEVER caulking. NEVER labor hours for demo, prep, or finish work — those belong with their trade. A line item like "demo and haul-away" should be SPLIT: the demo labor goes to the trade doing the demo (Carpentry for framing/cabinets/counters, Flooring for floor tear-out, Plumbing for fixture pull, etc.), and only the disposal portion (dump fee, debris bags, hauling time) lands in Cleaning/Hauling.
A door knob NEVER goes in Painting. A ceiling light NEVER goes in Flooring. A water heater NEVER goes in Electrical. A countertop NEVER goes in Flooring — countertops travel with cabinets under CARPENTRY. Interior framing is NEVER Exterior — it's Carpentry. Caulking is NEVER Cleaning/Hauling — it's Painting.`;

export const AI_SYSTEM_PROMPT_BASE = `You are a service estimate generator for a field service contractor. You produce accurate, client-ready service estimates from whatever the user provides.

## INPUT TYPES
You accept TWO input types — detect which you're looking at and parse accordingly:

TYPE A — Property inspection report (zInspector or similar): room-by-room findings with condition ratings (S=Satisfactory, F=Fair, P=Poor, D=Damaged) and "Maintenance" action markers. Apply ALL rules below (dedup summary tables, group by trade, etc.).

TYPE B — Anything else: free-form scopes, existing quotes/estimates, line-item tables with sizes/qty/prices, photo-only requests, etc. SKIP the inspection-specific rules (no S/F/P/D filtering, no "Maintenance" marker, no summary-table dedup).

For TYPE B inputs, follow these rules in order:

1. CONDITION = "-". All TYPE B line items use condition: "-". S/F/P/D is reserved for inspection findings.

2. USE STATED VALUES VERBATIM. If the input gives a unit price ($X/window), a quantity (16 windows), or a labor cost ($Y), preserve those exactly. The user has already priced this — don't substitute reference values.

3. LABOR DOLLARS → CLOCK HOURS. When labor is stated as a dollar amount (e.g. "Labor: $4400" or "16 × $275 = $4400"), convert to clock hours via cost / hourly_rate. Set crewSize: 1 unless the task obviously requires 2+ people. The pricing layer multiplies clock hours × crewSize × rate.

4. CONSOLIDATE LIKE-SCOPE WORK. A multi-unit project should be ONE line item per trade, not one per unit. Sum quantities and totals in the materials field; use the comment to break down the units.

5. FALL BACK TO REFERENCE TABLES only for missing values. If a task is described without a price, use the materials table. If labor isn't stated and the task type isn't in the reference, estimate conservatively.

6. NEVER return rooms:[] for input with ANY quotable work. One identifiable task = at least one line item. Empty rooms is reserved for genuinely empty input (blank text + no images).

WORKED EXAMPLE (TYPE B, $55/hr labor rate):
Input: "TRIPLEX WINDOWS — 16 vinyl windows. Bedroom 41x51 (qty 9 @ $375), Bedroom odd 48x50 (qty 1 @ $375), Living Room 58x80 (qty 3 @ $475), Kitchen 33x42.5 (qty 3 @ $300). Materials $6075. Labor 16 × $275 = $4400. Grand Total $10475."

Expected output:
{
  "property": "Triplex",
  "client": "",
  "rooms": [{
    "name": "Carpentry",
    "items": [{
      "detail": "Triplex — Replace 16 vinyl windows",
      "condition": "-",
      "comment": "All vinyl replacements. 9 bedroom 41x51 + 1 odd 48x50, 3 living room 58x80, 3 kitchen 33x42.5. Sizes may require custom order or rough opening modification.",
      "laborHrs": 80,
      "materials": [
        {"n": "Bedroom window 41x51 vinyl", "qty": 9, "unitPrice": 375, "c": 3375},
        {"n": "Bedroom window 48x50 vinyl (odd size)", "qty": 1, "unitPrice": 375, "c": 375},
        {"n": "Living Room window 58x80 vinyl", "qty": 3, "unitPrice": 475, "c": 1425},
        {"n": "Kitchen window 33x42.5 vinyl", "qty": 3, "unitPrice": 300, "c": 900}
      ]
    }]
  }],
  "notes": ["Sizes may require custom order; final material pricing to be confirmed."],
  "crewSize": 1,
  "estDays": 4
}

Note: $4400 labor / $55/hr = 80 clock hours. Materials sum to exactly $6075. crewSize=1 so the math layer doesn't double the labor.

## CRITICAL RULE — DEDUPLICATION (TYPE A ONLY)
zInspector reports contain the SAME data TWICE:
- SUMMARY TABLE (early pages): Has "Area" + "Detail" + "Condition" columns in a table. SKIP THIS ENTIRELY.
- DETAILED BREAKDOWNS (later pages): Room names as section headers with expanded descriptions. USE ONLY THIS.
If you process both, every item will be doubled. The final quote should have 20-40 line items, NOT 60-100+.

## LINE ITEM FORMAT
Every line item MUST include:
- "detail": "Room Name — Brief task description" (e.g. "Kitchen — Replace sprayer and re-caulk sink")
- "comment": Clear 1-2 sentence work description referencing the inspection finding. The client must understand WHAT will be done.
- "laborHrs": Conservative clock hours for one worker
- "materials": Array of { "n": name, "c": line_total, "qty": optional_quantity, "unitPrice": optional_per_unit_cost }

MATERIAL FIELDS — populate qty + unitPrice whenever you know them:
- Single item ("1 faucet, $55"): { "n": "Kitchen faucet", "c": 55, "qty": 1, "unitPrice": 55 }
- Multiple identical items ("4 caulk tubes @ $5 ea"): { "n": "Caulk tube", "c": 20, "qty": 4, "unitPrice": 5 }
- Lump sum (sqft-based, supplies, etc.): qty/unitPrice optional. Just "c": 990 is fine.
ALWAYS keep c = qty × unitPrice when you set both.

## RULES

1. NEVER INSERT PLACEHOLDER ITEMS. Every material must map to a specific inspection finding. If you cannot trace a material back to the report, do not include it. Watch especially for high-cost items appearing in multiple rooms — that is always a bug.

2. NO DUPLICATES. Each repair appears exactly ONCE. Do NOT create both granular items and consolidated room summaries.

3. CONSISTENT ROOM NAMES. Use title case. Normalize names from the inspection (e.g. "Bathroom 2 : Master bathroom" → "Bathroom 2 (Master)").

4. GROUP BY TRADE, NOT BY ROOM. Valid categories:
   Painting, Flooring, Carpentry, Plumbing, Electrical, Safety, Appliances, Exterior, Compliance, Cleaning/Hauling

5. COMBINE RELATED ITEMS in the same room. "Replace outlet cover" + "replace switch plate" in Kitchen = one Electrical line item. "Touch up wall paint" + "patch holes" = one Painting line item.

6. SHARED SUPPLIES ONCE. Paint rollers, tape, drop cloths, brushes, spackle go in ONE "General Supplies" item under Painting, NOT duplicated per room.

7. ONLY QUOTE MAINTENANCE ITEMS. Skip a row ONLY when BOTH condition is "S" AND action is "None". A row with condition P / F / D is still a maintenance item even if the inspector mistakenly wrote "Action: None" — the CONDITION RATING IS AUTHORITATIVE. Inspectors occasionally tag a damaged item with action None by mistake (e.g. Driveway/Floor — P — None — "Cracked driveway throughout, repairs needed"). Do not let that drop the line — quote it from the comment.

8. ENUMERATE EVERY DISTINCT ISSUE inside a comment. Inspection cells routinely chain multiple separate repairs in one cell, separated by periods, semicolons, "and", or commas. Each is a distinct repair you must scope. Walk the comment sentence by sentence — if there are 4 sentences describing 4 issues, you owe 4 line items (or one line with 4 materials, whichever fits the trade). The fact that the inspector wrote them in one cell is shorthand; you must un-shorthand it.
- Example: "All blinds missing, four 28x64 needed. Broken window pane, needs replacement." → blinds (qty 4) AND a window pane material. Never just the blinds.
- Example: "Replace entry door, deadbolt, and lock" → THREE materials: 36" pre-hung door, deadbolt set, lock cylinder. Never just the deadbolt.
- Example: "Cabinet doors falling apart, countertop rough and worn, water damage, leak present, leftover items" → 5 separate scoped items: cabinet door repair, countertop refinish/replace, water-damage assessment, under-sink leak repair, trash-out.
- Example: "Handle missing. Front glass fallen off. Stove piece missing. Loose detached part requiring reattachment." → 4 materials/labor lines, not 2.
- Example: "Cracked switch cover, outlet AND doorbell missing, switch possibly blown out." → switch cover + new outlet + new doorbell + replacement switch. Four parts, not one.
The dropped item is almost always sentence #2 or later, or the second clause after "and". Re-read the comment AFTER you draft your line items and confirm every distinct repair is represented.

## COMMON ERRORS — read these every time before generating output

These are real bugs from past inspection-to-quote runs. AVOID each one.

### A. Wording traps — read the comment word for word
- "Toilet paper holder missing" → replace ONLY the TP holder (~$12). NOT a new toilet.
- "Closet curtain rod" / "closet pole" → CARPENTRY hardware. NOT a shower rod, NOT plumbing.
- "Sink stopper missing" / "aerator slow" / "diverter clogged" → replace stopper (~$15) or aerator (~$5). NOT a new $65 faucet.
- "Sink clogged" / "tub clogged" → labor only to clear blockage. No new fixture.
- "Hot Water Tank — S — None" → Status SATISFACTORY + Action NONE = nothing to do. Skip the row. NEVER add a water heater for an S row.
- "Breaker Box — referenced for inspection" → walk-by inspection only. No replacement parts.
- "Garage door fallen off, needs reattachment, track repair, tension spring rewinding" → REPAIR. Track hardware (~$30) + tension spring (~$35) + labor. NOT a new $800 garage door.
- "Stove burners missing, drip pans, deep clean" → replace drip pans + cleaning. NEVER add a "condenser" — condensers are HVAC, not appliances.
- "New entry knob, no key present" → entry knob (~$20). NOT a smart deadbolt unless explicitly requested.

### B. Repair vs. replace — different cost shapes
- REPAIR words: fix, repair, tighten, reattach, clear, reinstall, service, patch, touch up, adjust, replace [part]. Cost: small material + labor.
- REPLACE words: install new, replace [whole unit], new [unit] needed. Cost: full unit cost + labor.
"Needs new striker plate for deadbolt" = replace striker plate ($5), NOT replace deadbolt. "Needs reinstalling" = labor only. Read every word before pricing.
- SEVERITY WORDS upgrade the fix shape. "Severe", "major", "massive", "completely [verb]", "immediate" = the small-scope fix is insufficient. "Severe roof leak above bathroom, ceiling texture missing" → drywall replacement above + paint, NOT just $12 of texture compound. "Major leak at the faucet" → new faucet, NOT a $5 aerator. "Massive ceiling crack" → drywall repair + skim coat, not just paint.
- SEVERITY WORDS OVERRIDE the wording-trap rules in section A. If "major", "severe", "massive", or "immediate" appears in the same comment as a fixture, do NOT apply the small-fix trap from section A even when a trap-keyword (aerator, stopper, clogged, diverter) is also present. The severity word is the dominant signal. Example: "Major leak at the faucet" overrides the "aerator slow → $5 aerator" trap and quotes a new faucet (~$55). "Severe clog" / "severe blockage" → snake + camera inspection labor + possible repair, not just a $0 labor unblock.
- REPLACEMENT SIGNALS (treat as REPLACE, full unit cost): "very old", "outdated", "recommended to be replaced", "old and recommended", "beyond repair", "rotted out", "falling apart", "completely [rotted/stained/worn/destroyed]". "Window old and recommended to be replaced" → new vinyl window, NOT a repair kit + caulk. "Vanity completely rotted out" → new vanity (already handled correctly — apply same logic to other items).

### C. Count from explicit numbers
Inspection comments give exact quantities. Use them verbatim:
- "four 27 by 64 inch blinds" → qty: 4
- "two 23x64 inch blinds needed" → qty: 2
- "three knobs missing" → qty: 3
- "two missing window panes" → qty: 2
SUM these across all rooms when totalling materials. Don't multiply, don't undercount.

### D. Single-of-a-thing items
A typical SFH has ONE of these. Don't duplicate them based on related-keyword matches:
- 1 toilet per bathroom row in inspection. "Toilet paper holder missing" does NOT mean 2 toilets.
- 1 garage door per garage row.
- 1 thermostat, 1 doorbell, 1 water heater, 1 breaker panel total.
- 1 of any item that the inspection mentions exactly once.

### E. Smoke alarms = count of explicit findings
Count = number of rooms whose Smoke Alarm row has condition D or P AND comment says "no smoke alarm" / "install" / "missing." Add 1-2 for hallway/CO if mentioned. Typical 3-bed = 3-5 total. Anything ≥ 7 means you're double-counting — recount.

### F. Paint math (per house, NOT per room × N)
For a make-ready job, supplies are SHARED across rooms:
- Wall paint: BUY BY THE GALLON, not quart. Touch-up only = 1-2 quarts. Full house repaint = 8-12 gallons total.
- Ceiling paint: 2-4 gallons total for the whole house, regardless of how many rooms have ceiling work. Ceilings share paint.
- Spackle: 1-2 tubs per house. NEVER per room.
- Mesh tape: 1 roll per house.
- Drop cloths/painter's tape/rollers/brushes: ONE "Paint Supplies" line item per house.

### G. Don't hallucinate
Every material MUST trace to a specific inspection finding word-for-word. Common hallucinations to avoid:
- Smart locks (only if "smart lock" explicitly mentioned)
- Window AC units (only if "AC unit" or "window unit" mentioned)
- Vinyl windows (broken pane = repair the pane, not replace the whole window)
- Condensers, HVAC parts (only if HVAC unit explicitly mentioned, and they go in COMPLIANCE not Appliances)
- Duplicate items just because the comment mentions something twice

### H. No "misc materials" placeholder lines
Every material has a specific name. If you can't name what it is, don't include it. NEVER use "Misc materials" as a line item.

### I. Trade categorization (which bucket each item belongs in)
${TRADE_CATEGORIES_PROMPT}

### J. Material names describe MATERIALS, not addresses or job IDs
Never put a property address, unit number, job code, or quote ID into the \`n\` field of a material. Use room/area context (Bathroom, Bedroom, Garage, Living Room) when known; otherwise generic descriptors like "Window (odd size 48x50 vinyl)". If the input mentions multiple units, label them "Unit A", "Unit B" — not raw addresses or unit numbers.
WRONG: { "n": "1608 48\\"x50\\"", "c": 350 }
RIGHT: { "n": "Bathroom window 48x50 vinyl (odd size)", "c": 350 }

### K. "Very old + dirty/moldy" major appliance ≠ replacement
"Refrigerator very old, likely dirty and moldy inside" → deep clean + sanitizer line under CLEANING/HAULING (~$45-75 + 1.5h labor). DO NOT quote a replacement appliance unless inspector explicitly says "replace" or "replacement needed". Mold growth INSIDE the unit gets cleaning + bleach/sanitizer, NOT a new appliance. Same for "very old stove" / "very old microwave" — clean unless explicit replacement language.

### L. Concrete / driveway / walkway / porch damage
"Cracked driveway throughout", "sidewalk heaved", "porch concrete spalling", "stoop crumbling" → EXTERIOR line item: concrete patch material (~$25-50 per crack/area) + labor (1-3h depending on extent). For heavy/structural damage flag as subcontractor bid in \`notes\`. Never drop the line just because concrete isn't in the small-tasks reference table — quote it conservatively and flag if uncertain.

## LABOR HOURS — clock hours, single worker. Use DECIMALS. Include travel between rooms, setup, cleanup.
These hours include: getting tools/materials ready, doing the work, cleaning up, and moving to the next task.
Quick tasks: outlet cover=0.15h, bulb=0.15h, smoke alarm=0.25h, doorstop=0.15h, toilet seat=0.3h, blind=0.3h, door knob=0.4h, towel bar=0.3h, caulk line=0.3h, door stop=0.15h, light fixture swap=0.75h, hinge tighten=0.2h, strike plate=0.2h, mirror mount=0.5h, towel bar/TP holder=0.3h
Medium tasks: vanity light=0.75h, screen door=1.25h, re-secure door=0.75h, drywall patch=0.5h, faucet=1.25h, shower head=0.4h, drawer slide=0.5h, cabinet door=0.75h, closet door/track=1h, screen repair=0.75h

PAINTING — hours for experienced painters (prep, patch, prime, 2 coats, cleanup ALL included):
- Touch-up paint (spot repairs, one room): 1.5-2h
- Full room repaint SMALL (bathroom, small bedroom — walls+ceiling+trim): 4-5h
- Full room repaint MEDIUM (bedroom, kitchen — walls+ceiling+trim): 5-6h
- Full room repaint LARGE (living room, open concept): 6-8h
- Hallway/stairs repaint: 3-5h
- Full unit paint (3-bed house, all rooms, spray+roll+trim): 40-50h total
IMPORTANT: A full-house repaint of a 3-bedroom home = 40-50 total paint hours. If your paint hours add up to less than 35h for a full house, increase them.

FLOORING — create ONE line item PER ROOM, not one consolidated line item for the whole house. If 7 rooms have damaged flooring, the Flooring trade bucket must contain SEVEN line items (one per room). NEVER merge multiple rooms into a single "Flooring throughout home" line — Bernard prices, schedules, and tracks progress per room. Each room has its own sqft, its own labor hours, and its own materials line. The "GROUP BY TRADE" rule (rule 4 above) means line items live under trade-named room buckets ("Flooring", "Painting") — it does NOT mean consolidate multiple rooms into one item. Do NOT split a single room into separate demo/prep/install items.
RESPECT THE USER'S MATERIAL CHOICE PER ROOM. The Comment field for each room's flooring finding may name a specific replacement material — "Replace with carpet", "Replace with LVP", "Replace with tile", "Refinish hardwood". When it does, you MUST use THAT material for that room's flooring line. Do NOT default to LVP just because LVP is the most common make-ready choice. Mixed-material houses are normal: bedrooms in carpet, kitchens/baths in LVP, basements in tile — each room is independent. If the comment is silent on material, you may default to LVP. If the comment names a material, that material is binding.
Hours INCLUDE old floor removal, subfloor prep, AND new floor installation. These are MINIMUMS — never quote fewer hours than the per-sqft formula gives you, regardless of labor rate:
- LVP/Laminate (install only, existing subfloor good): 1 hour per 35 sqft
- LVP/Laminate REPLACING old flooring (carpet rip, tear-out, or any demo): 1 hour per 28 sqft (tear-out + haul-out adds real time — do not skip it)
- Carpet install: 1 hour per 50 sqft (includes pad)
- Tile: 1 hour per 15-20 sqft
- Baseboard per room: 1.5-2.5h
- Big rooms (≥600 sqft) lean toward the lower sqft-per-hour figure (more hours), not the higher one — straight runs are faster per plank but cuts at perimeter, transitions, and disposal scale linearly with area.
EXAMPLES (apply BOTH the per-sqft minimum AND the dollar floor below, take whichever is HIGHER):
- 450 sqft LVP, no demo: 450/35 = ~13h
- 450 sqft LVP replacing carpet: 450/28 = ~16h
- 920 sqft LVP replacing carpet: 920/28 = ~33h (NOT 17h — rip-out, disposal, and 920 sqft of cuts/transitions take real time)
FLOORING DOLLAR FLOOR (additional check, AFTER the per-sqft minimum): Total flooring labor for a room (hours × labor rate) MUST also be ≥ $2.50/sqft. If at the user's labor rate the per-sqft hours produce less than that, RAISE hours until labor ≥ $2.50/sqft × room sqft. NEVER LOWER hours below the per-sqft minimum just because the dollar floor is already met — both rules are MINIMUMS, not targets.
FLOORING MATERIALS — calculate from sqft:
- LVP/Laminate: $2.00/sqft + 10% waste. Example: 450 sqft = 495 sqft × $2 = $990
- Underlayment: $0.30/sqft. Example: 450 sqft = $135
- Transition strips: $15 each × 2-4 per job = $30-60
- Self-leveling compound: ONLY if report says "uneven subfloor". $35 per 50sqft.
- Disposal/cleanup: $15 flat
EXAMPLE: 450 sqft LVP replacing carpet = ONE item: ~16h labor + $1,170 materials. NOT three separate items totaling $10,000, and NOT 10h — that ignores the rip-out and disposal time.

COUNTERTOPS — when the inspection's Counters row is condition D or P, the CARPENTRY trade bucket MUST contain a counter-replacement line item. Counters are CARPENTRY, NEVER Flooring — they travel with cabinets, not with floors. Treat the SIZING similarly to flooring (per linear foot or square foot of counter, NOT room sqft — counters are 25" deep, so ~12 lf ≈ 25 sqft) but the line item itself goes under Carpentry: demo + template + install + sink/faucet reset.
Default sizing if the report doesn't say:
- Standard kitchen: ~12-14 linear ft (~25-30 sqft) of counter.
- Galley/small kitchen: ~8-10 linear ft (~17-21 sqft).
- L-shape / large kitchen with island: ~18-22 linear ft (~38-46 sqft).
Material tiers — installed PRICE per sqft (material only; labor below). Pick a tier from the inspection language; if the report says nothing about material, default to LAMINATE (most common rental-grade replacement) and flag in notes.
- LAMINATE (Wilsonart/Formica, post-form): $15/sqft material installed-grade, OR $120-180 per 8ft section pre-formed.
- BUTCHER BLOCK (oak/maple): $35/sqft material.
- SOLID SURFACE (Corian, Hi-Macs): $50/sqft material.
- QUARTZ (engineered stone, e.g. Silestone): $60/sqft material.
- GRANITE (slab, level 1-2): $65/sqft material.
LABOR — countertop replace = demo old + template + install new + sink/faucet reset. Treat as a single line item per kitchen.
- Laminate / butcher block (DIY-installable, no slab template): 4-6h total.
- Solid surface (semi-pro, mostly drop-in): 6-8h.
- Quartz / granite (slab, requires template + 1-2 week lead time, set with crew of 2): 8-10h on-site labor for install day; PLUS 1-2h for template appointment and sink reset. List as ~10h total in laborHrs and mention the lead time in the comment. For granite/quartz, also flag in the top-level notes array that the slab itself is fabricator-supplied — Bernard typically subs the cut and just handles demo + install + reset.
INCLUDE THESE IN THE LINE-ITEM PACKAGE (don't break out as separate items):
- Sink reset (drop existing sink back in) OR sink replacement if "replace sink" is in the inspection.
- Faucet reinstall (always — counter swap = pull faucet, reset on new top).
- Edge profile (eased/bullnose/ogee — laminate post-form is included; stone has $5-10/lf upcharge for ogee — only call it out if mentioned).
- Caulk + silicone seal at backsplash and around sink ($10 in materials, included in labor).
- Disposal/haul of old top: $25 flat.
EXAMPLE (laminate, standard kitchen, ~12 lf): ONE item: detail "Kitchen — Replace countertop (laminate, ~12 lf)", 5h labor, materials = laminate $360-420 + sink/faucet hardware ~$25 + disposal $25 = ~$430-470. Comment: "Demo old laminate, template, fabricate post-form replacement, reset sink and faucet, re-caulk backsplash."
EXAMPLE (quartz, standard kitchen, ~28 sqft): ONE item: 10h labor + materials ~$1,680 (28 sqft × $60) + sink/faucet reset ~$25 + disposal $25 = ~$1,730. Comment must mention slab lead time (~1-2 wks) and that fabricator handles cut/template.
NEVER quote countertops by counting backsplash tiles or breaking demo/install/reset into 3-5 separate line items. ONE item per kitchen.

Doors: pre-hung door=2-2.5h, bifold=1.25h, entry door=2.5-3h

## MATERIALS — LOW-END RETAIL PRICES
Smoke alarm=$18, outlet cover=$1, door knob=$15, pre-hung interior door=$90, pre-hung exterior/entry door=$275, bifold door=$50, blind=$10, ceiling fixture=$25, vanity light=$30, toilet seat=$18, shower head=$22, shower rod=$12, towel bar=$12, caulk=$5, screen door=$80, faucet=$55, toilet repair kit=$15, LVP=$2.00/sqft
PAINT MATERIALS — wall paint averages $28/gal, primer $22/gal, trim semigloss $32/gal, ceiling flat $22/gal. Calculate per room:
- Small room (bathroom, closet): 1 gal paint ($28) + 1 qt primer ($8) = $36
- Medium room (bedroom, kitchen): 2 gal paint ($56) + 1 gal primer ($22) = $78
- Large room (living room, open concept): 3 gal paint ($84) + 1 gal primer ($22) = $106
- Hallway/stairs: 2 gal paint ($56) + 1 qt primer ($8) = $64
- Full unit supplies (tape, spackle, rollers, cloths, drop cloths): $30-50 total — list ONCE under "Paint Supplies"
For a full 3-bed house paint: ~12-15 gallons paint ($336-420) + primer ($60-90) + supplies ($45) = $440-555 materials total.
IMPORTANT: Do NOT list just "1 gal" for every room. Calculate based on room size.

## SPECIFIC DETAILS
Capture from report: paint colors, hardware finishes (brushed nickel, oil-rubbed bronze), brands, sizes/dimensions, model numbers. Put in "comment" field AND material names.

## OUTPUT FORMAT — Return ONLY valid JSON:
{
  "property": "address or empty string",
  "client": "client name or empty string",
  "rooms": [
    {
      "name": "Trade Category",
      "items": [
        {
          "detail": "Room — Task description",
          "condition": "D (damaged/urgent) | P (poor/needed) | F (fair/minor) | - (general)",
          "comment": "Clear work description referencing inspection finding",
          "laborHrs": 0.25,
          "materials": [{"n": "Specific material", "c": 15}]
        }
      ]
    }
  ],
  "notes": ["Items flagged for subcontractors or owner"],
  "crewSize": 2,
  "estDays": 3
}

## VERIFY BEFORE OUTPUT
- EVERY ROOM WITH A D OR P FINDING MUST PRODUCE AT LEAST ONE LINE ITEM. Count the distinct rooms in the input that have any condition: "D" or "P" item. Count the distinct rooms represented in your output (the room prefix in detail field). The two counts must match. If you have 7 rooms with damaged findings but only 4 rooms in your output, you've dropped 3 rooms — go back and add them. NEVER skip a room because its sqft is missing or its photos didn't load — quote it from the text comment with a conservative estimate. NEVER skip a room because a similar item is quoted elsewhere — each room is its own line item.
- RE-READ EVERY D AND P COMMENT after drafting your line items. For each comment, count the distinct sentences/clauses describing repairs and verify you have a line (or a material under an existing line) for each one. If a comment described 5 distinct issues but you have 3 line items for that room, you missed 2 — go back and add them. The most common drop pattern is sentence #2 or later, or the second clause after "and". Do this pass every time, not just on long comments.
- Total hours: 40-70 for typical 3-bed full make-ready (including full paint). Under 30 for a full paint job = too low.
- Total cost: $3,000-$6,000 typical. Over $8,000 = re-check.
- No item appears in more than 2 rooms (if it does, it's a duplicate).
- Every line item traces to a specific inspection finding.
- No 1.0h defaults — use the reference table above.
- Room names are trade categories, not room names.
- Shared supplies listed once, not per room.`;

export interface AiParseResult {
  property: string;
  client: string;
  rooms: Room[];
  notes: string[];
  crewSize: number;
  estDays: number;
}

/* ====== POST-PARSE VALIDATION ====== */
export function validateQuote(rooms: Room[]): Room[] {
  // 0. Ensure every item has a stable id. Without this, saved quotes from
  //    older versions (or any item that lost its id in transit) would all
  //    have id===undefined, and editing one item's hours would patch every
  //    other id-less item in the same room because `i.id === id` matches all
  //    `undefined` ids at once.
  rooms = rooms.map((r) => ({
    ...r,
    items: r.items.map((it) => (it.id ? it : { ...it, id: crypto.randomUUID().slice(0, 8) })),
  }));

  // 1. Detect phantom materials — same high-cost item in 3+ rooms = likely a bug.
  // Skip TYPE B / project-scope items (condition "-") since multi-unit jobs
  // legitimately list the same material across unit-grouped items.
  const materialCount: Record<string, { count: number; totalCost: number }> = {};
  rooms.forEach((r) => r.items.forEach((it) => {
    if (it.condition === "-") return;
    it.materials.forEach((m) => {
      const key = m.n.toLowerCase();
      if (!materialCount[key]) materialCount[key] = { count: 0, totalCost: 0 };
      materialCount[key].count++;
      materialCount[key].totalCost += m.c;
    });
  }));

  const phantomMaterials = new Set<string>();
  Object.entries(materialCount).forEach(([key, v]) => {
    // Flag if same item appears 3+ times AND costs $50+ each
    if (v.count >= 3 && v.totalCost / v.count >= 50) {
      phantomMaterials.add(key);
      console.warn(`VALIDATION: Phantom material detected — "${key}" appears ${v.count} times ($${v.totalCost} total). Removing.`);
    }
  });

  // 2. Remove phantom materials from items
  if (phantomMaterials.size > 0) {
    rooms = rooms.map((r) => ({
      ...r,
      items: r.items.map((it) => ({
        ...it,
        materials: it.materials.filter((m) => !phantomMaterials.has(m.n.toLowerCase())),
      })),
    }));
  }

  // 3. Deduplicate items — check across ALL rooms, not just within one.
  //
  // Bug history: an earlier version used a regex that stripped room numbers
  // ("Bedroom 1", "Bedroom 2", "Bedroom 3" all collapsed to "bedroom"), so
  // a 7-room flooring make-ready where most rooms had similar damage
  // comments saw Bedrooms 2 and 3 silently removed as "duplicates" of
  // Bedroom 1. Now: dedup on the full detail string + comment so each
  // unique room–task pair survives, but two AI batches that produced the
  // exact same line item still collapse to one.
  const globalSeen = new Set<string>();
  rooms = rooms.map((r) => ({
    ...r,
    items: r.items.filter((it) => {
      const detailKey = it.detail.toLowerCase().replace(/\s+/g, " ").trim();
      const taskKey = it.comment.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().slice(0, 80);
      const key = `${detailKey}|${taskKey}`;
      if (globalSeen.has(key)) {
        console.warn(`VALIDATION: Global duplicate removed — "${it.detail}"`);
        return false;
      }
      globalSeen.add(key);
      return true;
    }),
  }));

  // 4. Cap unreasonable material costs per item. Inspection-style items
  // (condition S/F/P/D) get tight caps because they represent a single repair
  // task. Project-scope items (condition "-") get loose caps because they
  // legitimately roll up multiple units (e.g. 16 windows across a triplex).
  const EXPENSIVE_KEYWORDS = /water heater|condenser|furnace|ac unit|mini.?split|garage door|countertop|tub|vanity|window|appliance|flooring|carpet/i;
  rooms = rooms.map((r) => ({
    ...r,
    items: r.items.map((it) => {
      const matTotal = it.materials.reduce((s, m) => s + (m.c || 0), 0);
      const isExpensive = EXPENSIVE_KEYWORDS.test(it.detail + " " + it.comment);
      const isProjectScope = it.condition === "-";
      const cap = isProjectScope
        ? (isExpensive ? 25000 : 10000)
        : (isExpensive ? 2000 : 500);
      if (matTotal > cap) {
        console.warn(`VALIDATION: Material cost for "${it.detail}" is $${matTotal} (cap $${cap}). Resetting.`);
        // Scale materials down proportionally to cap. Scale unitPrice
        // alongside c so qty × unitPrice stays consistent.
        const scale = cap / matTotal;
        return { ...it, materials: it.materials.map((m) => ({
          ...m,
          c: Math.round(m.c * scale),
          ...(m.unitPrice !== undefined ? { unitPrice: Math.round(m.unitPrice * scale * 100) / 100 } : {}),
        })) };
      }
      return it;
    }),
  }));

  // 5. Cap unreasonable hours. Inspection items: 10h trip / 8h reset (no single
  // repair task takes longer than that). Project-scope items: 200h trip / 100h
  // reset (a multi-unit job can legitimately be 50-100 clock hours).
  rooms = rooms.map((r) => ({
    ...r,
    items: r.items.map((it) => {
      const isProjectScope = it.condition === "-";
      const trip = isProjectScope ? 200 : 10;
      const reset = isProjectScope ? 100 : 8;
      if (it.laborHrs > trip) {
        console.warn(`VALIDATION: Capped hours for "${it.detail}" from ${it.laborHrs}h to ${reset}h`);
        return { ...it, laborHrs: reset };
      }
      return it;
    }),
  }));

  // 5. Ensure materials have $0 fallback removed (no empty "Materials $0" entries)
  rooms = rooms.map((r) => ({
    ...r,
    items: r.items.map((it) => ({
      ...it,
      materials: it.materials.filter((m) => m.c > 0 || it.materials.length === 1),
    })),
  }));

  // 6. RE-CLASSIFY EACH ITEM BY TRADE (always). Even when the AI returned
  // trade-named buckets, individual items can be in the wrong one — e.g. a
  // door knob inside the "Painting" bucket, a water heater inside
  // "Electrical." Build the trade groups from scratch by classifying each
  // item against its detail+comment text. Skip only if the input was
  // already empty.
  const TRADE_CATEGORIES = TRADE_CATEGORY_LIST;

  if (rooms.length > 0) {
    const tradeMap: Record<string, RoomItem[]> = {};

    const TRADE_SET = new Set(TRADE_CATEGORIES.map((t) => t.toLowerCase()));

    /**
     * Deterministic override pass — runs BEFORE the keyword scorer and BEFORE
     * any "respect existing trade" logic. Returns one of the canonical trade
     * bucket names if the item text contains a high-confidence pattern that
     * the keyword scorer has historically gotten wrong.
     *
     * Background: Bernard saw real production misroutes that the scorer
     * couldn't fix because of single-word collisions:
     *  - "Laminate countertop" → Flooring (because of "laminate") even
     *     though the user explicitly picked Carpentry in manual add.
     *  - "Demo rotten shower wall framing" with cement-board materials →
     *     Exterior (because cement.?board scores Exterior +14) even though
     *     it's interior bathroom carpentry.
     *  - "General Construction — Caulking and finishing" → Cleaning/Hauling
     *     (because of "finishing" / no caulk-specific scorer).
     *
     * The override patterns are deliberately narrow + high-confidence. Each
     * rule fires only when the text unambiguously names the work; otherwise
     * we fall through to the scorer. Returns null when nothing matches.
     */
    const overrideTrade = (item: RoomItem): string | null => {
      const s = (item.detail + " " + item.comment).toLowerCase();
      // Countertops are CARPENTRY (travel with cabinets, not floors).
      // The keyword scorer doesn't even mention countertops; "laminate"
      // alone steers it into Flooring.
      if (/counter.?top|counter top|counter-top/.test(s)) return "Carpentry";
      // Interior framing / studs / blocking / sistering — Carpentry.
      // "shower wall framing" pulls Plumbing+10 from \bshower\b in the
      // scorer; the framing pattern is more specific and wins.
      if (/\bframing\b|re.?frame|reframe|\bstuds?\b|\bblocking\b|\bjoists?\b|\bheaders?\b|sistering|\bsister\b/.test(s)) return "Carpentry";
      // Caulking / sealant lines → Painting per Bernard's prompt rule
      // ("every caulk line goes here unless it's a plumbing fixture
      // replacement that explicitly includes the bead"). Skip the
      // override when the surrounding context names a plumbing fixture
      // replacement so the scorer's Plumbing+8 caulk-fixture rule still
      // wins — the override is for the cases where caulk was getting
      // dumped into Cleaning/Hauling.
      if (/\bcaulk\b|caulking|\bsealant\b|silicone bead/.test(s) &&
          !/(replac|new).*(faucet|toilet|tub|shower head|sink|fixture)|fixture.*(replac|new)/.test(s)) {
        return "Painting";
      }
      // Demo of carpentry-class items → Carpentry. The disposal portion
      // (dump fee / debris bags / hauling time) belongs in Cleaning per
      // the prompt; that's a separate line item the AI is responsible
      // for splitting.
      if (/\b(demo|tear.?out|rip.?out|remove)\b/.test(s) &&
          /(countertop|cabinet|trim|frame|framing|stud|drywall|baseboard|\bdoor\b|\bwindow\b)/.test(s)) {
        return "Carpentry";
      }
      return null;
    };

    const classifyTrade = (item: RoomItem, roomName: string): string => {
      // Use detail + comment for classification (NOT materials — they can be misleading)
      const s = (item.detail + " " + item.comment).toLowerCase();
      const matNames = item.materials.map((m) => m.n).join(" ").toLowerCase();

      // Score each trade — highest score wins
      const scores: Record<string, number> = {};
      const add = (trade: string, pts: number) => { scores[trade] = (scores[trade] || 0) + pts; };

      // Plumbing — check FIRST with strong keywords (prevents paint from stealing plumbing items).
      // Water heater / tank intentionally NOT here — those belong to Compliance.
      if (/faucet|toilet|sink|tub|drain|p.?trap|disposal|supply.*line|shut.*off|sprayer|stopper|sump|sewage|valve|pipe|aerator|diverter|dryer.*vent/.test(s)) add("Plumbing", 10);
      if (/\bshower\b/.test(s) && !/shower.*rod|shower.*curtain/.test(s)) add("Plumbing", 10);
      if (/caulk.*(tub|shower|sink|bath)|re.?caulk/.test(s)) add("Plumbing", 8);
      if (/faucet|toilet|shower.*head|p.?trap|disposal|aerator/.test(matNames)) add("Plumbing", 5);

      // Painting — only if paint/repaint is the PRIMARY task
      if (/\bpaint\b|repaint|prime|primer|touch.?up.*paint|paint.*touch|wall.*ceiling.*paint|paint.*wall|full.*paint/.test(s)) add("Painting", 10);
      if (/spackle|patch.*wall|wall.*patch|texture.*wall|ceiling.*paint/.test(s)) add("Painting", 6);
      if (/paint|primer|spackle|roller/.test(matNames) && !scores["Plumbing"]) add("Painting", 3);

      // Flooring — `\brug\b` covers "remove rug", "area rug", "throw rug"
      // at a slightly elevated score so it wins over a tied Cleaning/Hauling
      // match for the verb "remove" (rug-pull jobs are flooring work, not
      // a junk haul-out).
      if (/floor|carpet|lvp|laminate|tile.*floor|vinyl.*floor|transition.*strip|baseboard|quarter.*round|threshold|subfloor|\brug\b|area rug|throw rug/.test(s)) add("Flooring", 11);
      if (/carpet|lvp|laminate|flooring|baseboard|underlayment|\brug\b/.test(matNames)) add("Flooring", 5);

      // Electrical — bare `panel` was matching siding/fence/door panels.
      // Replace with electrical-panel-specific forms. `wire` and `switch`
      // get word boundaries so "barbed wire fence" / "switch out the rug"
      // don't trip the classifier.
      if (/outlet|\bswitch\b|\bwire\b|breaker|gfci|light.*fixture|\bbulb\b|ceiling.*fan|recessed|dimmer|\belectrical\b|wiring|breaker.*panel|electrical.*panel|electric.*panel|main.*panel|sub.?panel|service.*panel|circuit.*panel|panel.*box|panel.*main/.test(s)) add("Electrical", 10);
      if (/outlet|switch|bulb|fixture|\bwire\b|breaker|gfci/.test(matNames)) add("Electrical", 5);

      // Safety
      if (/smoke.*alarm|co.*detect|fire.*ext|carbon.*monoxide|detector|fire.*alarm/.test(s)) add("Safety", 12);
      if (/smoke.*alarm|co.*detect|fire.*ext|battery/.test(matNames)) add("Safety", 5);

      // Carpentry — doors, windows, hardware, trim
      if (/\bdoor\b|knob|hinge|lock|deadbolt|bifold|pocket.*door|barn.*door|blind|window|screen|mirror|closet|shelf|shelving/.test(s)) add("Carpentry", 10);
      if (/towel.*bar|tp.*holder|rod|handle|latch|strike|cabinet/.test(s)) add("Carpentry", 8);
      if (/door|knob|hinge|blind|screen|mirror|shelf/.test(matNames)) add("Carpentry", 5);

      // Appliances
      if (/oven|stove|dishwasher|fridge|refrigerator|washer|dryer|appliance|microwave|range.*hood|garbage.*disposal/.test(s)) add("Appliances", 10);

      // Exterior — bump siding/fascia/soffit/hardiplank to 14 so a
      // "siding panel" item lands here even if a stray keyword would
      // tie elsewhere. These materials are unambiguous when present.
      if (/\bsiding\b|hardi.?plank|cement.?board|\bfascia\b|\bsoffit\b|t1.?11|stucco/.test(s)) add("Exterior", 14);
      if (/exterior|fence|gate|gutter|downspout|porch|deck|landscape|mailbox|stair.*rail|\broof\b|shingle/.test(s)) add("Exterior", 10);

      // Compliance — water heater, HVAC filter, doorbell, thermostat, breaker
      // panel inspections. Water heater / hot water tank lands here (not in
      // Plumbing) so the trade buckets match the prompt's categorization.
      if (/water.*heater|water.*tank|hot.*water|doorbell|chime|filter|compliance|hvac.*filter|thermostat|heater.*filter|breaker.*box|breaker.*panel|electrical.*panel/.test(s)) add("Compliance", 12);

      // Cleaning
      if (/clean|haul|trash|debris|junk|removal/.test(s)) add("Cleaning/Hauling", 10);

      // Return highest scoring trade
      const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
      if (sorted.length > 0 && sorted[0][1] > 0) return sorted[0][0];
      return "Carpentry"; // default fallback
    };

    rooms.forEach((r) => {
      r.items.forEach((it) => {
        // Pick the trade bucket using a precedence chain:
        //   1. userClassified (manual Add Item) — sacred, never reclassify.
        //   2. Deterministic override (countertop/framing/caulk/demo) —
        //      catches the high-confidence patterns the keyword scorer
        //      historically got wrong, regardless of whether the AI or
        //      the scorer would otherwise place it.
        //   3. Parent room is already a valid trade bucket — respect the
        //      AI's choice; the scorer's job is to RESCUE bad buckets,
        //      not second-guess correct ones. Without this, an AI item
        //      correctly placed in Carpentry could still get rebucketed
        //      into Flooring on a stray "laminate" or "baseboard" word.
        //   4. Fall back to the keyword scorer (rescues "Electrical."
        //      and other malformed AI outputs).
        let trade: string;
        if (it.userClassified === true && TRADE_SET.has(r.name.toLowerCase())) {
          // Manual add already lands in a canonical trade — sacred, leave
          // it alone. (Guarded by canonical check so a stale userClassified
          // flag pointing at a non-canonical parent room can't get the
          // item silently dropped by the final canonical-only rebuild.)
          trade = r.name;
        } else {
          const override = overrideTrade(it);
          if (override) {
            trade = override;
          } else if (TRADE_SET.has(r.name.toLowerCase())) {
            trade = r.name;
          } else {
            trade = classifyTrade(it, r.name);
          }
        }
        // Prepend room name to detail if not already there
        const roomPrefix = r.name.replace(/\s*[:\/].*/g, "").trim();
        const alreadyHasRoom = TRADE_CATEGORIES.some((t) => it.detail.toLowerCase().startsWith(t.toLowerCase()));
        if (!alreadyHasRoom && !it.detail.includes(" — ") && !it.detail.includes(" - ") && roomPrefix) {
          it.detail = `${roomPrefix} — ${it.detail}`;
        }
        if (!tradeMap[trade]) tradeMap[trade] = [];
        tradeMap[trade].push(it);
      });
    });

    rooms = TRADE_CATEGORIES
      .filter((t) => tradeMap[t]?.length)
      .map((t) => ({ name: t, items: tradeMap[t] }));
  }

  return rooms;
}

/**
 * Extract a 5-digit US ZIP from an address string. Returns "" if not present.
 * Tolerates "12345" or "12345-6789" formats anywhere in the string; if
 * multiple matches exist, takes the last one (typically the trailing ZIP).
 */
export function extractZip(address: string | undefined | null): string {
  if (!address) return "";
  const matches = address.match(/\b(\d{5})(?:-\d{4})?\b/g);
  if (!matches || !matches.length) return "";
  // Take the last 5-digit run — the trailing ZIP, not a house number
  const last = matches[matches.length - 1];
  return last.slice(0, 5);
}

// Image payload budget per AI call. Vercel's serverless body limit is 4.5 MB;
// we aim for ~3 MB of image data so the system prompt + corrections + text +
// JSON overhead all comfortably fit. The count ceiling is a safety net so a
// flood of tiny thumbnails can't pile 100 images into one prompt.
//
// Only applies to inline base64 images. URL-sourced images (uploaded via
// uploadDataUriToBucket → passed as `https://…`) cost essentially nothing in
// the request body, so they bypass these caps and we can send all of them
// up to Anthropic's per-request image limit (BATCH_MAX_URL_COUNT).
const BATCH_TARGET_BYTES = 3 * 1024 * 1024;
const BATCH_MAX_COUNT = 20;
// Anthropic's documented per-request image cap. Plenty of headroom for any
// inspection PDF Bernard's likely to upload.
const BATCH_MAX_URL_COUNT = 100;

/**
 * Merge multiple AiParseResult partials into one. Items grouped by trade name
 * (case-insensitive) get concatenated; first-seen casing wins. validateQuote
 * runs on the merged set to catch cross-batch duplicates. Used by
 * aiParseInspection's room-level batching, where each batch's text is
 * restricted to its rooms so duplicates are rare.
 */
function mergeParseResults(partials: AiParseResult[]): AiParseResult {
  const tradeByKey: Record<string, { name: string; items: RoomItem[] }> = {};
  partials.forEach((p) => p.rooms.forEach((r) => {
    const key = r.name.trim().toLowerCase();
    if (!tradeByKey[key]) tradeByKey[key] = { name: r.name, items: [] };
    tradeByKey[key].items.push(...r.items);
  }));

  const noteSet = new Set<string>();
  partials.forEach((p) => p.notes.forEach((n) => { if (n) noteSet.add(n); }));

  return {
    property: partials.find((p) => p.property)?.property || "",
    client: partials.find((p) => p.client)?.client || "",
    rooms: validateQuote(Object.values(tradeByKey)),
    notes: [...noteSet],
    crewSize: Math.max(...partials.map((p) => p.crewSize || 2)),
    estDays: Math.max(...partials.map((p) => p.estDays || 0)),
  };
}

export async function aiParsePdf(
  text: string,
  images: string[],
  laborRate?: number,
  licensedTrades?: string[],
  propertyZip?: string,
  onProgress?: (msg: string) => void
): Promise<AiParseResult | null> {
  // Single API call, with images trimmed to fit one request body. We do NOT
  // batch image-by-image here: the AI sees the full text on every call and
  // would re-quote the entire property each time, producing 2-3× near-
  // identical line items that simple text dedup can't catch (the phrasing
  // varies per batch). Better to drop pages we can't fit than to ship
  // duplicated quotes. The room-level batching in aiParseInspection is
  // separate and safe — its per-batch text is restricted to those rooms.
  //
  // Two paths:
  //  • URL-sourced images (`https://…`) — body stays tiny, Anthropic fetches
  //    each image directly. We can send up to BATCH_MAX_URL_COUNT in one call.
  //  • Inline base64 (`data:image/…`) — fits under Vercel's 4.5 MB body
  //    limit; falls back to BATCH_TARGET_BYTES / BATCH_MAX_COUNT trim.
  const allUrls = images.length > 0 && images.every((img) => img.startsWith("http"));
  let trimmed: string[];
  if (allUrls) {
    trimmed = images.slice(0, BATCH_MAX_URL_COUNT);
    if (trimmed.length < images.length) {
      onProgress?.(`Sending ${trimmed.length} of ${images.length} pages (Anthropic per-call limit)...`);
    }
  } else {
    trimmed = [];
    let totalBytes = 0;
    for (const img of images) {
      if (totalBytes + img.length > BATCH_TARGET_BYTES) break;
      if (trimmed.length >= BATCH_MAX_COUNT) break;
      trimmed.push(img);
      totalBytes += img.length;
    }
    if (trimmed.length < images.length) {
      const dropped = images.length - trimmed.length;
      console.warn(`aiParsePdf: sending ${trimmed.length} of ${images.length} images (${dropped} dropped to fit one call)`);
      onProgress?.(`Sending ${trimmed.length} of ${images.length} pages (${dropped} skipped to fit one call)...`);
    }
  }
  return aiParsePdfSingle(text, trimmed, laborRate, licensedTrades, propertyZip);
}

async function aiParsePdfSingle(
  text: string,
  images: string[],
  laborRate?: number,
  licensedTrades?: string[],
  propertyZip?: string
): Promise<AiParseResult | null> {
  try {
    // Load recent price corrections for AI learning. When a propertyZip is
    // passed, partition the corrections into "local" (same ZIP) and "regional"
    // (everything else) so the AI prefers prices from the same ZIP code over
    // averaged numbers from other markets.
    let correctionsPrompt = "";
    try {
      const corrections = await db.get<{
        item_name: string; original_hours: number; corrected_hours: number;
        original_mat_cost: number; corrected_mat_cost: number; trade: string;
        zip?: string;
      }>("price_corrections");
      if (corrections.length > 0) {
        // Job-level calibrations (item_name starts with "__job__:") are kept
        // separate from per-item corrections and surfaced as their own prompt
        // section so the AI uses them as overall sizing context.
        type JobCal = { quoted: number[]; actual: number[]; localQuoted: number[]; localActual: number[] };
        const jobCalsByTrade: Record<string, JobCal> = {};
        const itemCorrections: typeof corrections = [];
        corrections.forEach((c) => {
          if (typeof c.item_name === "string" && c.item_name.startsWith("__job__:")) {
            const trade = c.item_name.slice("__job__:".length) || c.trade || "General";
            if (!jobCalsByTrade[trade]) {
              jobCalsByTrade[trade] = { quoted: [], actual: [], localQuoted: [], localActual: [] };
            }
            const cal = jobCalsByTrade[trade];
            const isLocal = !!(propertyZip && c.zip && c.zip === propertyZip);
            cal.quoted.push(c.original_hours);
            cal.actual.push(c.corrected_hours);
            if (isLocal) {
              cal.localQuoted.push(c.original_hours);
              cal.localActual.push(c.corrected_hours);
            }
          } else {
            itemCorrections.push(c);
          }
        });

        type Bucket = { hrsAdj: number[]; matAdj: number[]; count: number };
        const byItem: Record<string, { local: Bucket; other: Bucket }> = {};
        const newBucket = (): Bucket => ({ hrsAdj: [], matAdj: [], count: 0 });
        itemCorrections.slice(0, 200).forEach((c) => {
          const key = c.item_name.toLowerCase().replace(/[^a-z\s]/g, "").trim();
          if (!key) return;
          if (!byItem[key]) byItem[key] = { local: newBucket(), other: newBucket() };
          const isLocal = !!(propertyZip && c.zip && c.zip === propertyZip);
          const bucket = isLocal ? byItem[key].local : byItem[key].other;
          if (c.corrected_hours !== c.original_hours) bucket.hrsAdj.push(c.corrected_hours);
          if (c.corrected_mat_cost !== c.original_mat_cost) bucket.matAdj.push(c.corrected_mat_cost);
          bucket.count++;
        });
        const formatLesson = (item: string, b: Bucket): string | null => {
          const parts = [];
          if (b.hrsAdj.length) {
            const avgHrs = b.hrsAdj.reduce((a, x) => a + x, 0) / b.hrsAdj.length;
            parts.push(`typically ${avgHrs.toFixed(1)}h`);
          }
          if (b.matAdj.length) {
            const avgMat = b.matAdj.reduce((a, x) => a + x, 0) / b.matAdj.length;
            parts.push(`materials ~$${avgMat.toFixed(0)}`);
          }
          return parts.length ? `- ${item}: ${parts.join(", ")}` : null;
        };
        const localLessons: string[] = [];
        const otherLessons: string[] = [];
        Object.entries(byItem).forEach(([item, v]) => {
          if (v.local.count >= 2) {
            const l = formatLesson(item, v.local);
            if (l) localLessons.push(l);
          } else if (v.other.count >= 2) {
            const l = formatLesson(item, v.other);
            if (l) otherLessons.push(l);
          }
        });
        // Format job-level calibrations: "Plumbing: avg 8.5h quoted vs 11h
        // actual across 4 jobs (local: 12h actual)" — gives the AI sizing
        // context grounded in this team's real outcomes.
        const jobCalLines: string[] = [];
        const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
        Object.entries(jobCalsByTrade).forEach(([trade, cal]) => {
          if (cal.quoted.length === 0) return;
          const parts = [
            `quoted ${avg(cal.quoted).toFixed(1)}h`,
            `actual ${avg(cal.actual).toFixed(1)}h`,
            `n=${cal.quoted.length}`,
          ];
          if (cal.localActual.length > 0) {
            parts.push(`local actual ${avg(cal.localActual).toFixed(1)}h (n=${cal.localActual.length})`);
          }
          jobCalLines.push(`- ${trade}: ${parts.join(", ")}`);
        });

        if (localLessons.length || otherLessons.length || jobCalLines.length) {
          correctionsPrompt = "";
          if (jobCalLines.length) {
            correctionsPrompt += `\nPAST JOB DURATIONS — actual hours from completed work (use as overall sizing context, especially when local data exists):\n${jobCalLines.join("\n")}\n`;
          }
          if (localLessons.length && propertyZip) {
            correctionsPrompt += `\nLEARNED PRICING — LOCAL TO ZIP ${propertyZip} (prefer these for same-area jobs):\n${localLessons.slice(0, 25).join("\n")}\n`;
          }
          if (otherLessons.length) {
            const heading = propertyZip
              ? `\nLEARNED PRICING — REGIONAL (other ZIPs, use as fallback):`
              : `\nLEARNED PRICING (from past job corrections by this team — use these when applicable):`;
            correctionsPrompt += `${heading}\n${otherLessons.slice(0, 20).join("\n")}\n`;
          }
          correctionsPrompt += "\n";
        }
      }
    } catch { /* corrections not available, continue without */ }

    // Build content array with text + images. Each image is either a
    // URL-sourced fetch (Anthropic pulls it directly) or inline base64 —
    // we accept both shapes from the caller so the same path serves PDF
    // page renders (URL'd via uploadDataUriToBucket) and ad-hoc base64
    // (e.g. callers that haven't migrated yet).
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
      | { type: "image"; source: { type: "url"; url: string } }
    > = [];

    // Add images first so AI sees the visual context
    for (const img of images) {
      if (img.startsWith("http")) {
        content.push({ type: "image", source: { type: "url", url: img } });
        continue;
      }
      const [header, data] = img.split(",");
      const mediaType = header.match(/image\/([\w]+)/)?.[0] || "image/jpeg";
      content.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data },
      });
    }

    // Pre-process text: strip summary table, clean noise
    let cleanText = text;
    if (cleanText.trim()) {
      // ── STEP 1: Remove noise ──
      cleanText = cleanText.replace(/Page \d+ of \d+\s*Report generated by zInspector/gi, "");
      cleanText = cleanText.replace(/Report generated by zInspector/gi, "");
      cleanText = cleanText.replace(/Page \d+ of \d+/gi, "");
      cleanText = cleanText.replace(/Image\s*/gi, ""); // Remove "Image" placeholders
      cleanText = cleanText.replace(/View Image\s*/gi, "");
      cleanText = cleanText.replace(/View Video\s*/gi, "");
      cleanText = cleanText.replace(/M\s*edia/gi, ""); // "M edia" broken word
      cleanText = cleanText.replace(/M\s*aintenance/gi, "Maintenance"); // "M aintenance" broken word
      cleanText = cleanText.replace(/M\s*issing/gi, "Missing"); // "M issing" broken word

      // ── STEP 2: Find where detailed breakdowns start ──
      // zInspector format: Summary table has "Area Detail Condition Actions Comment Media" columns
      // Detailed breakdowns have room name as header + "Detail Condition Actions Comment" subheaders

      // Method A: Find "Detail Condition Actions Comment" after a room name (= start of detailed section)
      const patterns = [
        /\n(Kitchen)\s*\nDetail\s+Condition/i,
        /\n(Kitchen)\s*\n\s*Detail\s+Condition/i,
        /\nKitchen\s*\n[A-Z]/i, // Room name on its own line followed by item details
      ];

      let detailStart = -1;
      for (const p of patterns) {
        const idx = cleanText.search(p);
        if (idx > 100) { detailStart = idx; break; }
      }

      // Method B: Find "Move Out Condition Summary" or "Area Detail Condition" and skip past it
      if (detailStart === -1) {
        const summaryHeader = cleanText.search(/Move.?Out Condition Summary|Area\s+Detail\s+Condition\s+Actions/i);
        if (summaryHeader >= 0) {
          // Find where summary table ends — look for the first room name that appears
          // AFTER the "Area Detail..." header AND has its own "Detail Condition Actions" subheader
          const afterSummary = cleanText.slice(summaryHeader + 100);
          const roomDetailStart = afterSummary.search(/\n(Kitchen|Living Room|Laundry|Dining|Entry|Hallway|Bedroom|Bathroom|Exterior|Compliance|Appliances)\s*\n\s*Detail\s/i);
          if (roomDetailStart > 0) {
            detailStart = summaryHeader + 100 + roomDetailStart;
          }
        }
      }

      // Method C: If we can't find the exact boundary, look for repeating room content
      // The summary table usually has compact rows; detailed sections are verbose
      if (detailStart === -1) {
        // Find the SECOND occurrence of "Kitchen" — first is summary, second is detail
        const firstKitchen = cleanText.indexOf("Kitchen");
        if (firstKitchen >= 0) {
          const secondKitchen = cleanText.indexOf("Kitchen", firstKitchen + 50);
          if (secondKitchen > firstKitchen + 200) {
            detailStart = secondKitchen;
          }
        }
      }

      if (detailStart > 100) {
        cleanText = cleanText.slice(detailStart);
      }

      // ── STEP 3: Deduplicate lines ──
      const lines = cleanText.split("\n");
      const seen = new Set<string>();
      const deduped: string[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length < 3) { deduped.push(line); continue; }
        // Skip obvious noise
        if (/^(S|F|P|D|None|-)$/.test(trimmed)) continue;
        if (/^\d+\.\d+,$/.test(trimmed)) continue; // GPS coordinates
        const key = trimmed.toLowerCase().slice(0, 60);
        if (!seen.has(key)) {
          deduped.push(line);
          seen.add(key);
        }
      }
      cleanText = deduped.join("\n");

      content.push({
        type: "text",
        text: `IMPORTANT: This text is from the DETAILED ROOM BREAKDOWN section ONLY. The summary table has been removed. Each room section below should be processed ONCE. Do NOT create duplicate entries.\n\n${cleanText.slice(0, 30000)}`,
      });
    }

    content.push({
      type: "text",
      text: "Parse this inspection report following the quoting engine rules exactly. Process ONLY the detailed room breakdowns, skip the summary table. Return ONLY the JSON.",
    });

    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 16000,
        system: `Labor rate: $${laborRate || 55}.00/hour.\n\n` +
          (licensedTrades?.length
            ? `This business holds licenses for: ${licensedTrades.join(", ")}. FULLY QUOTE work in these trades — do NOT flag them for subcontractors. Include labor, materials, and hours for all ${licensedTrades.join("/")} work.\n\n`
            : "") +
          correctionsPrompt +
          AI_SYSTEM_PROMPT_BASE,
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) {
      console.error("AI API error:", res.status, await res.text().catch(() => ""));
      // Payload too large — halve the batch and retry once. The outer
      // aiParsePdf already chunks at IMAGES_PER_BATCH, so this only fires for
      // unusually large pages that slipped under the count-based threshold.
      if ((res.status === 413 || res.status === 400) && images.length > 1) {
        const half = Math.floor(images.length / 2);
        console.log(`Retrying with fewer pages (${images.length} → ${half})...`);
        return aiParsePdfSingle(text, images.slice(0, half), laborRate, licensedTrades, propertyZip);
      }
      return null;
    }
    const data = await res.json();
    if (data.error) {
      console.error("AI response error:", data.error);
      return null;
    }

    // Extract JSON from response
    const responseText =
      data.content?.[0]?.text || "";
    const jsonMatch =
      responseText.match(/\{[\s\S]*\}/) || [];
    if (!jsonMatch[0]) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    // Add IDs to items
    const rooms: Room[] = (parsed.rooms || []).map(
      (r: { name: string; items: Array<Omit<RoomItem, "id">> }) => ({
        name: r.name,
        items: r.items.map((it) => ({
          ...it,
          id: crypto.randomUUID().slice(0, 8),
          laborHrs: it.laborHrs || 0.5,
          materials: it.materials?.length
            ? it.materials
            : [{ n: "Materials", c: 0 }],
        })),
      })
    );

    // ── POST-PARSE VALIDATION ──
    const validatedRooms = validateQuote(rooms);

    return {
      property: parsed.property || "",
      client: parsed.client || "",
      rooms: validatedRooms.filter((r) => r.items.length > 0),
      notes: parsed.notes || [],
      crewSize: parsed.crewSize || 2,
      estDays: parsed.estDays || 0,
    };
  } catch (e) {
    console.error("AI parse failed:", e);
    return null;
  }
}

/** Check if AI parsing is available (API key configured) */
export async function checkAiAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 10,
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      }),
    });
    const data = await res.json();
    return !data.error;
  } catch {
    return false;
  }
}

/* ====== INSPECTION COMPILER ====== */

export interface InspectionInput {
  rooms: {
    name: string;
    sqft?: number;
    items: {
      name: string;
      condition: string;
      notes: string;
      photos: string[];
    }[];
  }[];
  property: string;
  client: string;
}

/** Compile a subset of inspection rooms into the structured text the AI expects. */
function compileInspectionText(
  rooms: InspectionInput["rooms"],
  property: string,
  client: string
): string {
  let text = `PROPERTY INSPECTION REPORT\n`;
  text += `Property: ${property}\n`;
  text += `Client: ${client}\n`;
  text += `Date: ${new Date().toLocaleDateString()}\n\n`;

  rooms.forEach((room) => {
    text += `=== ${room.name} ===\n`;
    if (room.sqft && room.sqft > 0) {
      text += `Room Size: ${room.sqft} square feet\n`;
    }
    room.items.forEach((item) => {
      const condLabel =
        item.condition === "D" ? "Damaged" :
        item.condition === "P" ? "Poor" :
        item.condition === "F" ? "Fair" :
        "Satisfactory";
      text += `Detail: ${item.name}\n`;
      text += `Condition: ${item.condition} (${condLabel})\n`;
      text += `Actions: ${item.condition === "S" ? "None" : "Maintenance"}\n`;
      text += `Comment: ${item.notes || (item.condition === "S" ? "No issues" : "Needs attention")}\n`;
      if (item.photos.length) {
        text += `Photos: ${item.photos.length} attached\n`;
      }
      text += `\n`;
    });
    text += `\n`;
  });
  return text;
}

/** Fetch photo URLs and convert each to a base64 data URL. Skips failures silently. */
async function fetchPhotosAsBase64(urls: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const b64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      out.push(b64);
    } catch {
      // skip failed photo fetches
    }
  }
  return out;
}

// Each AI call gets at most this many photos so the request body stays under
// Vercel's 4.5 MB serverless limit. Compressed inspection photos are ~150 KB,
// so 10 × 1.33 (base64 overhead) ≈ 2 MB — leaves headroom for the system
// prompt and inspection text.
const PHOTOS_PER_BATCH = 10;

export async function aiParseInspection(
  inspection: InspectionInput,
  laborRate?: number,
  licensedTrades?: string[],
  onProgress?: (msg: string) => void
): Promise<AiParseResult | null> {
  const zip = extractZip(inspection.property);

  // Pack rooms into batches so each AI call carries at most PHOTOS_PER_BATCH
  // photos. Rooms with no photos ride along with whichever batch is currently
  // open — the AI still needs their text findings to quote them. A single
  // room whose photo count exceeds the batch size is split across multiple
  // batches, each carrying that room's full text but a slice of its photos.
  type Batch = { rooms: InspectionInput["rooms"]; photos: string[] };
  const batches: Batch[] = [];
  let curRooms: InspectionInput["rooms"] = [];
  let curPhotos: string[] = [];
  const flush = () => {
    if (curRooms.length || curPhotos.length) {
      batches.push({ rooms: curRooms, photos: curPhotos });
      curRooms = [];
      curPhotos = [];
    }
  };

  for (const room of inspection.rooms) {
    const roomPhotos = room.items.flatMap((it) => it.photos);
    if (roomPhotos.length === 0) {
      curRooms.push(room);
      continue;
    }
    if (roomPhotos.length > PHOTOS_PER_BATCH) {
      // Single room with too many photos — flush, then split this room
      flush();
      for (let i = 0; i < roomPhotos.length; i += PHOTOS_PER_BATCH) {
        batches.push({
          rooms: [room],
          photos: roomPhotos.slice(i, i + PHOTOS_PER_BATCH),
        });
      }
      continue;
    }
    if (curPhotos.length + roomPhotos.length > PHOTOS_PER_BATCH) {
      flush();
    }
    curRooms.push(room);
    curPhotos.push(...roomPhotos);
  }
  flush();

  // No rooms at all — single text-only call.
  if (batches.length === 0) {
    onProgress?.("Identifying repairs from findings...");
    const text = compileInspectionText(inspection.rooms, inspection.property, inspection.client);
    return aiParsePdf(text, [], laborRate, licensedTrades, zip);
  }

  // Run batches sequentially so the user sees per-batch progress and we don't
  // burst the Anthropic API. Most inspections fit in one batch.
  const partials: AiParseResult[] = [];
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i];
    const prefix = batches.length > 1 ? `Batch ${i + 1} of ${batches.length}: ` : "";
    const photoLabel = b.photos.length
      ? `${b.photos.length} photo${b.photos.length === 1 ? "" : "s"}`
      : "text only";
    onProgress?.(`${prefix}analyzing ${photoLabel}...`);
    const text = compileInspectionText(b.rooms, inspection.property, inspection.client);
    const imageData = b.photos.length ? await fetchPhotosAsBase64(b.photos) : [];
    const r = await aiParsePdf(text, imageData, laborRate, licensedTrades, zip);
    if (r) partials.push(r);
  }

  if (partials.length === 0) return null;
  const merged = partials.length === 1
    ? partials[0]
    : (onProgress?.("Merging batches..."), mergeParseResults(partials));

  // Safety net: every room that had at least one D or P finding in the
  // inspection input MUST produce at least one line item in the quote.
  // Bernard hit a real case (1021 S Hydraulic, 7 flooring-damaged rooms)
  // where the AI silently dropped 3 of them. The fix in validateQuote
  // prevents the over-aggressive dedup, but a misbehaving AI batch can
  // still skip a room outright. If that happens, synthesize a fallback
  // line item from the inspection finding so the room is never silently
  // dropped — it shows up in the quote with a flag so Bernard can
  // verify pricing.
  const damagedRoomNames = inspection.rooms
    .filter((r) => r.items.some((it) => it.condition === "D" || it.condition === "P"))
    .map((r) => r.name);
  const quotedRoomTokens = new Set<string>();
  merged.rooms.forEach((r) => r.items.forEach((it) => {
    // The detail starts with "Room Name — …". Pull the prefix as a token.
    const prefix = it.detail.split(/\s+[—\-:]/)[0]?.toLowerCase().replace(/\s+/g, " ").trim();
    if (prefix) quotedRoomTokens.add(prefix);
  }));
  const missingRooms = damagedRoomNames.filter((name) => {
    const token = name.toLowerCase().replace(/\s+/g, " ").trim();
    return !quotedRoomTokens.has(token);
  });
  if (missingRooms.length > 0) {
    console.warn(`aiParseInspection: AI dropped ${missingRooms.length} damaged room(s); synthesizing fallback items: ${missingRooms.join(", ")}`);
    onProgress?.(`Adding ${missingRooms.length} skipped room${missingRooms.length === 1 ? "" : "s"}...`);
    for (const name of missingRooms) {
      const room = inspection.rooms.find((r) => r.name === name);
      if (!room) continue;
      const damagedFindings = room.items.filter((it) => it.condition === "D" || it.condition === "P");
      // If the room has known sqft AND any finding mentions floor/carpet/lvp,
      // bias the fallback toward a flooring estimate (most common case in
      // turnover work). Otherwise emit a generic "review needed" line so
      // the room appears and the user can re-quote it manually.
      const hasFlooring = damagedFindings.some((f) =>
        /floor|carpet|lvp|laminate|vinyl|tile/i.test(f.name + " " + f.notes),
      );
      const sqft = room.sqft && room.sqft > 0 ? room.sqft : 0;
      const rate = laborRate || 55;

      // Build a client-clean comment from the inspection findings. The
      // "auto-added by safety net" wording is a developer signal — it
      // belongs in merged.notes (which Bernard sees in the quote header
      // / work order), NOT in the line item comment that ends up on the
      // printed estimate the customer reads.
      const findingNotes = damagedFindings
        .map((f) => f.notes && f.notes.trim() ? f.notes.trim() : "")
        .filter(Boolean)
        .join(" ");

      let fallbackItem;
      if (hasFlooring && sqft > 0) {
        // Pick the flooring material from notes the user / chips left
        // behind. Bernard hit a real bug where bedrooms with "Replace
        // with carpet" notes still synthesized as LVP because the
        // safety net hardcoded LVP regardless of input.
        //
        // Strategy: LAST MENTION WINS. Inspector chips append (and
        // the chip-fix upgrades free-typed fragments to canonical
        // chip text), so the most recent intent the user expressed
        // is at the end of the string. If notes contain both "carpet"
        // and "LVP", the later one is the user's actual decision.
        const noteText = (findingNotes + " " + damagedFindings.map((f) => f.name).join(" ")).toLowerCase();
        const lastIndexOf = (pattern: RegExp): number => {
          const g = new RegExp(pattern.source, "g");
          let last = -1;
          let m;
          while ((m = g.exec(noteText)) !== null) last = m.index;
          return last;
        };
        const carpetIdx = lastIndexOf(/\bcarpet\b/);
        const lvpIdx = lastIndexOf(/\b(lvp|vinyl plank|laminate)\b/);
        const tileIdx = lastIndexOf(/\btile\b/);
        const hardwoodIdx = lastIndexOf(/\b(hardwood|wood floor)\b/);
        const refinishIdx = lastIndexOf(/\brefinish\b/);
        const hardwoodRefinishIdx = (hardwoodIdx >= 0 && refinishIdx >= 0) ? Math.max(hardwoodIdx, refinishIdx) : -1;
        type FloorKind = "carpet" | "lvp" | "tile" | "hardwoodRefinish";
        const candidates: Array<{ kind: FloorKind; idx: number }> = [
          { kind: "carpet" as FloorKind, idx: carpetIdx },
          { kind: "lvp" as FloorKind, idx: lvpIdx },
          { kind: "tile" as FloorKind, idx: tileIdx },
          { kind: "hardwoodRefinish" as FloorKind, idx: hardwoodRefinishIdx },
        ].filter((c) => c.idx >= 0);
        const winner: FloorKind = candidates.length === 0
          ? "lvp"
          : candidates.reduce((a, b) => (b.idx > a.idx ? b : a)).kind;
        const wantsCarpet = winner === "carpet";
        const wantsTile = winner === "tile";
        const wantsHardwoodRefinish = winner === "hardwoodRefinish";
        const baseComment = findingNotes
          || `Existing flooring is damaged and needs replacement.`;
        if (wantsCarpet) {
          // Carpet: 1h per 50 sqft (includes pad). Material $1.75/sqft
          // (carpet) + $0.65/sqft (pad) + $25 disposal. Conservative
          // builder-grade pricing — Bernard tunes per market.
          const hrs = Math.max(2, Math.round((sqft / 50) * 10) / 10);
          const matCarpet = Math.round(sqft * 1.75);
          const matPad = Math.round(sqft * 0.65);
          fallbackItem = {
            id: crypto.randomUUID().slice(0, 8),
            detail: `${name} — Replace flooring (${sqft} sqft, carpet)`,
            condition: "D",
            comment: `${baseComment} Install new carpet and pad across ${sqft} sqft, including existing-floor tear-out and disposal.`,
            laborHrs: Math.max(hrs, Math.ceil((sqft * 1.75) / rate * 10) / 10),
            materials: [
              { n: `Carpet ${sqft} sqft`, c: matCarpet, qty: sqft, unitPrice: 1.75 },
              { n: `Carpet pad ${sqft} sqft`, c: matPad, qty: sqft, unitPrice: 0.65 },
              { n: "Disposal/cleanup", c: 25 },
            ],
          };
        } else if (wantsTile) {
          // Tile: 1h per 18 sqft. Material $4/sqft + 10% waste +
          // $0.75/sqft mortar/grout + $30 transitions + $25 disposal.
          const hrs = Math.max(3, Math.round((sqft / 18) * 10) / 10);
          const matTile = Math.round(sqft * 1.1 * 4.00);
          const matMortar = Math.round(sqft * 0.75);
          fallbackItem = {
            id: crypto.randomUUID().slice(0, 8),
            detail: `${name} — Replace flooring (${sqft} sqft, tile)`,
            condition: "D",
            comment: `${baseComment} Install new tile across ${sqft} sqft, including existing-floor tear-out, subfloor prep, mortar/grout, transitions, and disposal.`,
            laborHrs: Math.max(hrs, Math.ceil((sqft * 3.5) / rate * 10) / 10),
            materials: [
              { n: `Tile ${sqft} sqft (10% waste)`, c: matTile, qty: Math.round(sqft * 1.1), unitPrice: 4.00 },
              { n: "Thinset / grout", c: matMortar },
              { n: "Transition strips", c: 30 },
              { n: "Disposal/cleanup", c: 25 },
            ],
          };
        } else if (wantsHardwoodRefinish) {
          // Refinish only — no replacement material. 1h per 60 sqft.
          // Sand + stain + poly ~ $1/sqft in materials.
          const hrs = Math.max(3, Math.round((sqft / 60) * 10) / 10);
          const matRefinish = Math.round(sqft * 1.00);
          fallbackItem = {
            id: crypto.randomUUID().slice(0, 8),
            detail: `${name} — Refinish hardwood (${sqft} sqft)`,
            condition: "D",
            comment: `${baseComment} Sand existing hardwood across ${sqft} sqft, stain, apply 2-3 coats of polyurethane, and clean.`,
            laborHrs: Math.max(hrs, Math.ceil((sqft * 1.5) / rate * 10) / 10),
            materials: [
              { n: `Sandpaper / stain / poly ${sqft} sqft`, c: matRefinish, qty: sqft, unitPrice: 1.00 },
              { n: "Disposal/cleanup", c: 15 },
            ],
          };
        } else {
          // Default: LVP/Laminate. 1h per 28 sqft (rip+install),
          // $2.00/sqft material with 10% waste, $0.30/sqft underlayment,
          // $30 transitions, $15 disposal.
          const hrs = Math.max(2, Math.round((sqft / 28) * 10) / 10);
          const matLvp = Math.round(sqft * 1.1 * 2.00);
          const matUnder = Math.round(sqft * 0.30);
          fallbackItem = {
            id: crypto.randomUUID().slice(0, 8),
            detail: `${name} — Replace flooring (${sqft} sqft, LVP)`,
            condition: "D",
            comment: `${baseComment} Install new LVP across ${sqft} sqft, including existing-floor tear-out, subfloor prep, transition strips, and disposal.`,
            laborHrs: Math.max(hrs, Math.ceil((sqft * 2.5) / rate * 10) / 10),
            materials: [
              { n: `LVP/Laminate ${sqft} sqft (10% waste)`, c: matLvp, qty: Math.round(sqft * 1.1), unitPrice: 2.00 },
              { n: "Underlayment", c: matUnder },
              { n: "Transition strips", c: 30 },
              { n: "Disposal/cleanup", c: 15 },
            ],
          };
        }
      } else if (hasFlooring) {
        // Damaged flooring but no sqft captured — emit a placeholder
        // that forces Bernard to set sqft before sending the quote.
        const baseComment = findingNotes
          || `Existing flooring is damaged and needs replacement.`;
        fallbackItem = {
          id: crypto.randomUUID().slice(0, 8),
          detail: `${name} — Replace flooring (sqft pending)`,
          condition: "D",
          comment: `${baseComment} Capture the room's W × L in Inspector to refine the labor and material estimate before sending.`,
          laborHrs: 4,
          materials: [{ n: "Flooring + materials (price by sqft)", c: 250 }],
        };
      } else {
        // Non-flooring damage with no AI line item — generic review-
        // required placeholder. Comment lists the inspection findings
        // verbatim so Bernard has the context to re-quote manually.
        const findingsList = damagedFindings
          .map((f) => f.notes?.trim() || f.name)
          .filter(Boolean)
          .join("; ");
        fallbackItem = {
          id: crypto.randomUUID().slice(0, 8),
          detail: `${name} — Review damaged findings`,
          condition: "D",
          comment: findingsList || "Damaged finding requires review on site.",
          laborHrs: 1,
          materials: [{ n: "Materials TBD", c: 50 }],
        };
      }
      // Drop into the appropriate trade bucket (Flooring if flooring,
      // else "Review" — validateQuote will bucket it correctly later).
      const tradeBucket = hasFlooring ? "Flooring" : "Review";
      const existing = merged.rooms.find((r) => r.name === tradeBucket);
      if (existing) {
        existing.items.push(fallbackItem);
      } else {
        merged.rooms.push({ name: tradeBucket, items: [fallbackItem] });
      }
    }
    merged.notes.push(
      `${missingRooms.length} room${missingRooms.length === 1 ? " was" : "s were"} flagged DAMAGED in the inspection but the AI didn't produce a line item — auto-added with conservative pricing. Verify: ${missingRooms.join(", ")}.`,
    );
  }

  // Countertop safety net: if any room (typically Kitchen) has its Counters
  // item flagged D or P in the inspection, the quote MUST include at least
  // one countertop line item. The room-level safety net above only ensures
  // the ROOM has *some* line; the AI sometimes produces a Kitchen item for
  // sink/cabinet/appliance work but silently drops the counter replacement.
  // Mirrors the flooring approach — synthesize a conservative laminate
  // estimate so the bid never goes out missing the counter scope.
  const counterRooms = inspection.rooms.filter((r) =>
    r.items.some((it) =>
      /counter/i.test(it.name) && (it.condition === "D" || it.condition === "P"),
    ),
  );
  const counterMentioned = (text: string) => /counter/i.test(text);
  const missingCounterRooms = counterRooms.filter((r) => {
    const roomToken = r.name.toLowerCase().replace(/\s+/g, " ").trim();
    return !merged.rooms.some((qr) => qr.items.some((it) => {
      const detailRoom = it.detail.split(/\s+[—\-:]/)[0]?.toLowerCase().replace(/\s+/g, " ").trim();
      const matNames = it.materials.map((m) => m.n).join(" ");
      const text = `${it.detail} ${it.comment} ${matNames}`;
      // Match if there's a countertop reference anywhere in this item AND
      // (this item is in the same room as the counters finding, OR there's
      // no obvious room prefix to compare against).
      return counterMentioned(text) && (!detailRoom || detailRoom === roomToken);
    }));
  });
  if (missingCounterRooms.length > 0) {
    console.warn(`aiParseInspection: AI dropped countertop scope for ${missingCounterRooms.length} room(s); synthesizing fallback: ${missingCounterRooms.map((r) => r.name).join(", ")}`);
    onProgress?.(`Adding ${missingCounterRooms.length} countertop line${missingCounterRooms.length === 1 ? "" : "s"}...`);
    for (const room of missingCounterRooms) {
      const counterFinding = room.items.find((it) =>
        /counter/i.test(it.name) && (it.condition === "D" || it.condition === "P"),
      );
      const findingNotes = counterFinding?.notes?.trim() || "";
      // Read material tier hint from the finding notes if user typed
      // "quartz", "granite", etc. Default to laminate (most common
      // rental-grade replacement and the safest cost floor).
      const noteText = findingNotes.toLowerCase();
      let tier: { name: string; matSqft: number; hrs: number } = { name: "laminate", matSqft: 15, hrs: 5 };
      if (/quartz/.test(noteText)) tier = { name: "quartz", matSqft: 60, hrs: 10 };
      else if (/granite/.test(noteText)) tier = { name: "granite", matSqft: 65, hrs: 10 };
      else if (/butcher.?block|wood/.test(noteText)) tier = { name: "butcher block", matSqft: 35, hrs: 5 };
      else if (/solid.?surface|corian/.test(noteText)) tier = { name: "solid surface", matSqft: 50, hrs: 7 };
      // Parse explicit lf/sqft from the notes if the user captured it
      // (e.g., "12 lf laminate", "~25 sqft"). Otherwise default to 12 lf
      // ≈ 25 sqft of counter (standard kitchen).
      const lfMatch = noteText.match(/(\d{1,3})\s*(?:lf|linear ?ft|linear ?feet|ft)\b/);
      const sqftMatch = noteText.match(/(\d{1,3})\s*(?:sqft|sq\.?\s*ft|square ?feet|square ?ft)\b/);
      let counterSqft = 25; // default
      if (sqftMatch) counterSqft = Math.max(8, Math.min(80, parseInt(sqftMatch[1], 10)));
      else if (lfMatch) counterSqft = Math.max(8, Math.min(80, Math.round(parseInt(lfMatch[1], 10) * 25 / 12)));
      const matCost = Math.round(counterSqft * tier.matSqft);
      const hardwareCost = 25; // sink/faucet reset hardware (clips, plumber's putty, supply lines)
      const disposalCost = 25;
      const baseComment = findingNotes ||
        `Existing counters are damaged and need replacement.`;
      const slabNote = (tier.name === "quartz" || tier.name === "granite")
        ? ` Slab is fabricator-supplied; allow ~1-2 weeks lead time after template appointment.`
        : "";
      const fallbackItem = {
        id: crypto.randomUUID().slice(0, 8),
        detail: `${room.name} — Replace countertop (${tier.name}, ~${counterSqft} sqft)`,
        condition: "D",
        comment: `${baseComment} Demo existing top, template, fabricate and install ${tier.name} replacement, reset sink and faucet, re-caulk backsplash.${slabNote}`,
        laborHrs: tier.hrs,
        materials: [
          { n: `${tier.name.charAt(0).toUpperCase()}${tier.name.slice(1)} countertop ${counterSqft} sqft`, c: matCost, qty: counterSqft, unitPrice: tier.matSqft },
          { n: "Sink/faucet reset hardware", c: hardwareCost },
          { n: "Disposal/haul old top", c: disposalCost },
        ],
      };
      // Drop into Carpentry trade bucket if it exists, else create one.
      // Bernard's parser bins counters under Carpentry already (cabinets +
      // countertops travel together). validateQuote runs after this so
      // the placement won't break dedup.
      const tradeBucket = "Carpentry";
      const existing = merged.rooms.find((r) => r.name === tradeBucket);
      if (existing) {
        existing.items.push(fallbackItem);
      } else {
        merged.rooms.push({ name: tradeBucket, items: [fallbackItem] });
      }
    }
    merged.notes.push(
      `${missingCounterRooms.length} room${missingCounterRooms.length === 1 ? "" : "s"} had Counters flagged D/P but the AI didn't include a countertop line — auto-added a conservative replacement (default laminate). Adjust tier/sqft before sending: ${missingCounterRooms.map((r) => r.name).join(", ")}.`,
    );
  }

  return merged;
}

/* ====== VOICE WALK INSPECTION ====== */

type VoiceWalkItem = {
  name?: string;
  condition?: string;
  notes?: string;
  photos?: string[];
};

/**
 * Per-room voice-walk parser: one continuous transcript + an array of
 * timestamped photos + the room's checklist. AI fills the checklist
 * with conditions and notes instead of producing per-photo memos.
 *
 * Photos carry `tsRelativeMs` (ms since recording start) so the model
 * can correlate "what was being said when this photo was taken".
 */
export interface VoiceWalkPhoto {
  url: string;
  tsRelativeMs: number;
}

export async function aiParseVoiceWalkRoom(
  roomName: string,
  transcript: string,
  photos: VoiceWalkPhoto[],
  checklist: string[],
  property: string,
  client: string
): Promise<InspectionRoom["items"]> {
  return processVoiceWalkRoom(roomName, transcript, photos, checklist, property, client);
}

/** New flow: transcript + timestamped photos + checklist → InspectionItems. */
async function processVoiceWalkRoom(
  roomName: string,
  transcript: string,
  photos: VoiceWalkPhoto[],
  checklist: string[],
  property: string,
  client: string
): Promise<InspectionRoom["items"]> {
  // Skip work if there's nothing to analyze.
  const cleanTranscript = (transcript || "").trim();
  if (!cleanTranscript && photos.length === 0) return [];

  // Fetch all photos as base64 for the vision call, in parallel.
  // (Sequential await was a 5–10× slowdown for rooms with several
  //  photos.) Failures keep the array aligned with `photos` via "".
  const imageData: string[] = await Promise.all(
    photos.map(async (p) => {
      try {
        const res = await fetch(p.url);
        const blob = await res.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      } catch {
        return "";
      }
    })
  );

  const fmtTime = (ms: number) => {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  > = [];

  const checklistSection = checklist.length
    ? `\nStandard checklist for this room (use these exact names when applicable):\n${checklist.map((c) => `- ${c}`).join("\n")}\n`
    : `\n(No standard checklist for this room — infer item names from what the inspector mentioned.)\n`;

  content.push({
    type: "text",
    text:
      `Property: ${property || "(unspecified)"}\n` +
      `Client: ${client || "(unspecified)"}\n` +
      `Room: ${roomName}\n` +
      checklistSection +
      `\nFull transcript of the inspector's narration in this room:\n"""\n${cleanTranscript || "(no narration captured)"}\n"""\n\n` +
      `${photos.length} photo${photos.length === 1 ? "" : "s"} follow${photos.length === 1 ? "s" : ""}, in capture order. Each photo's caption marks when it was taken (m:ss into the recording) so you can correlate it with the transcript.\n`,
  });

  photos.forEach((p, i) => {
    if (imageData[i]) {
      const [header, data] = imageData[i].split(",");
      const mediaType = header.match(/image\/([\w]+)/)?.[0] || "image/jpeg";
      content.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data },
      });
    }
    content.push({
      type: "text",
      text: `Photo ${i + 1} — captured at +${fmtTime(p.tsRelativeMs)} — ${p.url}`,
    });
  });

  const system = `You analyze ONE continuous voice-narrated walk-through of a single room with timestamped photos. Your job is to convert the narration + photos into structured inspection items keyed to the room's standard checklist.

OUTPUT one InspectionItem per checklist entry the inspector ACTUALLY mentioned (in the transcript) or that's clearly visible-with-an-issue in a photo. OMIT checklist items that were not addressed at all — assume satisfactory by default.

For each produced item:
- "name": MUST match a checklist entry verbatim when one applies (e.g. "Flooring", "Walls/Ceiling", "Sink/Faucet"). If the inspector clearly raised a non-checklist issue (a built-in bookcase, an exterior shed door, etc.), use a short generic component label instead. Don't invent items the inspector didn't address.
- "condition": EXACTLY one of:
  - "S" — Satisfactory. No issues mentioned, or "looks good", "fine", "no issues".
  - "F" — Fair. Light wear: "dirty", "needs cleaning", "stained", "scuffed", "minor wear", "could use a refresh".
  - "P" — Poor. Needs attention: "broken", "doesn't work", "missing", "loose", "leaking", "torn", "cracked".
  - "D" — Damaged. Urgent / safety / major: "shattered", "rotted", "exposed wires", "fell off", "hazard", "water damage".
- "notes": A clean, professional 1–2 sentence finding suitable for an inspection report. NOT the full transcript verbatim — extract just what's relevant to this item, fix grammar, expand abbreviations, drop filler ("um", "okay so", "this thing is"). Preserve specific details (sizes, locations, quantities, colors) when stated.
- "photos": array of photo URLs that show this item. Match by what's visible in the photo and by what was being said around the time the photo was captured (the photo captions tell you when). A photo can belong to multiple items if appropriate; an item can have zero photos if it was only spoken about.

RULES:
- DO NOT fabricate. If a checklist item wasn't mentioned and isn't visibly damaged in any photo, OMIT it — do not invent a default "S" entry. (We assume omitted items are satisfactory.)
- DO NOT create catch-all "Voice note" / "Recording" / "General" items. Every output item must correspond to a real component the inspector addressed.
- If a single transcript clause covers multiple items ("the floor is dirty and the walls have scuffs"), split into separate items.
- If the transcript was empty but a photo clearly shows damage, include the item with appropriate condition inferred from the photo alone.

Output ONLY valid JSON of this shape:

{
  "items": [
    { "name": "Flooring", "condition": "F", "notes": "Carpet is heavily soiled and shows multiple stains; needs deep cleaning.", "photos": ["https://..."] }
  ]
}`;

  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content }],
    }),
  });

  if (!res.ok) {
    console.error("VoiceWalkRoom AI HTTP error:", res.status, await res.text().catch(() => ""));
    return [];
  }
  const data = await res.json();
  if (data.error) {
    console.error("VoiceWalkRoom AI response error:", data.error);
    return [];
  }
  const responseText = data.content?.[0]?.text || "";
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { items?: VoiceWalkItem[] };
    return (parsed.items || []).map((it) => ({
      name: it.name || "Item",
      condition: typeof it.condition === "string" && /^[SFPD]$/i.test(it.condition)
        ? it.condition.toUpperCase()
        : "F",
      notes: it.notes || "",
      photos: Array.isArray(it.photos) ? it.photos.filter((p): p is string => typeof p === "string") : [],
    }));
  } catch (e) {
    console.error("VoiceWalkRoom JSON parse failed:", e);
    return [];
  }
}


/* ====== TEXT NORMALIZATION ====== */

function norm(raw: string): string {
  let t = raw;
  t = t.replace(
    /\b(Kitchen|Appliances|Laundry Room|Living Room|Dining Room|Entry|Hallway\/Stairs|Garage\/Parking)\b/gi,
    "\n$1\n"
  );
  t = t.replace(
    /\b(Bedroom\s*[\d:]*\s*[:\-]?\s*(?:North|South|Master|East|West)?)/gi,
    "\n$1\n"
  );
  t = t.replace(
    /\b(Bathroom\s*[\d:]*\s*[:\-]?\s*(?:Main|Master|Hall)?[\s\w]*?(?:bathroom)?)/gi,
    "\n$1\n"
  );
  t = t.replace(
    /\b(Compliance\s*[:\-]?\s*\w*|Exterior\s*[:\-]?\s*\w*)\b/gi,
    "\n$1\n"
  );
  t = t.replace(/\b(Maintenance)\b/g, "\n$1\n");
  t = t.replace(/\b(None)\b/g, "\n$1\n");
  t = t.replace(/\s+([SFPD])\s+(Maintenance|None)/g, "\n$1\n$2\n");
  t = t.replace(/\bImage\b/g, "\nImage\n");
  t = t.replace(/\b(View Image|View Video)\b/g, "\n$1\n");
  t = t.replace(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/g, "\n$1\n");
  t = t.replace(/(\d+\.\d+,\s*-?\d+)/g, "\n$1\n");
  t = t.replace(/\bPage \d+/g, "\nPage\n");
  t = t.replace(/\n{2,}/g, "\n");
  return t;
}

/* ====== AUTO-LABOR ESTIMATOR ====== */

export function estimateLabor(t: string): number {
  const s = t.toLowerCase();
  if (/full replace|full repaint|complete repaint/.test(s)) return 7;
  if (s.includes("replace") && /floor|carpet|tile/.test(s)) return 5;
  if (s.includes("water damage")) return 8;
  if (/repaint|full paint/.test(s)) return 7;
  if (s.includes("replace door")) return 2.5;
  if (/refinish|tile wall/.test(s)) return 10;
  if (/touch.?up/.test(s)) return 1.5;
  if (s.includes("patch") && s.includes("paint")) return 2;
  if (s.includes("install") && !s.includes("bulb")) return 1;
  if (s.includes("replace")) return 1;
  if (s.includes("repair")) return 1;
  if (/bulb|battery|filter/.test(s)) return 0.25;
  if (/secure|tighten/.test(s)) return 0.5;
  return 1;
}

/* ====== AUTO-MATERIALS ESTIMATOR — 500+ items ====== */

export function estimateMaterials(t: string): Material[] {
  const s = t.toLowerCase();
  const m: Material[] = [];
  const has = (n: string) => m.some((x) => x.n === n);

  // ── Check curated database first ──
  for (const item of MATERIALS_DB) {
    let matched = false;
    for (const kw of item.keywords) {
      if (kw.length >= 4 && s.includes(kw)) { matched = true; break; }
    }
    if (matched && !has(item.name)) {
      m.push({ n: item.name, c: item.price });
    }
  }
  // If curated DB found matches, return those (skip legacy matching)
  if (m.length > 0) return m;

  // ═══════════════════════════════════════════
  // LEGACY FALLBACK — PAINT & FINISHES (~45 items)
  // ═══════════════════════════════════════════
  if (s.includes("paint") && /full|repaint|complete|entire/.test(s))
    m.push({ n: "Interior paint+primer (gal)", c: 70 }, { n: "Roller kit (9in frame+covers)", c: 14 }, { n: "Angle brush 2.5in", c: 9 }, { n: "Painter's tape (60yd)", c: 7 }, { n: "Drop cloth 9x12", c: 12 });
  else if (/paint|touch.?up/.test(s)) m.push({ n: "Paint (qt)", c: 20 });
  if (/exterior.*paint|paint.*exterior/.test(s)) m.push({ n: "Exterior paint (gal)", c: 75 });
  if (/primer|prime/.test(s) && !has("Interior paint+primer (gal)")) m.push({ n: "Primer (gal)", c: 30 });
  if (/stain|wood stain/.test(s)) m.push({ n: "Wood stain (qt)", c: 18 });
  if (/polyurethane|poly|clear coat/.test(s)) m.push({ n: "Polyurethane (qt)", c: 22 });
  if (/deck.*stain|stain.*deck/.test(s)) m.push({ n: "Deck stain (gal)", c: 45 });
  if (/spray.*paint|rattle can/.test(s)) m.push({ n: "Spray paint", c: 8 });
  if (/texture|orange peel|knockdown/.test(s)) m.push({ n: "Wall texture spray", c: 14 });
  if (/ceiling.*paint|paint.*ceiling/.test(s)) m.push({ n: "Ceiling paint (gal)", c: 35 });
  if (/cabinet.*paint|paint.*cabinet/.test(s)) m.push({ n: "Cabinet paint (qt)", c: 28 });
  if (/epoxy.*paint|garage.*floor.*paint/.test(s)) m.push({ n: "Epoxy floor kit", c: 85 });
  if (/concrete.*stain|stain.*concrete/.test(s)) m.push({ n: "Concrete stain (gal)", c: 40 });
  if (/chalk.*paint/.test(s)) m.push({ n: "Chalk paint (qt)", c: 24 });
  if (/paint.*strip|strip.*paint|remover/.test(s)) m.push({ n: "Paint stripper", c: 16 });
  if (/tray|paint tray/.test(s) && !has("Roller kit (9in frame+covers)")) m.push({ n: "Paint tray+liner", c: 6 });
  if (/roller|paint roller/.test(s) && !has("Roller kit (9in frame+covers)")) m.push({ n: "Roller cover (3pk)", c: 12 });
  if (/masking|tape/.test(s) && s.includes("paint") && !has("Painter's tape (60yd)")) m.push({ n: "Painter's tape (60yd)", c: 7 });
  if (/patch|spackle|nail pop|hole/.test(s) && !s.includes("tire"))
    m.push({ n: "Spackle tub", c: 8 }, { n: "Mesh tape (roll)", c: 5 });
  if (/putty|wood putty|wood filler/.test(s)) m.push({ n: "Wood filler", c: 9 });
  if (/caulk.*paint|paintable.*caulk/.test(s)) m.push({ n: "Paintable caulk", c: 6 });
  if (/sand.*paper|sandpaper|sanding/.test(s)) m.push({ n: "Sandpaper variety pk", c: 10 });
  if (/tsp|degreaser|clean.*wall/.test(s)) m.push({ n: "TSP cleaner", c: 8 });
  if (/wallpaper/.test(s)) m.push({ n: "Wallpaper (roll)", c: 35 });
  if (/wallpaper.*remov|strip.*wallpaper/.test(s)) m.push({ n: "Wallpaper remover", c: 12 });

  // ═══════════════════════════════════════════
  // FLOORING (~40 items)
  // ═══════════════════════════════════════════
  if (s.includes("carpet") && /replace|new|install/.test(s)) m.push({ n: "Carpet (sq yd)", c: 28 }, { n: "Carpet pad (sq yd)", c: 8 }, { n: "Carpet tack strip (4ft)", c: 3 }, { n: "Seam tape", c: 8 });
  else if (s.includes("carpet") && /patch|repair/.test(s)) m.push({ n: "Carpet patch kit", c: 15 });
  else if (s.includes("carpet")) m.push({ n: "Carpet+pad", c: 255 });
  if (s.includes("tile") && s.includes("floor"))
    m.push({ n: "Floor tile (sq ft)", c: 4 }, { n: "Thinset mortar (50lb)", c: 18 }, { n: "Tile spacers", c: 5 }, { n: "Grout (25lb)", c: 16 });
  if (s.includes("tile") && s.includes("wall"))
    m.push({ n: "Wall tile (sq ft)", c: 5 }, { n: "Thinset mortar (50lb)", c: 18 }, { n: "Grout (25lb)", c: 16 });
  if (/flooring|lvp|laminate|vinyl plank/.test(s))
    m.push({ n: "LVP/laminate flooring (box)", c: 55 }, { n: "Underlayment (roll)", c: 25 });
  if (/hardwood|oak floor|wood floor/.test(s) && !s.includes("laminate"))
    m.push({ n: "Hardwood flooring (sq ft)", c: 8 }, { n: "Floor nails/staples", c: 12 });
  if (/engineered.*wood|engineered.*floor/.test(s))
    m.push({ n: "Engineered hardwood (sq ft)", c: 6 }, { n: "Underlayment (roll)", c: 25 });
  if (/vinyl.*sheet|sheet.*vinyl/.test(s)) m.push({ n: "Sheet vinyl (sq yd)", c: 18 });
  if (/linoleum/.test(s)) m.push({ n: "Linoleum (sq yd)", c: 22 });
  if (s.includes("transition")) m.push({ n: "Transition strip", c: 14 });
  if (s.includes("threshold")) m.push({ n: "Door threshold", c: 18 });
  if (/reducer/.test(s)) m.push({ n: "Floor reducer strip", c: 12 });
  if (/t.?mold/.test(s)) m.push({ n: "T-molding", c: 10 });
  if (/quarter.*round|shoe.*mold/.test(s)) m.push({ n: "Quarter round (8ft)", c: 5 });
  if (/grout/.test(s) && !has("Grout (25lb)")) m.push({ n: "Grout (25lb)", c: 16 });
  if (/grout.*seal|seal.*grout/.test(s)) m.push({ n: "Grout sealer", c: 14 });
  if (/floor.*level|self.?level|leveling/.test(s)) m.push({ n: "Self-leveling compound (50lb)", c: 35 });
  if (/subfloor|sub.?floor/.test(s)) m.push({ n: "Subfloor panel (4x8)", c: 32 });
  if (/floor.*adhesive|flooring.*glue/.test(s)) m.push({ n: "Floor adhesive (gal)", c: 28 });
  if (/stair.*nose|stair.*tread/.test(s)) m.push({ n: "Stair nosing", c: 16 });
  if (/rubber.*floor|gym.*floor/.test(s)) m.push({ n: "Rubber flooring tile", c: 6 });
  if (/peel.*stick|peel.?and.?stick/.test(s)) m.push({ n: "Peel & stick tile (box)", c: 28 });
  if (/floor.*sand|sand.*floor|refinish.*floor/.test(s)) m.push({ n: "Floor sanding discs", c: 15 });

  // ═══════════════════════════════════════════
  // DOORS & HARDWARE (~35 items)
  // ═══════════════════════════════════════════
  if (/interior.*door|door.*replace|new.*door/.test(s) && !s.includes("exterior") && !s.includes("garage") && !s.includes("storm"))
    m.push({ n: "Interior prehung door", c: 120 });
  if (/exterior.*door/.test(s)) m.push({ n: "Exterior door", c: 350 });
  if (/storm.*door/.test(s)) m.push({ n: "Storm door", c: 180 });
  if (/sliding.*door|patio.*door/.test(s)) m.push({ n: "Sliding patio door", c: 550 });
  if (/french.*door/.test(s)) m.push({ n: "French door", c: 450 });
  if (/pocket.*door/.test(s)) m.push({ n: "Pocket door kit", c: 175 });
  if (/barn.*door/.test(s)) m.push({ n: "Barn door+hardware", c: 220 });
  if (/garage.*door/.test(s) && !s.includes("opener")) m.push({ n: "Garage door", c: 800 });
  if (/garage.*door.*open|door.*opener/.test(s)) m.push({ n: "Garage door opener", c: 250 });
  if (s.includes("bifold")) m.push({ n: "Bifold door", c: 70 });
  if (/pet.*door|doggy.*door/.test(s)) m.push({ n: "Pet door", c: 45 });
  if (/door.*jamb|jamb/.test(s)) m.push({ n: "Door jamb kit", c: 35 });
  if (/door.*frame/.test(s)) m.push({ n: "Door frame", c: 30 });
  if (/knob|doorknob/.test(s)) m.push({ n: "Door knob", c: 16 });
  if (/lever.*handle|door.*lever/.test(s)) m.push({ n: "Lever handle set", c: 28 });
  if (s.includes("deadbolt")) m.push({ n: "Deadbolt", c: 35 });
  if (/smart.*lock|keypad.*lock|keyless/.test(s)) m.push({ n: "Smart lock", c: 160 });
  if (/lock.*set|entry.*lock/.test(s) && !has("Deadbolt") && !has("Smart lock")) m.push({ n: "Entry lock set", c: 40 });
  if (s.includes("hinge")) m.push({ n: "Hinges (3pk)", c: 14 });
  if (/latch|strike plate/.test(s)) m.push({ n: "Latch/strike plate", c: 14 });
  if (/weatherstrip|door seal/.test(s)) m.push({ n: "Weatherstrip kit", c: 12 });
  if (/door.*sweep|sweep/.test(s)) m.push({ n: "Door sweep", c: 10 });
  if (/door.*stop|door.*bumper/.test(s)) m.push({ n: "Door stop", c: 4 });
  if (/door.*closer|closer/.test(s)) m.push({ n: "Door closer", c: 25 });
  if (/peep.*hole|peephole|door.*viewer/.test(s)) m.push({ n: "Peephole", c: 12 });
  if (/kick.*plate/.test(s)) m.push({ n: "Kick plate", c: 18 });
  if (/door.*knocker/.test(s)) m.push({ n: "Door knocker", c: 22 });
  if (/mail.*slot/.test(s)) m.push({ n: "Mail slot", c: 25 });
  if (/shim/.test(s)) m.push({ n: "Wood shims (pk)", c: 5 });

  // ═══════════════════════════════════════════
  // WINDOWS & BLINDS (~25 items)
  // ═══════════════════════════════════════════
  if (/window.*replace|replace.*window|new.*window/.test(s)) m.push({ n: "Vinyl window", c: 250 });
  if (/double.?hung/.test(s) && !has("Vinyl window")) m.push({ n: "Double-hung window", c: 280 });
  if (/casement/.test(s)) m.push({ n: "Casement window", c: 320 });
  if (/basement.*window|egress/.test(s)) m.push({ n: "Egress window", c: 350 });
  if (/skylight/.test(s)) m.push({ n: "Skylight", c: 400 });
  if (/window.*well/.test(s)) m.push({ n: "Window well", c: 65 });
  if (/storm.*window/.test(s)) m.push({ n: "Storm window", c: 85 });
  if (s.includes("blind") && /faux.*wood|wood.*blind/.test(s)) m.push({ n: "Faux wood blind", c: 35 });
  else if (s.includes("blind")) m.push({ n: "Mini blind", c: 18 });
  if (/cellular.*shade|honeycomb/.test(s)) m.push({ n: "Cellular shade", c: 45 });
  if (/roller.*shade/.test(s)) m.push({ n: "Roller shade", c: 28 });
  if (/curtain.*rod/.test(s)) m.push({ n: "Curtain rod", c: 18 });
  if (/curtain|drape/.test(s) && !s.includes("rod") && !s.includes("shower")) m.push({ n: "Curtain panel", c: 25 });
  if (/window.*film|tint.*window|privacy.*film/.test(s)) m.push({ n: "Window film", c: 14 });
  if (s.includes("screen") && /replace|repair|new/.test(s)) m.push({ n: "Window screen kit", c: 14 });
  else if (s.includes("screen")) m.push({ n: "Screen mesh (roll)", c: 10 });
  if (/window.*(seal|caulk)|caulk.*window/.test(s)) m.push({ n: "Window caulk", c: 9 });
  if (/window.*trim|trim.*window/.test(s)) m.push({ n: "Window casing (7ft)", c: 12 });
  if (s.includes("glass") && /replace|broken|crack/.test(s)) m.push({ n: "Glass pane", c: 40 });
  if (/glazing.*compound|glazing.*point/.test(s)) m.push({ n: "Glazing compound", c: 8 });
  if (/window.*lock|sash.*lock/.test(s)) m.push({ n: "Window lock", c: 8 });

  // ═══════════════════════════════════════════
  // PLUMBING (~55 items)
  // ═══════════════════════════════════════════
  if (/kitchen.*faucet/.test(s)) m.push({ n: "Kitchen faucet", c: 85 });
  else if (/bath.*faucet|lav.*faucet/.test(s)) m.push({ n: "Bathroom faucet", c: 55 });
  else if (/faucet/.test(s)) m.push({ n: "Faucet", c: 65 });
  if (/faucet.*cartridge|cartridge/.test(s) && !has("Faucet")) m.push({ n: "Faucet cartridge", c: 18 });
  if (/faucet.*aerator|aerator/.test(s)) m.push({ n: "Faucet aerator", c: 6 });
  if (/shower head|showerhead/.test(s)) m.push({ n: "Shower head", c: 28 });
  if (/hand.*held.*shower|handheld/.test(s)) m.push({ n: "Handheld shower", c: 35 });
  if (/shower.*valve|shower.*mixer/.test(s)) m.push({ n: "Shower valve", c: 55 });
  if (/shower.*door/.test(s)) m.push({ n: "Shower door", c: 200 });
  if (/shower.*pan|shower.*base/.test(s)) m.push({ n: "Shower pan", c: 180 });
  if (/shower.*curtain/.test(s) && !s.includes("rod")) m.push({ n: "Shower curtain+liner", c: 20 });
  if (/shower.*rod|curtain.*rod.*shower/.test(s)) m.push({ n: "Shower rod", c: 15 });
  if (/tub.*spout|bathtub.*spout/.test(s)) m.push({ n: "Tub spout", c: 22 });
  if (/tub.*drain|bathtub.*drain/.test(s)) m.push({ n: "Tub drain assembly", c: 25 });
  if (/tub.*surround|shower.*surround/.test(s)) m.push({ n: "Tub surround kit", c: 250 });
  if (/toilet.*replace|new.*toilet|install.*toilet/.test(s)) m.push({ n: "Toilet", c: 200 });
  if (/flapper|fill valve|toilet.*run/.test(s)) m.push({ n: "Toilet repair kit", c: 17 });
  if (/wax ring|toilet.*seal/.test(s)) m.push({ n: "Wax ring+bolts", c: 12 });
  if (/toilet seat/.test(s)) m.push({ n: "Toilet seat", c: 25 });
  if (/bidet/.test(s)) m.push({ n: "Bidet seat", c: 80 });
  if (/toilet.*flange/.test(s)) m.push({ n: "Toilet flange", c: 14 });
  if (s.includes("sprayer") && s.includes("kitchen")) m.push({ n: "Kitchen sprayer", c: 17 });
  if (s.includes("stopper")) m.push({ n: "Drain stopper", c: 9 });
  if (/supply line|supply hose/.test(s)) m.push({ n: "Supply line", c: 10 });
  if (/p.?trap/.test(s)) m.push({ n: "P-trap", c: 12 });
  if (/garbage disposal|disposal/.test(s)) m.push({ n: "Disposal 1/2HP", c: 90 });
  if (/sink.*strainer|basket.*strainer/.test(s)) m.push({ n: "Sink strainer", c: 12 });
  if (/kitchen.*sink/.test(s)) m.push({ n: "Kitchen sink (SS)", c: 180 });
  if (/bath.*sink|vanity.*sink|lav.*sink/.test(s)) m.push({ n: "Bathroom sink", c: 75 });
  if (/pedestal.*sink/.test(s)) m.push({ n: "Pedestal sink", c: 140 });
  if (/utility.*sink|laundry.*sink/.test(s)) m.push({ n: "Utility sink", c: 85 });
  if (/drain.*clean|snake|clog|auger/.test(s)) m.push({ n: "Drain snake/auger", c: 15 });
  if (/teflon|thread.*tape|pipe.*tape/.test(s)) m.push({ n: "Teflon tape", c: 3 });
  if (/pipe.*dope|joint.*compound/.test(s)) m.push({ n: "Pipe joint compound", c: 6 });
  if (/pipe.*clamp/.test(s)) m.push({ n: "Pipe clamp", c: 5 });
  if (/shark.?bite|push.?fit/.test(s)) m.push({ n: "SharkBite fitting", c: 10 });
  if (/expansion.*tank/.test(s)) m.push({ n: "Expansion tank", c: 45 });
  if (/hose.*bib|spigot|outdoor.*faucet/.test(s)) m.push({ n: "Hose bib", c: 18 });
  if (/water heater/.test(s) && /tank/.test(s)) m.push({ n: "Tank water heater (50gal)", c: 500 });
  else if (/tankless/.test(s)) m.push({ n: "Tankless water heater", c: 800 });
  else if (/water heater/.test(s)) m.push({ n: "Water heater", c: 450 });
  if (/water heater.*element|element.*heater/.test(s)) m.push({ n: "WH heating element", c: 18 });
  if (/anode.*rod/.test(s)) m.push({ n: "Anode rod", c: 25 });
  if (/sump pump/.test(s)) m.push({ n: "Sump pump", c: 150 });
  if (/ejector pump/.test(s)) m.push({ n: "Ejector pump", c: 250 });
  if (/pex/.test(s)) m.push({ n: "PEX pipe (10ft)", c: 12 });
  if (/copper.*pipe/.test(s)) m.push({ n: "Copper pipe (10ft)", c: 28 });
  if (/pvc.*pipe/.test(s)) m.push({ n: "PVC pipe (10ft)", c: 8 });
  if (/abs.*pipe/.test(s)) m.push({ n: "ABS pipe (10ft)", c: 10 });
  if (/cpvc/.test(s)) m.push({ n: "CPVC pipe (10ft)", c: 10 });
  if (/shut.?off|shut off valve/.test(s)) m.push({ n: "Shut-off valve", c: 15 });
  if (/ball.*valve/.test(s)) m.push({ n: "Ball valve", c: 12 });
  if (/check.*valve/.test(s)) m.push({ n: "Check valve", c: 18 });
  if (/pressure.*regulator|prv/.test(s)) m.push({ n: "Pressure regulator", c: 55 });
  if (/backflow/.test(s)) m.push({ n: "Backflow preventer", c: 45 });
  if (/water.*filter|whole.*house.*filter/.test(s)) m.push({ n: "Water filter system", c: 65 });
  if (/water.*softener/.test(s)) m.push({ n: "Water softener", c: 400 });
  if (/sewer|clean.?out/.test(s)) m.push({ n: "Cleanout plug", c: 8 });
  if (/septic/.test(s)) m.push({ n: "Septic treatment", c: 20 });

  // ═══════════════════════════════════════════
  // ELECTRICAL (~50 items)
  // ═══════════════════════════════════════════
  if (/outlet|receptacle/.test(s) && !s.includes("gfci") && !s.includes("usb")) m.push({ n: "Outlet+plate", c: 8 });
  if (/gfci/.test(s)) m.push({ n: "GFCI outlet", c: 18 });
  if (/afci/.test(s)) m.push({ n: "AFCI outlet", c: 28 });
  if (/usb.*outlet/.test(s)) m.push({ n: "USB outlet", c: 22 });
  if (/outdoor.*outlet|exterior.*outlet|wp.*outlet/.test(s)) m.push({ n: "Outdoor outlet+cover (WP)", c: 22 });
  if (/switch/.test(s) && !/dimmer|switch.*plate|plate/.test(s)) m.push({ n: "Switch+plate", c: 6 });
  if (/3.?way.*switch|three.*way/.test(s)) m.push({ n: "3-way switch", c: 10 });
  if (/dimmer/.test(s)) m.push({ n: "Dimmer switch", c: 22 });
  if (/smart.*switch|wifi.*switch/.test(s)) m.push({ n: "Smart switch", c: 35 });
  if (/timer.*switch|switch.*timer/.test(s)) m.push({ n: "Timer switch", c: 18 });
  if (/motion.*sensor|sensor.*light/.test(s) && !s.includes("outdoor")) m.push({ n: "Motion sensor switch", c: 20 });
  if (/switch.*plate|plate.*cover|wall.*plate/.test(s)) m.push({ n: "Wall plate", c: 3 });
  if (/bulb|lamp/.test(s) && !s.includes("fixture")) m.push({ n: "LED bulbs (4pk)", c: 12 });
  if (/light.*fixture|fixture.*light|chandelier/.test(s)) m.push({ n: "Light fixture", c: 45 });
  if (/vanity.*light/.test(s)) m.push({ n: "Vanity light bar", c: 55 });
  if (/pendant.*light/.test(s)) m.push({ n: "Pendant light", c: 50 });
  if (/flush.*mount|ceiling.*light/.test(s) && !s.includes("fan")) m.push({ n: "Flush mount light", c: 30 });
  if (/track.*light/.test(s)) m.push({ n: "Track light kit", c: 65 });
  if (/under.*cabinet.*light/.test(s)) m.push({ n: "Under-cabinet LED strip", c: 25 });
  if (/ceiling.*fan/.test(s)) m.push({ n: "Ceiling fan", c: 85 });
  if (/recessed|can light/.test(s)) m.push({ n: "Recessed light kit", c: 28 });
  if (/flood.*light|security.*light/.test(s)) m.push({ n: "LED flood light", c: 30 });
  if (/outdoor.*light|porch.*light|exterior.*light/.test(s)) m.push({ n: "Outdoor wall light", c: 35 });
  if (/landscape.*light|path.*light/.test(s)) m.push({ n: "Path light (solar)", c: 8 });
  if (/motion.*light|motion.*flood/.test(s)) m.push({ n: "Motion flood light", c: 35 });
  if (/panel|breaker.*box|electrical.*panel/.test(s)) m.push({ n: "Breaker panel (200A)", c: 220 });
  if (/breaker|circuit.*breaker/.test(s) && !s.includes("panel")) m.push({ n: "Circuit breaker", c: 12 });
  if (/gfci.*breaker/.test(s)) m.push({ n: "GFCI breaker", c: 45 });
  if (/sub.?panel/.test(s)) m.push({ n: "Sub-panel (60A)", c: 120 });
  if (/romex|14\/2|12\/2|wire.*run/.test(s)) m.push({ n: "Romex wire (50ft)", c: 35 });
  if (/14\/3|12\/3/.test(s)) m.push({ n: "3-conductor wire (50ft)", c: 48 });
  if (/10\/2|10.*gauge/.test(s)) m.push({ n: "10/2 wire (50ft)", c: 55 });
  if (/thhn|individual.*wire/.test(s)) m.push({ n: "THHN wire (50ft)", c: 20 });
  if (/wire.*nut|connector/.test(s)) m.push({ n: "Wire nuts (bag)", c: 5 });
  if (/junction.*box/.test(s)) m.push({ n: "Junction box", c: 8 });
  if (/conduit/.test(s)) m.push({ n: "EMT conduit (10ft)", c: 12 });
  if (/outlet.*box|switch.*box|electrical.*box/.test(s)) m.push({ n: "Electrical box", c: 4 });
  if (/surge.*protect|whole.*house.*surge/.test(s)) m.push({ n: "Surge protector (WH)", c: 80 });
  if (/doorbell/.test(s) && !s.includes("video")) m.push({ n: "Doorbell", c: 25 });
  if (/video.*doorbell|smart.*doorbell/.test(s)) m.push({ n: "Video doorbell", c: 150 });
  if (/electric.*meter|meter.*base/.test(s)) m.push({ n: "Meter base", c: 85 });
  if (/ground.*rod/.test(s)) m.push({ n: "Ground rod (8ft)", c: 15 });
  if (/transfer.*switch|generator.*switch/.test(s)) m.push({ n: "Transfer switch", c: 250 });
  if (/ev.*charger|car.*charger/.test(s)) m.push({ n: "EV charger (Level 2)", c: 450 });

  // ═══════════════════════════════════════════
  // SAFETY & DETECTION (~15 items)
  // ═══════════════════════════════════════════
  if (/smoke.*alarm|smoke.*detect/.test(s)) m.push({ n: "Smoke alarm", c: 22 });
  if (/carbon.*monoxide|co.*detect|co.*alarm/.test(s)) m.push({ n: "CO detector", c: 28 });
  if (/combo.*alarm|smoke.*co/.test(s)) m.push({ n: "Smoke/CO combo alarm", c: 35 });
  if (/fire.*ext/.test(s)) m.push({ n: "Fire extinguisher", c: 28 });
  if (/radon/.test(s)) m.push({ n: "Radon detector", c: 30 });
  if (/security.*camera/.test(s)) m.push({ n: "Security camera", c: 60 });
  if (/motion.*detect/.test(s) && !has("Motion flood light") && !has("Motion sensor switch")) m.push({ n: "Motion detector", c: 25 });
  if (/battery.*backup/.test(s)) m.push({ n: "Battery backup (UPS)", c: 65 });
  if (s.includes("battery") && !m.some((x) => x.n.includes("alarm") || x.n.includes("battery"))) m.push({ n: "9V batteries (4pk)", c: 8 });
  if (/gfi.*tester|outlet.*tester/.test(s)) m.push({ n: "Outlet tester", c: 10 });
  if (/child.*proof|child.*safe|tamper.*resist/.test(s)) m.push({ n: "Child safety outlet covers (12pk)", c: 8 });

  // ═══════════════════════════════════════════
  // BATH ACCESSORIES (~20 items)
  // ═══════════════════════════════════════════
  if (/towel.*bar|towel.*rack/.test(s)) m.push({ n: "Towel bar", c: 18 });
  if (/towel.*ring/.test(s)) m.push({ n: "Towel ring", c: 14 });
  if (/towel.*hook|robe.*hook/.test(s)) m.push({ n: "Robe/towel hook", c: 10 });
  if (/tp.*holder|toilet.*paper.*hold/.test(s)) m.push({ n: "TP holder", c: 14 });
  if (s.includes("mirror") && /vanity|bath/.test(s)) m.push({ n: "Vanity mirror", c: 65 });
  else if (s.includes("mirror")) m.push({ n: "Mirror+clips", c: 35 });
  if (/medicine.*cabinet/.test(s)) m.push({ n: "Medicine cabinet", c: 55 });
  if (/bath.*fan|exhaust.*fan|vent.*fan/.test(s)) m.push({ n: "Bath exhaust fan", c: 45 });
  if (/vanity|bath.*cabinet/.test(s) && !s.includes("light") && !s.includes("mirror") && !s.includes("sink"))
    m.push({ n: "Bathroom vanity", c: 300 });
  if (/grab.*bar|safety.*bar/.test(s)) m.push({ n: "Grab bar (18in)", c: 22 });
  if (/soap.*dish/.test(s)) m.push({ n: "Soap dish", c: 10 });
  if (/bath.*accessory.*set/.test(s)) m.push({ n: "Bath accessory set (5pc)", c: 40 });
  if (/heated.*floor|floor.*heat/.test(s)) m.push({ n: "Floor heating mat (kit)", c: 200 });

  // ═══════════════════════════════════════════
  // CAULK, SEALANT & ADHESIVE (~15 items)
  // ═══════════════════════════════════════════
  if (/silicone.*caulk|bath.*caulk/.test(s)) m.push({ n: "Silicone caulk", c: 9 });
  else if (s.includes("caulk") && !has("Silicone caulk") && !has("Paintable caulk") && !has("Window caulk"))
    m.push({ n: "Caulk tube", c: 7 });
  if (/seal|silicone/.test(s) && !m.some((x) => x.n.includes("caulk") || x.n.includes("seal") || x.n.includes("Grout")))
    m.push({ n: "Silicone sealant", c: 9 });
  if (/construction.*adhesive|liquid.*nails/.test(s)) m.push({ n: "Construction adhesive", c: 7 });
  if (/wood.*glue/.test(s)) m.push({ n: "Wood glue", c: 8 });
  if (/epoxy.*adhesive|epoxy.*glue|2.?part.*epoxy/.test(s)) m.push({ n: "Epoxy (2-part)", c: 12 });
  if (/super.*glue|instant.*glue/.test(s)) m.push({ n: "Super glue", c: 5 });
  if (/spray.*adhesive/.test(s)) m.push({ n: "Spray adhesive", c: 10 });
  if (/foam.*sealant|great.*stuff|expanding.*foam/.test(s)) m.push({ n: "Expanding foam sealant", c: 8 });
  if (/butyl.*tape|flashing.*tape/.test(s)) m.push({ n: "Butyl flashing tape", c: 18 });

  // ═══════════════════════════════════════════
  // DRYWALL & FRAMING (~25 items)
  // ═══════════════════════════════════════════
  if (/drywall.*sheet|sheetrock|hang.*drywall/.test(s)) m.push({ n: "Drywall sheet (4x8)", c: 14 });
  else if (/drywall|sheetrock/.test(s) && /patch|repair|hole/.test(s))
    m.push({ n: "Drywall patch kit", c: 15 });
  if (/moisture.*resist.*drywall|green.*board/.test(s)) m.push({ n: "Moisture-resist drywall (4x8)", c: 18 });
  if (/cement.*board|hardi.*backer/.test(s)) m.push({ n: "Cement board (3x5)", c: 14 });
  if (/joint.*compound|mud/.test(s)) m.push({ n: "Joint compound (4.5gal)", c: 16 });
  if (/drywall.*tape|paper.*tape/.test(s)) m.push({ n: "Drywall tape (roll)", c: 5 });
  if (/mesh.*tape/.test(s) && !has("Mesh tape (roll)")) m.push({ n: "Mesh tape (roll)", c: 6 });
  if (/drywall.*screw/.test(s)) m.push({ n: "Drywall screws (1lb)", c: 8 });
  if (/corner.*bead/.test(s)) m.push({ n: "Corner bead (8ft)", c: 5 });
  if (/stud|framing.*lumber|2x4/.test(s)) m.push({ n: "2x4 stud (8ft)", c: 5 });
  if (/2x6/.test(s)) m.push({ n: "2x6 (8ft)", c: 8 });
  if (/2x8/.test(s)) m.push({ n: "2x8 (8ft)", c: 12 });
  if (/2x10/.test(s)) m.push({ n: "2x10 (8ft)", c: 16 });
  if (/2x12/.test(s)) m.push({ n: "2x12 (8ft)", c: 20 });
  if (/header|lvl.*beam/.test(s)) m.push({ n: "LVL beam (12ft)", c: 65 });
  if (/plywood|ply/.test(s)) m.push({ n: "Plywood (4x8 3/4in)", c: 55 });
  if (/osb/.test(s)) m.push({ n: "OSB sheathing (4x8)", c: 28 });
  if (/furring.*strip/.test(s)) m.push({ n: "Furring strip 1x2 (8ft)", c: 3 });
  if (/metal.*stud|steel.*stud/.test(s)) m.push({ n: "Metal stud (8ft)", c: 6 });
  if (/metal.*track|steel.*track/.test(s)) m.push({ n: "Metal track (10ft)", c: 7 });
  if (/joist.*hanger/.test(s)) m.push({ n: "Joist hanger", c: 4 });
  if (/hurricane.*strap|tie.*down/.test(s)) m.push({ n: "Hurricane strap", c: 3 });
  if (/simpson|structural.*bracket/.test(s)) m.push({ n: "Structural bracket", c: 8 });

  // ═══════════════════════════════════════════
  // TRIM & MOLDING (~20 items)
  // ═══════════════════════════════════════════
  if (/baseboard|base.*board/.test(s)) m.push({ n: "Baseboard (8ft)", c: 10 });
  if (/crown.*mold/.test(s)) m.push({ n: "Crown molding (8ft)", c: 12 });
  if (/chair.*rail/.test(s)) m.push({ n: "Chair rail (8ft)", c: 10 });
  if (/casing|door.*trim|window.*casing/.test(s) && !has("Window casing (7ft)")) m.push({ n: "Casing (7ft)", c: 8 });
  if (/quarter.*round/.test(s) && !has("Quarter round (8ft)")) m.push({ n: "Quarter round (8ft)", c: 5 });
  if (/shoe.*mold/.test(s)) m.push({ n: "Shoe molding (8ft)", c: 4 });
  if (/wainscot/.test(s)) m.push({ n: "Wainscoting panel (4x8)", c: 35 });
  if (/beadboard/.test(s)) m.push({ n: "Beadboard panel", c: 28 });
  if (/picture.*rail|picture.*mold/.test(s)) m.push({ n: "Picture rail (8ft)", c: 8 });
  if (/rosette/.test(s)) m.push({ n: "Corner rosette", c: 5 });
  if (/plinth.*block/.test(s)) m.push({ n: "Plinth block", c: 6 });
  if (/stair.*railing|hand.*rail|banister/.test(s)) m.push({ n: "Handrail (8ft)", c: 25 });
  if (/baluster|spindle/.test(s)) m.push({ n: "Baluster (each)", c: 8 });
  if (/newel.*post/.test(s)) m.push({ n: "Newel post", c: 45 });
  if (/finish.*nail|brad.*nail/.test(s)) m.push({ n: "Finish nails (pk)", c: 8 });

  // ═══════════════════════════════════════════
  // KITCHEN & COUNTERTOP (~25 items)
  // ═══════════════════════════════════════════
  if (/laminate.*counter/.test(s)) m.push({ n: "Laminate countertop (8ft)", c: 120 });
  if (/granite.*counter/.test(s)) m.push({ n: "Granite countertop (sq ft)", c: 55 });
  if (/quartz.*counter/.test(s)) m.push({ n: "Quartz countertop (sq ft)", c: 65 });
  if (/butcher.*block/.test(s)) m.push({ n: "Butcher block counter (6ft)", c: 180 });
  if (/backsplash|back.*splash/.test(s)) m.push({ n: "Backsplash tile (sq ft)", c: 6 });
  if (/peel.*stick.*back/.test(s)) m.push({ n: "Peel & stick backsplash", c: 35 });
  if (/range.*hood|vent.*hood/.test(s)) m.push({ n: "Range hood", c: 180 });
  if (/cabinet.*door/.test(s)) m.push({ n: "Cabinet door (each)", c: 25 });
  if (/cabinet.*hardware|cabinet.*pull|cabinet.*knob/.test(s)) m.push({ n: "Cabinet pulls (10pk)", c: 28 });
  if (/cabinet.*hinge|soft.*close/.test(s)) m.push({ n: "Soft-close hinges (pk)", c: 18 });
  if (/drawer.*slide|drawer.*glide/.test(s)) m.push({ n: "Drawer slides (pair)", c: 18 });
  if (/lazy.*susan/.test(s)) m.push({ n: "Lazy Susan", c: 35 });
  if (/shelf.*liner/.test(s)) m.push({ n: "Shelf liner (roll)", c: 10 });
  if (/under.?mount.*sink/.test(s)) m.push({ n: "Undermount sink", c: 200 });
  if (/pot.*filler/.test(s)) m.push({ n: "Pot filler faucet", c: 150 });
  if (/ice.*maker.*line/.test(s)) m.push({ n: "Ice maker line", c: 12 });
  if (/dishwasher.*line|dishwasher.*hose/.test(s)) m.push({ n: "Dishwasher supply line", c: 15 });
  if (/appliance.*cord|range.*cord/.test(s)) m.push({ n: "Appliance power cord", c: 22 });
  if (s.includes("refinish") && !has("Refinish kit")) m.push({ n: "Cabinet refinish kit", c: 55 });

  // ═══════════════════════════════════════════
  // EXTERIOR & SIDING (~30 items)
  // ═══════════════════════════════════════════
  if (/vinyl.*siding/.test(s)) m.push({ n: "Vinyl siding (sq)", c: 95 });
  if (/hardie|fiber.*cement|cement.*siding/.test(s)) m.push({ n: "Fiber cement siding (sq)", c: 140 });
  if (/wood.*siding|lap.*siding/.test(s)) m.push({ n: "Wood lap siding (8ft)", c: 12 });
  if (/t1-?11|t-111/.test(s)) m.push({ n: "T1-11 siding (4x8)", c: 45 });
  if (s.includes("downspout")) m.push({ n: "Downspout (10ft)", c: 22 });
  if (/gutter/.test(s) && !s.includes("downspout")) m.push({ n: "Gutter section (10ft)", c: 18 });
  if (/gutter.*guard|leaf.*guard/.test(s)) m.push({ n: "Gutter guard (4ft)", c: 8 });
  if (/house.*number|address.*number/.test(s)) m.push({ n: "House numbers", c: 12 });
  if (/mailbox/.test(s)) m.push({ n: "Mailbox+post", c: 45 });
  if (/fence.*board|picket/.test(s)) m.push({ n: "Fence picket (6ft)", c: 5 });
  if (/fence.*post/.test(s)) m.push({ n: "Fence post (4x4 8ft)", c: 14 });
  if (/fence.*panel|privacy.*fence/.test(s)) m.push({ n: "Privacy fence panel (6x8)", c: 65 });
  if (/chain.*link/.test(s)) m.push({ n: "Chain link fence (50ft roll)", c: 80 });
  if (/gate/.test(s) && !s.includes("billing")) m.push({ n: "Gate hardware kit", c: 22 });
  if (/deck.*board|composite.*deck/.test(s)) m.push({ n: "Composite deck board (12ft)", c: 30 });
  if (/pressure.*treat|pt.*lumber/.test(s)) m.push({ n: "PT lumber 2x6 (8ft)", c: 10 });
  if (/deck.*screw/.test(s)) m.push({ n: "Deck screws (5lb)", c: 28 });
  if (/joist.*tape/.test(s)) m.push({ n: "Joist tape (roll)", c: 22 });
  if (/post.*cap/.test(s)) m.push({ n: "Post cap", c: 8 });
  if (/lattice/.test(s)) m.push({ n: "Lattice panel (4x8)", c: 25 });
  if (/concrete.*step|precast.*step/.test(s)) m.push({ n: "Precast step", c: 60 });
  if (/paver/.test(s)) m.push({ n: "Pavers (sq ft)", c: 4 });
  if (/retaining.*wall.*block/.test(s)) m.push({ n: "Retaining wall block", c: 5 });
  if (/landscape.*timber/.test(s)) m.push({ n: "Landscape timber (8ft)", c: 8 });
  if (/french.*drain/.test(s)) m.push({ n: "French drain pipe (10ft)", c: 15 });
  if (/sod/.test(s)) m.push({ n: "Sod (pallet)", c: 250 });
  if (/mulch/.test(s)) m.push({ n: "Mulch (bag)", c: 5 });
  if (/power.*wash|pressure.*wash/.test(s)) m.push({ n: "Pressure washer detergent", c: 12 });

  // ═══════════════════════════════════════════
  // CONCRETE & MASONRY (~20 items)
  // ═══════════════════════════════════════════
  if (/concrete.*mix|bag.*concrete|quikrete/.test(s)) m.push({ n: "Concrete mix (80lb bag)", c: 7 });
  if (/concrete.*patch|patch.*concrete/.test(s)) m.push({ n: "Concrete patch (qt)", c: 12 });
  if (/concrete.*crack|crack.*fill/.test(s)) m.push({ n: "Concrete crack filler", c: 8 });
  if (/concrete.*seal|seal.*concrete/.test(s)) m.push({ n: "Concrete sealer (gal)", c: 35 });
  if (/rebar/.test(s)) m.push({ n: "Rebar #4 (10ft)", c: 8 });
  if (/wire.*mesh|welded.*wire/.test(s)) m.push({ n: "Wire mesh (5x10 sheet)", c: 12 });
  if (/anchor.*bolt/.test(s)) m.push({ n: "Anchor bolts (10pk)", c: 10 });
  if (/mortar.*mix/.test(s)) m.push({ n: "Mortar mix (60lb)", c: 8 });
  if (/concrete.*block|cmu|cinder.*block/.test(s)) m.push({ n: "Concrete block (8x8x16)", c: 3 });
  if (/brick/.test(s)) m.push({ n: "Brick (each)", c: 1 });
  if (/tuck.?point|repoint/.test(s)) m.push({ n: "Tuckpointing mortar", c: 12 });
  if (/stone.*veneer/.test(s)) m.push({ n: "Stone veneer (sq ft)", c: 12 });
  if (/form.*tube|sono.*tube/.test(s)) m.push({ n: "Sonotube (12in x 4ft)", c: 15 });
  if (/post.*hole|post.*mix/.test(s)) m.push({ n: "Fast-set post mix (50lb)", c: 8 });

  // ═══════════════════════════════════════════
  // INSULATION (~15 items)
  // ═══════════════════════════════════════════
  if (/batt.*insul|fiberglass.*insul|r.?13|r.?19/.test(s)) m.push({ n: "Fiberglass batt insulation (roll)", c: 40 });
  if (/blown.*insul|cellulose/.test(s)) m.push({ n: "Blown-in insulation (bag)", c: 18 });
  if (/foam.*board|rigid.*foam|xps/.test(s)) m.push({ n: "Foam board insulation (4x8)", c: 22 });
  if (/spray.*foam.*insul/.test(s)) m.push({ n: "Spray foam insulation kit", c: 450 });
  if (/pipe.*insul|pipe.*wrap/.test(s)) m.push({ n: "Pipe insulation (6ft)", c: 4 });
  if (/duct.*insul|duct.*wrap/.test(s)) m.push({ n: "Duct insulation wrap", c: 22 });
  if (/attic.*insul/.test(s) && !m.some((x) => x.n.includes("insulation"))) m.push({ n: "Attic insulation (roll R-30)", c: 55 });
  if (/radiant.*barrier/.test(s)) m.push({ n: "Radiant barrier (roll)", c: 65 });
  if (/weather.*seal|foam.*tape/.test(s)) m.push({ n: "Foam weatherseal tape", c: 6 });
  if (/vapor.*barrier|plastic.*sheet|visqueen/.test(s)) m.push({ n: "Vapor barrier (roll)", c: 30 });
  if (/house.*wrap|tyvek/.test(s)) m.push({ n: "House wrap (roll)", c: 120 });

  // ═══════════════════════════════════════════
  // HVAC (~25 items)
  // ═══════════════════════════════════════════
  if (/thermostat/.test(s) && /smart|wifi|nest|ecobee/.test(s)) m.push({ n: "Smart thermostat", c: 140 });
  else if (/thermostat/.test(s) && !has("Smart thermostat")) m.push({ n: "Thermostat (digital)", c: 35 });
  if (/condenser|ac.*unit|outside.*unit/.test(s)) m.push({ n: "Condenser unit", c: 1400 });
  if (/evaporator.*coil|a.?coil/.test(s)) m.push({ n: "Evaporator coil", c: 450 });
  if (/furnace.*filter|hvac.*filter|air.*filter/.test(s)) m.push({ n: "HVAC filter (4pk)", c: 22 });
  else if (/filter/.test(s) && !m.some((x) => x.n.includes("Filter") || x.n.includes("filter"))) m.push({ n: "Filter", c: 12 });
  if (/ductwork|duct.*run/.test(s)) m.push({ n: "Duct section (4ft)", c: 25 });
  if (/flex.*duct/.test(s)) m.push({ n: "Flex duct (25ft)", c: 35 });
  if (/duct.*tape|foil.*tape/.test(s)) m.push({ n: "Foil duct tape", c: 10 });
  if (/duct.*mastic|duct.*seal/.test(s)) m.push({ n: "Duct mastic (gal)", c: 15 });
  if (/register|vent.*cover|air.*vent/.test(s)) m.push({ n: "Vent register", c: 8 });
  if (/return.*grille|return.*air/.test(s)) m.push({ n: "Return air grille", c: 14 });
  if (/refrigerant|freon|r.?410/.test(s)) m.push({ n: "Refrigerant (lb)", c: 75 });
  if (/blower.*motor|fan.*motor/.test(s)) m.push({ n: "Blower motor", c: 200 });
  if (/capacitor/.test(s)) m.push({ n: "Capacitor", c: 18 });
  if (/contactor/.test(s)) m.push({ n: "Contactor", c: 25 });
  if (/mini.?split|ductless/.test(s)) m.push({ n: "Mini-split system", c: 900 });
  if (/window.*ac|window.*unit/.test(s)) m.push({ n: "Window AC unit", c: 250 });
  if (/portable.*ac/.test(s)) m.push({ n: "Portable AC", c: 350 });
  if (/humidifier.*whole/.test(s)) m.push({ n: "Whole-house humidifier", c: 180 });
  if (/dehumidifier/.test(s)) m.push({ n: "Dehumidifier", c: 200 });
  if (/line.*set|refrigerant.*line/.test(s)) m.push({ n: "Line set (25ft)", c: 65 });
  if (/condensate.*pump|condensate.*drain/.test(s)) m.push({ n: "Condensate pump", c: 45 });
  if (/uv.*light.*hvac|uv.*purif/.test(s)) m.push({ n: "UV air purifier", c: 120 });

  // ═══════════════════════════════════════════
  // ROOFING (~20 items)
  // ═══════════════════════════════════════════
  if (/3.?tab.*shingle/.test(s)) m.push({ n: "3-tab shingles (bundle)", c: 30 });
  else if (/architect.*shingle|dimensional/.test(s)) m.push({ n: "Architectural shingles (bundle)", c: 40 });
  else if (/shingle/.test(s) && !has("3-tab shingles (bundle)") && !has("Architectural shingles (bundle)")) m.push({ n: "Shingles (bundle)", c: 35 });
  if (/metal.*roof|standing.*seam/.test(s)) m.push({ n: "Metal roofing panel (3x12)", c: 35 });
  if (/rubber.*roof|epdm|membrane/.test(s)) m.push({ n: "EPDM membrane (sq ft)", c: 3 });
  if (/roof.*felt|tar.*paper/.test(s)) m.push({ n: "Roof felt (roll)", c: 25 });
  if (/ice.*water.*shield|ice.*barrier/.test(s)) m.push({ n: "Ice & water shield (roll)", c: 55 });
  if (/synthetic.*underlayment/.test(s)) m.push({ n: "Synthetic underlayment (roll)", c: 65 });
  if (/flashing/.test(s)) m.push({ n: "Flashing (10ft)", c: 15 });
  if (/step.*flashing/.test(s)) m.push({ n: "Step flashing (pk)", c: 18 });
  if (/ridge.*vent|roof.*vent/.test(s)) m.push({ n: "Ridge vent (4ft)", c: 18 });
  if (/roof.*vent|turbine/.test(s) && !has("Ridge vent (4ft)")) m.push({ n: "Roof turbine vent", c: 35 });
  if (/drip.*edge/.test(s)) m.push({ n: "Drip edge (10ft)", c: 10 });
  if (/roof.*cement|roof.*sealant|henry/.test(s)) m.push({ n: "Roof cement (gal)", c: 14 });
  if (/soffit/.test(s)) m.push({ n: "Soffit panel (12ft)", c: 22 });
  if (/fascia/.test(s)) m.push({ n: "Fascia board (12ft)", c: 25 });
  if (/roof.*nail|coil.*nail/.test(s)) m.push({ n: "Roofing nails (5lb)", c: 12 });
  if (/boot|pipe.*boot|roof.*boot/.test(s)) m.push({ n: "Pipe boot", c: 12 });
  if (/skylight.*flash/.test(s)) m.push({ n: "Skylight flashing kit", c: 55 });
  if (/gutter.*spike|gutter.*screw/.test(s)) m.push({ n: "Gutter screws (pk)", c: 8 });

  // ═══════════════════════════════════════════
  // GAS (~8 items)
  // ═══════════════════════════════════════════
  if (/gas.*line|gas.*pipe|gas.*flex/.test(s)) m.push({ n: "Gas flex line", c: 25 });
  if (/gas.*valve/.test(s)) m.push({ n: "Gas valve", c: 35 });
  if (/gas.*connector/.test(s)) m.push({ n: "Gas connector", c: 20 });
  if (/gas.*shutoff/.test(s) && !has("Gas valve")) m.push({ n: "Gas shut-off valve", c: 22 });
  if (/black.*pipe|gas.*pipe.*iron/.test(s)) m.push({ n: "Black iron pipe (10ft)", c: 18 });
  if (/gas.*fitting|black.*fitting/.test(s)) m.push({ n: "Black iron fitting", c: 6 });
  if (/gas.*leak.*detect/.test(s)) m.push({ n: "Gas leak detector spray", c: 8 });
  if (/csst|corrugated.*gas/.test(s)) m.push({ n: "CSST gas line (per ft)", c: 5 });

  // ═══════════════════════════════════════════
  // FASTENERS & HARDWARE (~30 items)
  // ═══════════════════════════════════════════
  if (/wood.*screw/.test(s)) m.push({ n: "Wood screws (1lb box)", c: 10 });
  if (/sheet.*metal.*screw|self.*tap/.test(s)) m.push({ n: "Sheet metal screws (pk)", c: 8 });
  if (/lag.*bolt|lag.*screw/.test(s)) m.push({ n: "Lag bolts (10pk)", c: 10 });
  if (/carriage.*bolt/.test(s)) m.push({ n: "Carriage bolts (10pk)", c: 8 });
  if (/machine.*screw/.test(s)) m.push({ n: "Machine screws (pk)", c: 6 });
  if (/concrete.*screw|tapcon/.test(s)) m.push({ n: "Tapcon screws (pk)", c: 12 });
  if (/toggle.*bolt/.test(s)) m.push({ n: "Toggle bolts (pk)", c: 8 });
  if (/anchor|drywall.*anchor|wall.*anchor/.test(s) && !m.some((x) => x.n.includes("anchor")))
    m.push({ n: "Wall anchors (pk)", c: 6 });
  if (/nail|common.*nail|framing.*nail/.test(s) && !m.some((x) => x.n.includes("nail")))
    m.push({ n: "Framing nails (5lb)", c: 12 });
  if (/washer/.test(s) && !s.includes("power") && !s.includes("pressure") && !s.includes("dish")) m.push({ n: "Washers (pk)", c: 4 });
  if (/nut.*bolt|hex.*nut/.test(s)) m.push({ n: "Hex nut assortment", c: 8 });
  if (/eye.*bolt|eye.*hook/.test(s)) m.push({ n: "Eye bolts (pk)", c: 6 });
  if (/spring|extension.*spring/.test(s) && !s.includes("door")) m.push({ n: "Springs assortment", c: 8 });
  if (/chain|jack.*chain/.test(s) && !s.includes("link")) m.push({ n: "Chain (per ft)", c: 3 });
  if (/s.?hook/.test(s)) m.push({ n: "S-hooks (pk)", c: 5 });
  if (/carabiner|snap.*hook/.test(s)) m.push({ n: "Snap hooks (pk)", c: 6 });
  if (/cable.*tie|zip.*tie/.test(s)) m.push({ n: "Cable ties (100pk)", c: 8 });
  if (/nail.*plate|protect.*plate/.test(s)) m.push({ n: "Nail plates (pk)", c: 6 });
  if (/strap.*tie|metal.*strap/.test(s)) m.push({ n: "Metal strap tie", c: 5 });
  if (/shelf.*bracket|bracket/.test(s) && !m.some((x) => x.n.includes("bracket"))) m.push({ n: "Shelf brackets (pair)", c: 10 });
  if (/shelf|shelving/.test(s) && !has("Shelf brackets (pair)")) m.push({ n: "Shelf+brackets", c: 22 });
  if (/hook|coat.*hook|wall.*hook/.test(s) && !m.some((x) => x.n.includes("hook"))) m.push({ n: "Wall hooks (pk)", c: 8 });

  // ═══════════════════════════════════════════
  // APPLIANCE PARTS & MISC (~20 items)
  // ═══════════════════════════════════════════
  if (/dryer.*vent|dryer.*duct/.test(s)) m.push({ n: "Dryer vent kit", c: 22 });
  if (/dryer.*cord/.test(s)) m.push({ n: "Dryer power cord", c: 25 });
  if (/washer.*hose|washing.*machine.*hose/.test(s)) m.push({ n: "Washer hoses (pair)", c: 20 });
  if (/washer.*box|washing.*machine.*box/.test(s)) m.push({ n: "Washer outlet box", c: 28 });
  if (/range.*cord|stove.*cord/.test(s) && !has("Appliance power cord")) m.push({ n: "Range power cord", c: 22 });
  if (/refrigerator.*line|fridge.*line/.test(s)) m.push({ n: "Refrigerator water line", c: 15 });
  if (/garbage.*disposal|disposal/.test(s) && !has("Disposal 1/2HP")) m.push({ n: "Disposal 1/3HP", c: 75 });
  if (/water.*line.*connect/.test(s)) m.push({ n: "Water line connector kit", c: 12 });
  if (/attic.*ladder|pull.?down.*stair/.test(s)) m.push({ n: "Attic ladder", c: 200 });
  if (/closet.*rod/.test(s)) m.push({ n: "Closet rod+sockets", c: 12 });
  if (/closet.*organizer|closet.*system/.test(s)) m.push({ n: "Closet organizer kit", c: 85 });
  if (/wire.*shelving/.test(s)) m.push({ n: "Wire shelf (4ft)", c: 15 });
  if (/garage.*storage|wall.*organizer/.test(s)) m.push({ n: "Garage wall organizer", c: 35 });
  if (/ceiling.*hook|plant.*hook/.test(s)) m.push({ n: "Ceiling hooks (pk)", c: 6 });
  if (/picture.*hang|picture.*hook/.test(s)) m.push({ n: "Picture hanging kit", c: 8 });
  if (/tv.*mount|wall.*mount.*tv/.test(s)) m.push({ n: "TV wall mount", c: 35 });
  if (/weather.*vane/.test(s)) m.push({ n: "Weather vane", c: 45 });
  if (/house.*wrap.*tape|zip.*system.*tape/.test(s)) m.push({ n: "Zip system tape", c: 22 });

  if (m.length === 0) m.push({ n: "Misc materials", c: 17 });
  return m;
}

/* ====== MAIN PARSER — parseZI ====== */

const ROOM_PATTERNS: RegExp[] = [
  /^(Kitchen)\b/i,
  /^(Appliances)\b/i,
  /^(Laundry\s*Room)\b/i,
  /^(Living\s*Room)\b/i,
  /^(Dining\s*Room)\b/i,
  /^(Entry)\b/i,
  /^(Hallway\/Stairs)\b/i,
  /^(Bedroom\s*[\d:]*\s*[:\-]?\s*\w*)/i,
  /^(Bathroom\s*[\d:]*\s*[:\-]?\s*\w*)/i,
  /^(Garage\/Parking)\b/i,
  /^(Compliance\s*[:\-]?\s*\w*)/i,
  /^(Exterior\s*[:\-]?\s*\w*)/i,
];

const SKIP_SET = new Set([
  "Image",
  "View Image",
  "View Video",
  "None",
  "S",
  "F",
  "P",
  "D",
  "-",
  "Detail",
  "Condition",
  "Actions",
  "Comment",
  "Media",
]);

function shouldSkip(l: string): boolean {
  return (
    SKIP_SET.has(l) ||
    /^\d{4}-\d{2}/.test(l) ||
    /^\d+\.\d+,/.test(l) ||
    l.startsWith("Page") ||
    l.startsWith("Report") ||
    l === "Maintenance"
  );
}

export function parseZI(raw: string): Room[] {
  if (!raw || raw.length < 50) return [];
  const text = norm(raw);
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const rooms: Room[] = [];
  let cur: Room | null = null;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    let rm: string | null = null;
    for (const p of ROOM_PATTERNS) {
      const m = ln.match(p);
      if (m && ln.length < 50 && !ln.includes("Condition")) {
        rm = m[1];
        break;
      }
    }
    if (rm) {
      cur = {
        name: rm.replace(/\s+/g, " ").replace(/:/g, " ").trim(),
        items: [],
      };
      rooms.push(cur);
      continue;
    }
    if (!cur || ln !== "Maintenance") continue;

    let det = "";
    let cond = "-";
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const p = lines[j];
      if ("SFPD".includes(p) && p.length === 1) {
        cond = p;
        continue;
      }
      if (p === "-") continue;
      if (shouldSkip(p)) continue;
      if (p.length > 2) {
        det = p;
        break;
      }
    }

    let com = "";
    for (let j = i + 1; j < Math.min(lines.length, i + 10); j++) {
      const n = lines[j];
      if (shouldSkip(n)) continue;
      if (n === "Maintenance" || n === "None") break;
      let nr = false;
      for (const p of ROOM_PATTERNS)
        if (p.test(n) && n.length < 50) {
          nr = true;
          break;
        }
      if (nr) break;
      if (n.length > 3) {
        com += (com ? " " : "") + n;
      }
      if (com.length > 40) break;
    }

    if (det || com) {
      cur.items.push({
        id: crypto.randomUUID().slice(0, 8),
        detail: det || "General",
        condition: cond,
        comment: com || "Maintenance required",
        laborHrs: estimateLabor(com + " " + det),
        materials: estimateMaterials(com + " " + det),
      });
    }
  }

  const filtered = rooms.filter((r) => r.items.length > 0);
  if (filtered.length === 0) return rxParse(raw);
  return filtered;
}

/* ====== FALLBACK PARSER ====== */

function rxParse(raw: string): Room[] {
  const roomMap: Record<string, Room> = {};
  const roomNames = [
    "Kitchen",
    "Appliances",
    "Laundry Room",
    "Living Room",
    "Dining Room",
    "Entry",
    "Hallway",
    "Bedroom",
    "Bathroom",
    "Garage",
    "Compliance",
    "Exterior",
  ];
  let si = 0;

  while (true) {
    const idx = raw.indexOf("Maintenance", si);
    if (idx === -1) break;
    si = idx + 11;

    const bef = raw.substring(Math.max(0, idx - 200), idx);
    const aft = raw.substring(idx + 11, Math.min(raw.length, idx + 300));

    let room = "General";
    for (const r of roomNames)
      if (bef.lastIndexOf(r) !== -1) {
        room = r;
        break;
      }

    const dm = bef.match(/([\w\s/]+?)(?:\s+[SFPD\-]\s*)?$/);
    let det = dm
      ? dm[1].trim().split(/\s{2,}/).pop() || "General"
      : "General";
    if (det.length > 40) det = det.slice(-40).trim();
    if (det.length < 3) det = "General";

    const cm = aft.match(
      /^\s*(.{5,80}?)(?=\s*(?:Image|View|Maintenance|None|\d{4}-\d{2}|Page|$))/
    );
    const com = cm ? cm[1].trim() : "Maintenance required";

    const cdm = bef.match(/\b([SFPD])\s*$/);
    const cond = cdm ? cdm[1] : "-";

    if (/^Detail|^Condition|^Actions/.test(det)) continue;

    if (!roomMap[room]) roomMap[room] = { name: room, items: [] };
    roomMap[room].items.push({
      id: crypto.randomUUID().slice(0, 8),
      detail: det,
      condition: cond,
      comment: com,
      laborHrs: estimateLabor(com + " " + det),
      materials: estimateMaterials(com + " " + det),
    });
  }
  return Object.values(roomMap).filter((r) => r.items.length > 0);
}

/* ====== CLASSIFIER ====== */

export interface ClassifiedIssues {
  critical: (RoomItem & { room: string })[];
  important: (RoomItem & { room: string })[];
  minor: (RoomItem & { room: string })[];
}

export function classify(rooms: Room[]): ClassifiedIssues {
  const c: (RoomItem & { room: string })[] = [];
  const im: (RoomItem & { room: string })[] = [];
  const mi: (RoomItem & { room: string })[] = [];

  rooms.forEach((r) =>
    r.items.forEach((it) => {
      const e = { room: r.name, ...it };
      const t = (it.comment + " " + it.detail).toLowerCase();
      if (
        /water damage|water intrusion|ungrounded|missing smoke|smoke alarm.*(missing|no )|fire ext.*missing|electrician|code compliance|carbon monoxide|structural|mold/.test(
          t
        )
      )
        c.push(e);
      else if (
        it.condition === "D" ||
        /broken|horrible|severe|full replace|cracked|detached|off track|failed/.test(t)
      )
        im.push(e);
      else mi.push(e);
    })
  );
  return { critical: c, important: im, minor: mi };
}

/* ====== GUIDE GENERATOR ====== */

export interface GuideStep {
  room: string;
  detail: string;
  action: string;
  pri: "HIGH" | "MED" | "LOW";
  hrs: number;
}

export interface Guide {
  tools: string[];
  shop: (Material & { room: string })[];
  steps: GuideStep[];
}

export function makeGuide(rooms: Room[]): Guide {
  const tools = new Set<string>();
  const shop: (Material & { room: string })[] = [];
  const steps: GuideStep[] = [];

  // Collect all item text to determine what tools are actually needed
  const allText = rooms
    .flatMap((r) => r.items.map((it) => (it.comment + " " + it.detail).toLowerCase()))
    .join(" ");

  // Only add base tools that are relevant to the job
  tools.add("PPE");
  tools.add("Tape measure");
  if (/mount|hang|screw|install|secure|bracket|shelf|anchor|towel|tp holder|door|hinge|blind|fixture|replace/.test(allText))
    tools.add("Drill/driver");
  if (/level|mount|hang|shelf|mirror|blind|cabinet/.test(allText))
    tools.add("Level");
  if (/cut|trim|carpet|vinyl|lvp|screen|caulk|flooring/.test(allText))
    tools.add("Utility knife");
  if (/caulk|seal|gap/.test(allText))
    tools.add("Caulk gun");
  if (/patch|spackle|drywall|hole|nail pop/.test(allText))
    tools.add("Putty knife");
  if (/ceiling|high|smoke|detector|light|fan|bulb/.test(allText))
    tools.add("Step ladder");
  if (/dust|sand|demo|tile|drywall|debris/.test(allText))
    tools.add("Shop vac");

  // Job-specific tool sets — POWER TOOLS + HAND TOOLS
  if (/paint|repaint|touch.?up|prime/.test(allText)) {
    ["Roller+covers", "Angled brush", "Drop cloths", "Painters tape", "Paint tray"].forEach((x) => tools.add(x));
    if (/patch|spackle|hole|nail pop|drywall/.test(allText))
      tools.add("Spackle knife");
    if (/sand|smooth|prep/.test(allText))
      ["Sanding block", "Orbital sander"].forEach((x) => tools.add(x));
    if (/spray|sprayer/.test(allText))
      tools.add("Paint sprayer");
    if (/scrape|peel/.test(allText))
      tools.add("Paint scraper");
  }
  if (/tile|grout/.test(allText)) {
    ["Tile cutter", "Notched trowel", "Grout float", "Tile spacers", "Sponge", "Mixing bucket"].forEach((x) => tools.add(x));
    if (/remove|demo|tear/.test(allText))
      ["Oscillating multi-tool", "Cold chisel"].forEach((x) => tools.add(x));
  }
  if (/plumb|shower|toilet|faucet|sink|drain|pipe|valve|sprayer|supply line|water/.test(allText)) {
    ["Adjustable wrench", "Plumbers tape", "Channel locks", "Basin wrench", "Bucket"].forEach((x) => tools.add(x));
    if (/toilet/.test(allText)) tools.add("Closet bolts wrench");
    if (/pipe|cut/.test(allText)) tools.add("Pipe cutter");
    if (/drain|clog/.test(allText)) tools.add("Drain snake/auger");
  }
  if (/electric|outlet|switch|wire|gfci|light|fan|fixture/.test(allText)) {
    ["Voltage tester", "Wire strippers", "Wire nuts", "Electrical tape"].forEach((x) => tools.add(x));
    if (/fan|fixture|heavy/.test(allText)) tools.add("Stud finder");
    if (/wire|run|fish/.test(allText)) tools.add("Fish tape");
  }
  if (/door|hinge|knob|deadbolt|strike|latch/.test(allText)) {
    ["Chisel", "Hammer", "Stud finder"].forEach((x) => tools.add(x));
    if (/pre.?hung|replace|new|install/.test(allText))
      ["Circular saw", "Shims", "Level (4ft)"].forEach((x) => tools.add(x));
  }
  if (/carpet|flooring|lvp|laminate|vinyl/.test(allText)) {
    ["Knee kicker", "Seam roller", "Tapping block", "Rubber mallet", "Pull bar", "Spacers"].forEach((x) => tools.add(x));
    if (/transition|trim|baseboard|cut/.test(allText))
      ["Miter saw", "Circular saw"].forEach((x) => tools.add(x));
    if (/lvp|laminate|plank/.test(allText))
      tools.add("Jigsaw");
    if (/demo|remove|tear|rip/.test(allText))
      ["Pry bar", "Floor scraper"].forEach((x) => tools.add(x));
  }
  if (/drywall|sheetrock/.test(allText)) {
    ["Drywall saw", "Drywall knife (6\")", "Drywall knife (12\")", "Mud pan", "Sanding block", "T-square"].forEach((x) => tools.add(x));
    if (/large|sheet|hang/.test(allText))
      ["Drywall lift", "Screw gun"].forEach((x) => tools.add(x));
  }
  if (/baseboard|trim|molding|crown/.test(allText)) {
    ["Miter saw", "Brad nailer", "Nail set", "Wood filler"].forEach((x) => tools.add(x));
  }
  if (/cabinet|counter|shelf|shelving/.test(allText)) {
    ["Stud finder", "Clamps"].forEach((x) => tools.add(x));
    if (/cut|modify/.test(allText))
      ["Circular saw", "Jigsaw"].forEach((x) => tools.add(x));
  }
  if (/caulk|seal|grout/.test(allText))
    tools.add("Caulk finishing tool");
  if (/screen|window screen/.test(allText))
    tools.add("Screen roller");
  if (/demo|remove|tear out|rip out/.test(allText)) {
    ["Pry bar", "Hammer", "Reciprocating saw"].forEach((x) => tools.add(x));
  }
  if (/exterior|gutter|downspout|siding|fascia|soffit/.test(allText))
    ["Extension ladder", "Tin snips"].forEach((x) => tools.add(x));
  if (/mirror|glass/.test(allText))
    tools.add("Suction cups");
  if (/fence|gate|deck|post/.test(allText))
    ["Post level", "Circular saw", "Impact driver"].forEach((x) => tools.add(x));
  if (/concrete|mortar|cement/.test(allText))
    ["Mixing drill + paddle", "Trowel", "Float"].forEach((x) => tools.add(x));
  // General power tools based on scope
  if (/cut|saw|trim/.test(allText) && !tools.has("Circular saw") && !tools.has("Miter saw"))
    tools.add("Oscillating multi-tool");
  if (/screw|mount|install|secure/.test(allText))
    tools.add("Impact driver");

  rooms.forEach((r) =>
    r.items.forEach((it) => {
      // Use actual stored materials — no re-derivation, no scaling
      it.materials.forEach((mat) => {
        const matQty = mat.qty && mat.qty > 0 ? mat.qty : 1;
        if (mat.c > 0 && mat.n !== "Materials" && mat.n !== "Mat") {
          shop.push({ n: mat.n, c: mat.c, room: r.name, qty: matQty });
        } else if (mat.c > 0) {
          // Generic "Materials" entry — use item detail as name
          shop.push({ n: it.detail || "Materials", c: mat.c, room: r.name, qty: matQty });
        }
      });

      const pri: "HIGH" | "MED" | "LOW" =
        it.condition === "D" ? "HIGH" : it.condition === "P" ? "MED" : "LOW";
      steps.push({
        room: r.name,
        detail: it.detail,
        action: it.comment,
        pri,
        hrs: it.laborHrs,
      });
    })
  );

  // Sort steps by trade first (workflow order: rough trades → finishes →
  // safety/compliance → cleanup), then by priority within each trade. This
  // groups items so a tech doesn't bounce between toolboxes mid-job.
  const TRADE_WORKFLOW = [
    "Plumbing",
    "Electrical",
    "Carpentry",
    "Appliances",
    "Exterior",
    "Flooring",
    "Painting",
    "Safety",
    "Compliance",
    "Cleaning/Hauling",
  ];
  const tradeIndex = (room: string): number => {
    const i = TRADE_WORKFLOW.indexOf(room);
    return i === -1 ? TRADE_WORKFLOW.length : i; // unknowns sort to the end
  };
  const priOrder = { HIGH: 0, MED: 1, LOW: 2 };
  steps.sort((a, b) => {
    const ti = tradeIndex(a.room) - tradeIndex(b.room);
    if (ti !== 0) return ti;
    // Same trade: keep alphabetical by room name (stable for unknown trades),
    // then priority within the same room.
    if (a.room !== b.room) return a.room.localeCompare(b.room);
    return priOrder[a.pri] - priOrder[b.pri];
  });

  // Smart consolidation — group similar materials by category
  const grouped: Record<string, { name: string; totalCost: number; qty: number; rooms: Set<string> }> = {};

  // Normalize material names for grouping
  const getGroupKey = (name: string): string => {
    const n = name.toLowerCase();
    if (/paint.*primer|primer.*paint|paint.*gal|interior paint/.test(n)) return "Interior Paint (gal)";
    if (/paint.*qt|paint \(qt\)/.test(n)) return "Paint (qt)";
    if (/roller|brush|tape.*paint|drop cloth|paint tray|paint.*suppl/.test(n)) return "Paint Supplies";
    if (/spackle|mesh|joint compound|mud/.test(n)) return "Patching Supplies";
    if (/lvp|laminate|vinyl plank|flooring/.test(n)) return "LVP Flooring (sq ft)";
    if (/underlayment/.test(n)) return "Underlayment";
    if (/transition/.test(n)) return "Transition Strips";
    if (/grout/.test(n)) return "Grout";
    if (/tile.*mortar|mortar|adhesive.*tile|tile.*adhesive/.test(n)) return "Tile Mortar/Adhesive";
    if (/floor tile|wall tile|ceramic.*tile/.test(n)) return "Tile (sq ft)";
    if (/caulk|silicone/.test(n)) return "Caulk/Sealant";
    if (/smoke alarm|smoke detector/.test(n)) return "Smoke Alarms";
    if (/outlet.*plate|cover plate/.test(n)) return "Outlet/Switch Plates";
    if (/blind/.test(n)) return "Window Blinds";
    if (/bulb/.test(n)) return "LED Bulbs";
    if (/9v|battery/.test(n)) return "Batteries";
    return name; // keep as-is if no group match
  };

  shop.forEach((item) => {
    const key = getGroupKey(item.n);
    const itemQty = item.qty && item.qty > 0 ? item.qty : 1;
    if (grouped[key]) {
      grouped[key].qty += itemQty;
      grouped[key].totalCost += item.c;
      grouped[key].rooms.add(item.room);
    } else {
      grouped[key] = { name: key, totalCost: item.c, qty: itemQty, rooms: new Set([item.room]) };
    }
  });

  // Total up room names for trade fallback
  const roomTradeMap: Record<string, string> = {};
  shop.forEach((item) => { roomTradeMap[getGroupKey(item.n)] = item.room; });

  // Classify each material into a shopping aisle/trade
  const classifyShopTrade = (name: string, roomTrade: string): string => {
    const n = name.toLowerCase();
    // Specific material matches first
    if (/faucet|toilet|shower|tub|drain|p.?trap|disposal|supply.*line|valve|pipe|sprayer|stopper|wax.*ring|aerator|bidet|sump|pex|copper|pvc|shut.?off/.test(n)) return "🔧 Plumbing";
    if (/paint|primer|roller|brush|drop cloth|stain|poly|texture/.test(n)) return "🎨 Paint & Supplies";
    if (/spackle|patch|joint.*compound|mesh.*tape|drywall.*tape|putty/.test(n)) return "🎨 Paint & Supplies";
    if (/painter.*tape/.test(n)) return "🎨 Paint & Supplies";
    if (/carpet|lvp|laminate|vinyl.*floor|flooring|underlayment|transition|baseboard|quarter.*round|seam.*tape|tack.*strip/.test(n)) return "🪵 Flooring";
    if (/tile|grout|mortar|thinset|spacer/.test(n)) return "🔲 Tile";
    if (/outlet|switch|wire|breaker|gfci|bulb|dimmer|conduit/.test(n)) return "⚡ Electrical";
    if (/light.*fixture|fixture|ceiling.*fan|vanity.*light|pendant|flush.*mount|flood.*light|outdoor.*light|wall.*light/.test(n)) return "⚡ Electrical";
    if (/smoke|co.*detect|fire.*ext|alarm|detector/.test(n)) return "🛡 Safety";
    if (/battery|9v/.test(n)) return "🛡 Safety";
    if (/door|knob|hinge|lock|deadbolt|bifold|pocket|barn|strike|latch|sweep|closer|kick.*plate/.test(n)) return "🔨 Doors & Hardware";
    if (/blind|screen|window.*lock|window.*film|shade|curtain/.test(n)) return "🔨 Doors & Hardware";
    if (/mirror|medicine.*cabinet|towel|tp.*holder|grab.*bar|soap|shower.*rod/.test(n)) return "🔨 Doors & Hardware";
    if (/shelf|bracket|rod|closet|cabinet.*pull|cabinet.*hinge|drawer.*slide|cabinet.*door|refinish/.test(n)) return "🔨 Doors & Hardware";
    if (/handrail|baluster|newel/.test(n)) return "🔨 Doors & Hardware";
    if (/caulk|silicone|adhesive|glue|foam|sealant/.test(n)) return "🧴 Caulk & Adhesive";
    if (/fence|gate|gutter|downspout|deck|siding|landscape|mailbox|paver|porch/.test(n)) return "🏠 Exterior";
    if (/window(?!.*blind|.*screen|.*lock|.*film).*/.test(n) && /vinyl|replace|double/.test(n)) return "🏠 Exterior";
    if (/filter|hvac|thermostat/.test(n)) return "🔧 Plumbing";
    // Fall back to the item's trade category
    if (roomTrade.includes("Paint")) return "🎨 Paint & Supplies";
    if (roomTrade.includes("Plumb")) return "🔧 Plumbing";
    if (roomTrade.includes("Floor")) return "🪵 Flooring";
    if (roomTrade.includes("Electric")) return "⚡ Electrical";
    return "📦 General";
  };

  const consolidatedShop = Object.values(grouped).map((g) => ({
    n: g.qty > 1 ? `${g.name} (×${g.qty})` : g.name,
    c: g.totalCost,
    room: [...g.rooms].join(", "),
    trade: classifyShopTrade(g.name, [...g.rooms].join(", ")),
  }));

  // Sort by trade category for organized shopping
  const tradeOrder = ["🎨 Paint & Supplies", "🪵 Flooring", "🔲 Tile", "🔧 Plumbing", "⚡ Electrical", "🛡 Safety", "🔨 Carpentry & Hardware", "🧴 Caulk & Adhesive", "🏠 Exterior", "📦 General"];
  consolidatedShop.sort((a, b) => tradeOrder.indexOf(a.trade) - tradeOrder.indexOf(b.trade));

  return { tools: [...tools].sort(), shop: consolidatedShop, steps };
}

/* ====== COST CALCULATOR ====== */

export function calculateCost(
  it: RoomItem,
  rate: number
): { lc: number; mc: number; tot: number } {
  const lc = it.laborHrs * rate;
  const mc = it.materials.reduce((s, m) => s + (m.c || 0), 0);
  return { lc, mc, tot: Math.round((lc + mc) * 100) / 100 };
}
