import type { Room, RoomItem, Material } from "./types";

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
  return new Promise((res) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      res(window.pdfjsLib);
    };
    document.head.appendChild(s);
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
  maxPages = 20,
  scale = 1.5
): Promise<string[]> {
  const lib = await loadPdf();
  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: buf }).promise;
  const images: string[] = [];
  const count = Math.min(pdf.numPages, maxPages);

  for (let i = 1; i <= count; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL("image/jpeg", 0.7));
    canvas.remove();
  }
  return images;
}

/* ====== AI PARSE ====== */

const AI_SYSTEM_PROMPT = `You are a construction/handyman inspection report parser. Extract maintenance items from inspection reports.

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "property": "address if found or empty string",
  "rooms": [
    {
      "name": "Room Name",
      "items": [
        {
          "detail": "Item name (e.g. Door, Walls, Flooring)",
          "condition": "S|F|P|D (Satisfactory/Fair/Poor/Damaged) or - if unknown",
          "comment": "Description of work needed",
          "laborHrs": 1.0,
          "materials": [{"n": "Material name", "c": 20}]
        }
      ]
    }
  ]
}

Rules:
- Only include items that need MAINTENANCE or REPAIR work
- Skip items marked as "Satisfactory" or "None" with no issues
- Group items by room (Kitchen, Bedroom 1, Bathroom, etc.)
- Estimate laborHrs: bulb/battery=0.25h, touch-up=1.5h, replace=1h, repaint=5h, water damage=8h
- Estimate material costs realistically: paint=$20-70, carpet=$255, tile=$160, blind=$18, door=$80, smoke alarm=$20
- If you see photos showing damage, include those observations in the comments
- Be thorough — capture every maintenance item mentioned or visible`;

export interface AiParseResult {
  property: string;
  rooms: Room[];
}

export async function aiParsePdf(
  text: string,
  images: string[]
): Promise<AiParseResult | null> {
  try {
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
      text: "Parse this inspection report and extract all maintenance items. Return ONLY the JSON.",
    });

    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        system: AI_SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;

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
          laborHrs: it.laborHrs || 1,
          materials: it.materials?.length
            ? it.materials
            : [{ n: "Materials", c: 17 }],
        })),
      })
    );

    return {
      property: parsed.property || "",
      rooms: rooms.filter((r) => r.items.length > 0),
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
  if (/full replace|full repaint|complete repaint/.test(s)) return 6;
  if (s.includes("replace") && /floor|carpet|tile/.test(s)) return 5;
  if (s.includes("water damage")) return 8;
  if (/repaint|full paint/.test(s)) return 5;
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

/* ====== AUTO-MATERIALS ESTIMATOR ====== */

export function estimateMaterials(t: string): Material[] {
  const s = t.toLowerCase();
  const m: Material[] = [];

  // Paint
  if (s.includes("paint") && /full|repaint|complete/.test(s))
    m.push({ n: "Paint+primer (gal)", c: 70 }, { n: "Roller+brush+tape", c: 22 });
  else if (/paint|touch.?up/.test(s)) m.push({ n: "Paint (qt)", c: 20 });
  if (/patch|spackle|nail pop|hole/.test(s) && !s.includes("tire"))
    m.push({ n: "Spackle+mesh", c: 8 });

  // Flooring
  if (s.includes("carpet")) m.push({ n: "Carpet+pad", c: 255 });
  if (s.includes("tile") && s.includes("floor"))
    m.push({ n: "Floor tile+mortar", c: 160 }, { n: "Grout", c: 12 });
  if (s.includes("tile") && s.includes("wall"))
    m.push({ n: "Wall tile+mortar", c: 190 }, { n: "Grout", c: 12 });
  if (/flooring|lvp|laminate|vinyl plank/.test(s))
    m.push({ n: "LVP flooring", c: 145 }, { n: "Underlayment", c: 25 });
  if (s.includes("transition")) m.push({ n: "Transition strip", c: 14 });
  if (/grout/.test(s) && !s.includes("tile")) m.push({ n: "Grout", c: 12 });

  // Doors & hardware
  if (s.includes("door") && /replace|new|install/.test(s))
    m.push({ n: "Door+hardware", c: 80 });
  if (s.includes("bifold")) m.push({ n: "Bifold door", c: 70 });
  if (/knob|doorknob|handle/.test(s)) m.push({ n: "Door knob", c: 16 });
  if (s.includes("deadbolt")) m.push({ n: "Deadbolt", c: 35 });
  if (s.includes("hinge")) m.push({ n: "Hinges (3pk)", c: 14 });
  if (/latch|strike plate/.test(s)) m.push({ n: "Latch/strike", c: 14 });
  if (/weatherstrip|door seal/.test(s)) m.push({ n: "Weatherstrip", c: 10 });
  if (/door stop|door bumper/.test(s)) m.push({ n: "Door stop", c: 4 });

  // Windows & blinds
  if (s.includes("blind")) m.push({ n: "Blind", c: 18 });
  if (s.includes("screen")) m.push({ n: "Screen kit", c: 14 });
  if (/window.*(seal|caulk)|caulk.*window/.test(s)) m.push({ n: "Window caulk", c: 9 });
  if (s.includes("glass")) m.push({ n: "Glass pane", c: 40 });

  // Plumbing
  if (s.includes("shower head")) m.push({ n: "Shower head", c: 22 });
  if (/faucet/.test(s)) m.push({ n: "Faucet", c: 65 });
  if (/flapper|fill valve|toilet.*run/.test(s)) m.push({ n: "Toilet repair kit", c: 17 });
  if (/wax ring|toilet.*seal/.test(s)) m.push({ n: "Wax ring+bolts", c: 12 });
  if (/toilet seat/.test(s)) m.push({ n: "Toilet seat", c: 25 });
  if (s.includes("sprayer")) m.push({ n: "Kitchen sprayer", c: 17 });
  if (s.includes("stopper")) m.push({ n: "Drain stopper", c: 9 });
  if (/supply line|supply hose/.test(s)) m.push({ n: "Supply line", c: 10 });
  if (/p.?trap|drain/.test(s) && !s.includes("stopper")) m.push({ n: "P-trap", c: 12 });
  if (/garbage disposal|disposal/.test(s)) m.push({ n: "Disposal", c: 90 });

  // Electrical
  if (/outlet|receptacle/.test(s)) m.push({ n: "Outlet+plate", c: 8 });
  if (/switch/.test(s) && !s.includes("switchplate")) m.push({ n: "Switch+plate", c: 6 });
  if (/gfci/.test(s)) m.push({ n: "GFCI outlet", c: 18 });
  if (s.includes("bulb")) m.push({ n: "Bulbs", c: 10 });
  if (/light.*fixture|fixture.*light|chandelier|vanity light/.test(s)) m.push({ n: "Light fixture", c: 33 });
  else if (s.includes("fixture") && !m.some((x) => x.n.includes("fixture"))) m.push({ n: "Fixture", c: 33 });
  if (/ceiling fan/.test(s)) m.push({ n: "Ceiling fan", c: 75 });

  // Safety
  if (/smoke alarm|smoke detector/.test(s)) m.push({ n: "Smoke alarm", c: 20 });
  if (/carbon monoxide|co detector|co alarm/.test(s)) m.push({ n: "CO detector", c: 25 });
  if (s.includes("fire ext")) m.push({ n: "Fire extinguisher", c: 28 });
  if (s.includes("battery") && !m.some((x) => x.n.includes("alarm"))) m.push({ n: "9V battery", c: 5 });

  // Bath accessories
  if (/towel bar|towel rack/.test(s)) m.push({ n: "Towel bar+anchors", c: 16 });
  if (/tp holder|toilet paper hold/.test(s)) m.push({ n: "TP holder", c: 12 });
  if (s.includes("mirror")) m.push({ n: "Mirror+clips", c: 33 });
  if (/shower rod|curtain rod/.test(s)) m.push({ n: "Shower rod", c: 15 });
  if (/medicine cabinet/.test(s)) m.push({ n: "Medicine cabinet", c: 45 });

  // Caulk & sealant
  if (s.includes("caulk") && !m.some((x) => x.n.includes("caulk")))
    m.push({ n: "Caulk tube", c: 9 });
  if (/seal|silicone/.test(s) && !m.some((x) => x.n.includes("caulk") || x.n.includes("seal")))
    m.push({ n: "Silicone sealant", c: 9 });

  // Drywall
  if (/drywall|sheetrock/.test(s))
    m.push({ n: "Drywall patch kit", c: 15 }, { n: "Joint compound", c: 12 });

  // Exterior
  if (s.includes("downspout")) m.push({ n: "Downspout", c: 22 });
  if (/gutter/.test(s) && !s.includes("downspout")) m.push({ n: "Gutter section", c: 18 });
  if (/house number|address/.test(s)) m.push({ n: "House numbers", c: 12 });
  if (/mailbox/.test(s)) m.push({ n: "Mailbox", c: 30 });
  if (/gate/.test(s)) m.push({ n: "Gate hardware", c: 20 });

  // Appliance parts
  if (/filter|furnace filter|hvac filter/.test(s)) m.push({ n: "Filter", c: 12 });
  if (/shelf|shelving/.test(s)) m.push({ n: "Shelf+brackets", c: 20 });
  if (/cabinet.*hardware|cabinet.*pull/.test(s)) m.push({ n: "Cabinet pulls", c: 24 });
  if (s.includes("refinish")) m.push({ n: "Refinish kit", c: 55 });

  // Misc
  if (/anchor|drywall anchor|wall anchor/.test(s) && !m.some((x) => x.n.includes("anchor")))
    m.push({ n: "Wall anchors", c: 6 });

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

  // Job-specific tool sets
  if (/paint|repaint|touch.?up|prime/.test(allText)) {
    ["Roller+covers", "Angled brush", "Drop cloths", "Painters tape", "Paint tray"].forEach((x) => tools.add(x));
    if (/patch|spackle|hole|nail pop|drywall/.test(allText))
      tools.add("Spackle knife");
    if (/sand|smooth/.test(allText))
      tools.add("Sanding block");
  }
  if (/tile|grout/.test(allText)) {
    ["Tile cutter", "Notched trowel", "Grout float", "Tile spacers", "Sponge"].forEach((x) => tools.add(x));
  }
  if (/plumb|shower|toilet|faucet|sink|drain|pipe|valve|sprayer|supply line|water/.test(allText)) {
    ["Adjustable wrench", "Plumbers tape", "Channel locks", "Basin wrench"].forEach((x) => tools.add(x));
    if (/toilet/.test(allText)) tools.add("Wax ring");
  }
  if (/electric|outlet|switch|wire|gfci|light|fan|fixture/.test(allText)) {
    ["Voltage tester", "Wire strippers", "Wire nuts"].forEach((x) => tools.add(x));
  }
  if (/door|hinge|knob|deadbolt|strike|latch/.test(allText)) {
    ["Chisel", "Hammer"].forEach((x) => tools.add(x));
  }
  if (/carpet|flooring|lvp|laminate|vinyl/.test(allText)) {
    ["Knee kicker", "Seam roller"].forEach((x) => tools.add(x));
    if (/lvp|laminate/.test(allText)) tools.add("Pull bar");
    if (/transition/.test(allText)) tools.add("Miter saw");
  }
  if (/drywall|sheetrock/.test(allText)) {
    ["Drywall saw", "Drywall knife (6\")", "Drywall knife (12\")", "Mud pan", "Sanding block"].forEach((x) => tools.add(x));
  }
  if (/caulk|seal|grout/.test(allText))
    tools.add("Caulk finishing tool");
  if (/screen|window screen/.test(allText))
    tools.add("Screen roller");
  if (/demo|remove|tear out|rip out/.test(allText)) {
    ["Pry bar", "Hammer"].forEach((x) => tools.add(x));
  }
  if (/exterior|gutter|downspout|siding|fascia|soffit/.test(allText))
    tools.add("Extension ladder");
  if (/mirror|glass/.test(allText))
    tools.add("Suction cups");

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

  return { tools: [...tools].sort(), shop, steps };
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
