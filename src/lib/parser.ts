import type { Room, RoomItem, Material } from "./types";
import { db } from "./supabase";

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

export async function renderPdfPages(
  file: File,
  maxPages = 15,
  scale = 1.0
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
    images.push(canvas.toDataURL("image/jpeg", 0.5));
    canvas.remove();
  }
  return images;
}

/* ====== AI PARSE ====== */

const AI_SYSTEM_PROMPT_BASE = `You are a service estimate generator for a field service contractor. You take property inspection reports as input and produce accurate, client-ready service estimates.

## INPUT FORMAT
Property inspection reports contain room-by-room findings with condition ratings (S=Satisfactory, F=Fair, P=Poor, D=Damaged) and action items marked "Maintenance".

## CRITICAL RULE — DEDUPLICATION
zInspector reports contain the SAME data TWICE:
- SUMMARY TABLE (early pages): Has "Area" + "Detail" + "Condition" columns in a table. SKIP THIS ENTIRELY.
- DETAILED BREAKDOWNS (later pages): Room names as section headers with expanded descriptions. USE ONLY THIS.
If you process both, every item will be doubled. The final quote should have 20-40 line items, NOT 60-100+.

## LINE ITEM FORMAT
Every line item MUST include:
- "detail": "Room Name — Brief task description" (e.g. "Kitchen — Replace sprayer and re-caulk sink")
- "comment": Clear 1-2 sentence work description referencing the inspection finding. The client must understand WHAT will be done.
- "laborHrs": Conservative clock hours for one worker
- "materials": Only materials that directly correspond to a specific inspection finding

## RULES

1. NEVER INSERT PLACEHOLDER ITEMS. Every material must map to a specific inspection finding. If you cannot trace a material back to the report, do not include it. Watch especially for high-cost items appearing in multiple rooms — that is always a bug.

2. NO DUPLICATES. Each repair appears exactly ONCE. Do NOT create both granular items and consolidated room summaries.

3. CONSISTENT ROOM NAMES. Use title case. Normalize names from the inspection (e.g. "Bathroom 2 : Master bathroom" → "Bathroom 2 (Master)").

4. GROUP BY TRADE, NOT BY ROOM. Valid categories:
   Painting, Flooring, Carpentry, Plumbing, Electrical, Safety, Appliances, Exterior, Compliance, Cleaning/Hauling

5. COMBINE RELATED ITEMS in the same room. "Replace outlet cover" + "replace switch plate" in Kitchen = one Electrical line item. "Touch up wall paint" + "patch holes" = one Painting line item.

6. SHARED SUPPLIES ONCE. Paint rollers, tape, drop cloths, brushes, spackle go in ONE "General Supplies" item under Painting, NOT duplicated per room.

7. ONLY QUOTE MAINTENANCE ITEMS. Condition "S" with Action "None" = skip.

## LABOR HOURS — CONSERVATIVE ESTIMATES (clock hours, single worker)
Quick tasks: outlet cover=0.1h, bulb=0.1h, smoke alarm=0.2h, doorstop=0.1h, toilet seat=0.2h, blind=0.2h, door knob=0.3h, towel bar=0.2h, caulk=0.25h, door stop=0.1h, light fixture swap=0.5h
Medium tasks: vanity light=0.5h, screen door=1h, re-secure door=0.5h, drywall patch=0.3h, faucet=1h, shower head=0.3h
Painting (prep INCLUDED — do NOT add extra): touch-up=1h, small room full=2-3h, medium room=3-4h, large room=4-5h, hallway=2h
Flooring: LVP small room=3-4h, large room=4-5h, baseboard per room=1-2h, tile per 30sqft=4-5h
Doors: pre-hung door=1.5h, bifold=1h, entry door=2h

## MATERIALS — LOW-END RETAIL PRICES
Smoke alarm=$18, outlet cover=$1, door knob=$15, pre-hung door=$85, bifold door=$50, blind=$10, ceiling fixture=$25, vanity light=$30, toilet seat=$18, shower head=$22, shower rod=$12, towel bar=$12, caulk=$5, screen door=$80, faucet=$55, toilet repair kit=$15, LVP=$1.50/sqft
Paint: 1-gal=$16, 5-gal=$35, primer qt=$10. Full unit supplies (tape, spackle, rollers, cloths)=$30 total — list ONCE.

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
          "condition": "F|P|D|-",
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
- Total hours: 20-50 for typical 3-bed make-ready. Over 60 = re-check for duplicates.
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
function validateQuote(rooms: Room[]): Room[] {
  // 1. Detect phantom materials — same high-cost item in 3+ rooms = likely a bug
  const materialCount: Record<string, { count: number; totalCost: number }> = {};
  rooms.forEach((r) => r.items.forEach((it) => it.materials.forEach((m) => {
    const key = m.n.toLowerCase();
    if (!materialCount[key]) materialCount[key] = { count: 0, totalCost: 0 };
    materialCount[key].count++;
    materialCount[key].totalCost += m.c;
  })));

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

  // 3. Deduplicate items with identical details within same room
  rooms = rooms.map((r) => {
    const seen = new Set<string>();
    return {
      ...r,
      items: r.items.filter((it) => {
        const key = (it.detail + "|" + it.comment).toLowerCase().slice(0, 80);
        if (seen.has(key)) {
          console.warn(`VALIDATION: Duplicate item removed — "${it.detail}"`);
          return false;
        }
        seen.add(key);
        return true;
      }),
    };
  });

  // 4. Cap unreasonable hours (no single item should exceed 8h for most tasks)
  rooms = rooms.map((r) => ({
    ...r,
    items: r.items.map((it) => {
      if (it.laborHrs > 8) {
        console.warn(`VALIDATION: Capped hours for "${it.detail}" from ${it.laborHrs}h to 6h`);
        return { ...it, laborHrs: 6 };
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

  // 6. RE-GROUP BY TRADE — if AI returned room-based groups, convert to trade-based
  const TRADE_CATEGORIES = ["Painting", "Flooring", "Carpentry", "Plumbing", "Electrical", "Safety", "Appliances", "Exterior", "Compliance", "Cleaning/Hauling"];
  const isAlreadyTradeGrouped = rooms.every((r) => TRADE_CATEGORIES.some((t) => r.name.toLowerCase().includes(t.toLowerCase())));

  if (!isAlreadyTradeGrouped && rooms.length > 0) {
    console.warn("VALIDATION: Rooms are not trade-grouped. Re-grouping by trade.");
    const tradeMap: Record<string, RoomItem[]> = {};

    const classifyTrade = (item: RoomItem, roomName: string): string => {
      const s = (item.detail + " " + item.comment + " " + roomName + " " + item.materials.map((m) => m.n).join(" ")).toLowerCase();
      if (/paint|primer|spackle|patch.*wall|wall.*patch|repaint|touch.?up|texture|ceiling.*paint/.test(s)) return "Painting";
      if (/floor|carpet|lvp|laminate|tile.*floor|vinyl|transition|baseboard|quarter.*round|threshold/.test(s)) return "Flooring";
      if (/plumb|faucet|toilet|sink|shower|tub|drain|p.?trap|disposal|water.*heater|supply.*line|shut.*off|sprayer|stopper|caulk.*tub|caulk.*shower/.test(s)) return "Plumbing";
      if (/outlet|switch|wire|breaker|panel|gfci|light.*fixture|bulb|ceiling.*fan|recessed|dimmer|electrical/.test(s)) return "Electrical";
      if (/smoke.*alarm|co.*detect|fire.*ext|carbon.*monoxide|battery.*alarm|detector/.test(s)) return "Safety";
      if (/door|knob|hinge|lock|deadbolt|bifold|pocket|barn|blind|window|screen|mirror|cabinet|shelf|closet|rod|towel.*bar|tp.*holder|handle|latch|strike/.test(s)) return "Carpentry";
      if (/oven|stove|dishwasher|fridge|refrigerator|washer|dryer|appliance|microwave|range.*hood/.test(s)) return "Appliances";
      if (/exterior|fence|gate|gutter|downspout|porch|deck|siding|landscape|mailbox|stair.*rail/.test(s)) return "Exterior";
      if (/filter|compliance|hvac.*filter|code/.test(s)) return "Compliance";
      if (/clean|haul|trash|debris|junk/.test(s)) return "Cleaning/Hauling";
      return "Carpentry"; // default
    };

    rooms.forEach((r) => {
      r.items.forEach((it) => {
        const trade = classifyTrade(it, r.name);
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

export async function aiParsePdf(
  text: string,
  images: string[],
  laborRate?: number,
  licensedTrades?: string[]
): Promise<AiParseResult | null> {
  try {
    // Load recent price corrections for AI learning
    let correctionsPrompt = "";
    try {
      const corrections = await db.get<{
        item_name: string; original_hours: number; corrected_hours: number;
        original_mat_cost: number; corrected_mat_cost: number; trade: string;
      }>("price_corrections");
      if (corrections.length > 0) {
        // Aggregate corrections by item type
        const byItem: Record<string, { hrsAdj: number[]; matAdj: number[]; count: number }> = {};
        corrections.slice(0, 100).forEach((c) => {
          const key = c.item_name.toLowerCase().replace(/[^a-z\s]/g, "").trim();
          if (!key) return;
          if (!byItem[key]) byItem[key] = { hrsAdj: [], matAdj: [], count: 0 };
          if (c.corrected_hours !== c.original_hours) byItem[key].hrsAdj.push(c.corrected_hours);
          if (c.corrected_mat_cost !== c.original_mat_cost) byItem[key].matAdj.push(c.corrected_mat_cost);
          byItem[key].count++;
        });
        const lessons = Object.entries(byItem)
          .filter(([, v]) => v.count >= 2) // only use patterns with 2+ corrections
          .slice(0, 20)
          .map(([item, v]) => {
            const parts = [];
            if (v.hrsAdj.length) {
              const avgHrs = v.hrsAdj.reduce((a, b) => a + b, 0) / v.hrsAdj.length;
              parts.push(`typically ${avgHrs.toFixed(1)}h`);
            }
            if (v.matAdj.length) {
              const avgMat = v.matAdj.reduce((a, b) => a + b, 0) / v.matAdj.length;
              parts.push(`materials ~$${avgMat.toFixed(0)}`);
            }
            return parts.length ? `- ${item}: ${parts.join(", ")}` : null;
          })
          .filter(Boolean);
        if (lessons.length) {
          correctionsPrompt = `\nLEARNED PRICING (from past job corrections by this team — use these when applicable):\n${lessons.join("\n")}\n\n`;
        }
      }
    } catch { /* corrections not available, continue without */ }

    // Build content array with text + images
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
    > = [];

    // Add images first so AI sees the visual context
    for (const img of images) {
      const [header, data] = img.split(",");
      const mediaType = header.match(/image\/([\w]+)/)?.[0] || "image/jpeg";
      content.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data },
      });
    }

    // Add extracted text
    if (text.trim()) {
      content.push({
        type: "text",
        text: `Here is the extracted text from the inspection report:\n\n${text.slice(0, 30000)}`,
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
        model: "claude-sonnet-4-20250514",
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
      // If payload too large, retry with fewer images
      if (res.status === 413 || res.status === 400) {
        if (images.length > 5) {
          console.log("Retrying with fewer pages...");
          return aiParsePdf(text, images.slice(0, 5), laborRate, licensedTrades);
        }
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
        model: "claude-sonnet-4-20250514",
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

export async function aiParseInspection(
  inspection: InspectionInput,
  laborRate?: number,
  licensedTrades?: string[]
): Promise<AiParseResult | null> {
  // Compile inspection into structured text
  let text = `PROPERTY INSPECTION REPORT\n`;
  text += `Property: ${inspection.property}\n`;
  text += `Client: ${inspection.client}\n`;
  text += `Date: ${new Date().toLocaleDateString()}\n\n`;

  const allPhotos: string[] = [];

  inspection.rooms.forEach((room) => {
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
        allPhotos.push(...item.photos);
      }
      text += `\n`;
    });
    text += `\n`;
  });

  // Fetch photos as base64 for AI vision
  const imageData: string[] = [];
  for (const url of allPhotos.slice(0, 20)) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      imageData.push(base64);
    } catch {
      // skip failed photo fetches
    }
  }

  return aiParsePdf(text, imageData, laborRate, licensedTrades);
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

  // ═══════════════════════════════════════════
  // PAINT & FINISHES (~45 items)
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
      // Re-derive specific materials from item text instead of using stored generics
      const itemText = (it.comment + " " + it.detail).toLowerCase();
      const specificMats = estimateMaterials(itemText);
      const storedTotal = it.materials.reduce((s, x) => s + (x.c || 0), 0);
      const specificTotal = specificMats.reduce((s, x) => s + (x.c || 0), 0);

      if (specificMats.length === 1 && specificMats[0].n === "Misc materials" && storedTotal > 0) {
        // No specific materials detected — use stored but with the item detail as the name
        shop.push({ n: it.detail || "Materials", c: storedTotal, room: r.name });
      } else {
        // Scale specific materials to match the stored total if user adjusted it
        const scale = storedTotal > 0 && specificTotal > 0 ? storedTotal / specificTotal : 1;
        specificMats.forEach((mat) =>
          shop.push({ n: mat.n, c: Math.round(mat.c * scale), room: r.name })
        );
      }
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

  const priOrder = { HIGH: 0, MED: 1, LOW: 2 };
  steps.sort((a, b) => priOrder[a.pri] - priOrder[b.pri]);

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
    if (grouped[key]) {
      grouped[key].qty += 1;
      grouped[key].totalCost += item.c;
      grouped[key].rooms.add(item.room);
    } else {
      grouped[key] = { name: key, totalCost: item.c, qty: 1, rooms: new Set([item.room]) };
    }
  });

  const consolidatedShop = Object.values(grouped).map((g) => ({
    n: g.qty > 1 ? `${g.name} (×${g.qty})` : g.name,
    c: g.totalCost,
    room: [...g.rooms].join(", "),
  }));

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
