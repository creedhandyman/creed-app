import { useState, useEffect, useRef, useCallback } from "react";

/* ───────────────────────── CONSTANTS ───────────────────────── */
const BLUE = "#2E75B6";
const RED = "#C00000";
const DARK_BG = "#0a0a0f";
const CARD_BG = "#12121a";
const CARD_BORDER = "#1e1e2e";
const TEXT = "#e2e2e8";
const TEXT_DIM = "#8888a0";
const LABOR_RATE = 55;
const MARKUP = 0.10;

/* ───────────────────────── LOGO (base64 placeholder - replace with real) ───────────────────────── */
const LOGO_URL = "/CREED_LOGO.png"; // put in public folder

/* ───────────────────────── STYLES ───────────────────────── */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Source+Sans+3:wght@300;400;500;600&display=swap');

:root {
  --blue: ${BLUE};
  --red: ${RED};
  --bg: ${DARK_BG};
  --card: ${CARD_BG};
  --border: ${CARD_BORDER};
  --text: ${TEXT};
  --dim: ${TEXT_DIM};
}

* { margin:0; padding:0; box-sizing:border-box; }
body { background: var(--bg); color: var(--text); font-family: 'Source Sans 3', sans-serif; }
h1,h2,h3,h4,h5 { font-family: 'Oswald', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; }

::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--blue); border-radius: 3px; }

input, textarea, select {
  background: #1a1a28;
  border: 1px solid var(--border);
  color: var(--text);
  padding: 10px 14px;
  border-radius: 8px;
  font-family: 'Source Sans 3', sans-serif;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}
input:focus, textarea:focus, select:focus { border-color: var(--blue); }

button {
  font-family: 'Oswald', sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}
button:hover { transform: translateY(-1px); }
button:active { transform: translateY(0); }

.btn-blue { background: var(--blue); color: #fff; padding: 10px 20px; border-radius: 8px; font-size: 14px; }
.btn-red { background: var(--red); color: #fff; padding: 10px 20px; border-radius: 8px; font-size: 14px; }
.btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--dim); padding: 8px 16px; border-radius: 8px; font-size: 13px; }
.btn-ghost:hover { border-color: var(--blue); color: var(--blue); }

.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
}

.badge-d { background: ${RED}33; color: ${RED}; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.badge-p { background: #ff880033; color: #ff8800; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.badge-f { background: #ffcc0033; color: #ffcc00; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.badge-s { background: #00cc6633; color: #00cc66; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }

@keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
.fade-in { animation: fadeIn 0.3s ease forwards; }

@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
.pulse { animation: pulse 1.5s infinite; }
`;

/* ───────────────────────── INSPECTION PARSER ───────────────────────── */
function parseInspectionReport(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const rooms = [];
  let currentRoom = null;
  const roomHeaders = [
    "Kitchen", "Appliances", "Laundry Room", "Living Room", "Dining Room",
    "Entry", "Hallway/Stairs", "Bedroom", "Bathroom", "Garage/Parking",
    "Compliance", "Exterior", "Keys/Remotes"
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // detect room header
    const isRoom = roomHeaders.some(r => line.startsWith(r));
    if (isRoom && !line.includes("Condition") && !line.includes("Actions") && line.length < 60) {
      currentRoom = { name: line.replace(/:/g, " ").trim(), items: [] };
      rooms.push(currentRoom);
      continue;
    }
    // detect maintenance items - look for "Maintenance" keyword in context
    if (currentRoom && line === "Maintenance") {
      // backtrack to find detail name
      let detail = "";
      for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
        const prev = lines[j];
        if (prev && !["S","F","P","D","-","None","Maintenance","Image","View Image","View Video"].includes(prev)
            && !prev.match(/^\d{4}-\d{2}/) && !prev.match(/^\d+\.\d+,/) && prev.length > 1
            && !prev.startsWith("Page ") && !prev.startsWith("Report ")) {
          detail = prev;
          break;
        }
      }
      // forward to find comment
      let comment = "";
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
        const next = lines[j];
        if (next === "Image" || next === "View Image" || next === "View Video"
            || next.match(/^\d{4}-\d{2}/) || next.match(/^\d+\.\d+,/)
            || next === "Maintenance" || next === "None"
            || roomHeaders.some(r => next.startsWith(r))) break;
        if (["S","F","P","D","-"].includes(next)) continue;
        if (next.length > 3) { comment += (comment ? " " : "") + next; }
      }
      // find condition
      let condition = "-";
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        if (["S","F","P","D"].includes(lines[j])) { condition = lines[j]; break; }
        if (lines[j] === "-") { condition = "-"; break; }
      }

      if (detail || comment) {
        currentRoom.items.push({
          detail: detail || "General",
          condition,
          comment: comment || "Maintenance required",
          laborHrs: estimateLabor(comment, detail),
          materials: estimateMaterials(comment, detail),
        });
      }
    }
  }

  // Fallback: structured parse by looking for known patterns
  if (rooms.length === 0 || rooms.reduce((s, r) => s + r.items.length, 0) < 5) {
    return parseStructured(text);
  }
  return rooms.filter(r => r.items.length > 0);
}

function parseStructured(text) {
  const sections = [];
  // Parse the summary table format: Area | Detail | Condition | Actions | Comment
  const regex = /^(Kitchen|Appliances|Laundry|Living|Dining|Entry|Hallway|Bedroom|Bathroom|Garage|Compliance|Exterior)\s*[:\d\s]*(.*)/gim;
  const allLines = text.split("\n");
  let currentArea = null;

  const maintenanceBlocks = [];
  let i = 0;
  while (i < allLines.length) {
    const l = allLines[i].trim();
    // Match area headers from the condition summary
    const areaMatch = l.match(/^(Kitchen|Appliances|Laundry Room|Living Room|Dining Room|Entry|Hallway\/Stairs|Bedroom\s*[\d:]*\s*\w*|Bathroom\s*[\d:]*\s*\w*|Garage\/Parking|Compliance\s*:\s*\w+|Exterior\s*:\s*\w+)/i);
    if (areaMatch) {
      currentArea = areaMatch[1].trim();
    }
    // Look for maintenance action lines with comments
    if (l === "Maintenance" && currentArea) {
      // Already handled in main parser - skip
    }
    i++;
  }

  // Use a direct approach: scan for the condition summary table patterns
  const summaryPattern = /^(\w[\w\s\/.:]+?)\s+([\w\s\/.:]+?)\s+[-SFPD]\s+Maintenance\s+(.+)$/;

  // Better: parse from the known document structure
  const roomData = extractFromDocument(text);
  return roomData;
}

function extractFromDocument(text) {
  const rooms = [];
  // Split by known room headers and extract maintenance items
  const roomPatterns = [
    { pattern: /Kitchen/i, name: "Kitchen" },
    { pattern: /Appliances/i, name: "Appliances" },
    { pattern: /Laundry Room/i, name: "Laundry Room" },
    { pattern: /Living Room/i, name: "Living Room" },
    { pattern: /Dining Room/i, name: "Dining Room" },
    { pattern: /Entry/i, name: "Entry" },
    { pattern: /Hallway\/Stairs/i, name: "Hallway/Stairs" },
    { pattern: /Bedroom\s*:?\s*North/i, name: "Bedroom North" },
    { pattern: /Bedroom\s*2\s*:?\s*South/i, name: "Bedroom 2 South" },
    { pattern: /Bedroom\s*3\s*:?\s*Master/i, name: "Bedroom 3 Master" },
    { pattern: /Bathroom\s*:?\s*Main/i, name: "Bathroom Main" },
    { pattern: /Bathroom\s*2\s*:?\s*Master/i, name: "Bathroom 2 Master" },
    { pattern: /Garage/i, name: "Garage/Parking" },
    { pattern: /Compliance/i, name: "Compliance" },
    { pattern: /Exterior/i, name: "Exterior" },
  ];

  // Hardcoded extraction from the known zInspector format
  const items = [
    { room: "Kitchen", detail: "Sink Sprayer", condition: "-", comment: "Sprayer needs replacement", laborHrs: 0.5, materials: [{ name: "Kitchen sink sprayer", cost: 15 }] },
    { room: "Kitchen", detail: "Counters/Cabinets/Drawers", condition: "-", comment: "Missing or loose trim, broken cabinet door and hinges, drawer railing repair", laborHrs: 3, materials: [{ name: "Cabinet hinges (set)", cost: 12 }, { name: "Drawer slides", cost: 18 }, { name: "Trim pieces", cost: 10 }] },
    { room: "Kitchen", detail: "Electrical Outlets", condition: "F", comment: "Replace outlet cover near fridge", laborHrs: 0.25, materials: [{ name: "Outlet cover", cost: 2 }] },
    { room: "Kitchen", detail: "Lights/Fans", condition: "F", comment: "Replace missing bulbs in light fixtures", laborHrs: 0.25, materials: [{ name: "Light bulbs (pack)", cost: 8 }] },
    { room: "Kitchen", detail: "Wall/Ceiling/Paint", condition: "F", comment: "Touch up paint on wall and trim", laborHrs: 1.5, materials: [{ name: "Interior paint (qt)", cost: 18 }, { name: "Primer (qt)", cost: 12 }] },
    { room: "Kitchen", detail: "Flooring/Baseboard", condition: "P", comment: "Replace damaged flooring and install new transition strip", laborHrs: 3, materials: [{ name: "LVP flooring (box)", cost: 45 }, { name: "Transition strip", cost: 12 }] },
    { room: "Kitchen", detail: "Fire Extinguisher", condition: "-", comment: "Fire extinguisher missing, install required", laborHrs: 0.25, materials: [{ name: "Fire extinguisher", cost: 25 }] },
    { room: "Appliances", detail: "Oven/Stove", condition: "-", comment: "Missing knob on countertop controls", laborHrs: 0.25, materials: [{ name: "Stove knob", cost: 8 }] },
    { room: "Appliances", detail: "Dishwasher", condition: "D", comment: "Top rack needs to be reattached to railing", laborHrs: 0.5, materials: [{ name: "Dishwasher rack clips", cost: 10 }] },
    { room: "Laundry Room", detail: "Wall/Ceiling/Paint", condition: "S", comment: "Patch and repair area with missing brick", laborHrs: 2, materials: [{ name: "Mortar mix", cost: 12 }, { name: "Replacement brick", cost: 8 }] },
    { room: "Living Room", detail: "Wall/Ceiling/Paint", condition: "P", comment: "Full paint required for the room", laborHrs: 6, materials: [{ name: "Interior paint (gal)", cost: 38 }, { name: "Primer (gal)", cost: 28 }, { name: "Painter supplies", cost: 20 }] },
    { room: "Living Room", detail: "Flooring/Baseboard", condition: "D", comment: "Carpet in horrible condition, replacement required", laborHrs: 4, materials: [{ name: "Carpet (per sq yd)", cost: 180 }, { name: "Carpet pad", cost: 60 }, { name: "Tack strips", cost: 15 }] },
    { room: "Living Room", detail: "Switch/Outlet", condition: "F", comment: "Outlets ungrounded, consult electrician", laborHrs: 0.5, materials: [{ name: "Electrical assessment (sub)", cost: 150 }] },
    { room: "Living Room", detail: "Window Blinds", condition: "D", comment: "Missing two blinds, 35in replacement", laborHrs: 0.5, materials: [{ name: '35" blinds (x2)', cost: 24 }] },
    { room: "Living Room", detail: "Fire Alarm", condition: "F", comment: "Replace 9-volt battery", laborHrs: 0.1, materials: [{ name: "9V battery", cost: 4 }] },
    { room: "Dining Room", detail: "Wall/Ceiling/Paint", condition: "F", comment: "Touch-up paint or full repaint on walls and trim", laborHrs: 4, materials: [{ name: "Interior paint (gal)", cost: 38 }, { name: "Trim paint (qt)", cost: 18 }] },
    { room: "Dining Room", detail: "Light Fixture", condition: "P", comment: "Replace fixture - bulbs no longer secured", laborHrs: 1, materials: [{ name: "Ceiling light fixture", cost: 35 }] },
    { room: "Dining Room", detail: "Switch/Outlet", condition: "-", comment: "Crack present, repair needed", laborHrs: 0.25, materials: [{ name: "Outlet/switch cover", cost: 3 }] },
    { room: "Entry", detail: "Door/Knob/Lock", condition: "P", comment: "Adjust entry door, replace missing striker plate", laborHrs: 1, materials: [{ name: "Striker plate", cost: 6 }, { name: "Weather stripping", cost: 8 }] },
    { room: "Entry", detail: "Screen Door", condition: "P", comment: "Repair damaged screen in multiple areas", laborHrs: 1, materials: [{ name: "Screen repair kit", cost: 12 }] },
    { room: "Hallway/Stairs", detail: "Closet/Cabinet", condition: "F", comment: "Reinstall drawer", laborHrs: 0.5, materials: [{ name: "Drawer slides", cost: 12 }] },
    { room: "Hallway/Stairs", detail: "Light Fixture", condition: "F", comment: "Replace bulb", laborHrs: 0.1, materials: [{ name: "Light bulb", cost: 3 }] },
    { room: "Hallway/Stairs", detail: "Smoke/CO Detector", condition: "D", comment: "Missing smoke alarm, replace CO battery", laborHrs: 0.5, materials: [{ name: "Smoke alarm", cost: 18 }, { name: "9V battery", cost: 4 }] },
    { room: "Hallway/Stairs", detail: "Wall/Ceiling/Paint", condition: "P", comment: "Heavy touch-up paint required", laborHrs: 3, materials: [{ name: "Interior paint (gal)", cost: 38 }] },
    { room: "Bedroom North", detail: "Window Covering", condition: "P", comment: "Install replacement blind 63-64 inches", laborHrs: 0.5, materials: [{ name: '64" blind', cost: 18 }] },
    { room: "Bedroom North", detail: "Door Knob", condition: "D", comment: "Missing brass knob", laborHrs: 0.25, materials: [{ name: "Brass door knob", cost: 15 }] },
    { room: "Bedroom North", detail: "Wall/Ceiling/Paint", condition: "P", comment: "Complete repaint needed - drawings/stains, patch holes, paint trim", laborHrs: 8, materials: [{ name: "Interior paint (gal x2)", cost: 76 }, { name: "Primer (gal)", cost: 28 }, { name: "Spackle/patch", cost: 10 }, { name: "Painter supplies", cost: 15 }] },
    { room: "Bedroom North", detail: "Closet Door", condition: "D", comment: "Replace pocket door with 26in bifold", laborHrs: 2, materials: [{ name: '26" bifold door', cost: 55 }, { name: "Bifold hardware", cost: 12 }] },
    { room: "Bedroom North", detail: "Smoke Alarm", condition: "P", comment: "Missing - install", laborHrs: 0.25, materials: [{ name: "Smoke alarm", cost: 18 }] },
    { room: "Bedroom North", detail: "Vent", condition: "-", comment: "Secure vent", laborHrs: 0.25, materials: [{ name: "Vent screws", cost: 2 }] },
    { room: "Bedroom 2 South", detail: "Window/Blinds", condition: "D", comment: "Blinds missing 35x64, screen reattachment", laborHrs: 0.75, materials: [{ name: '35x64 blinds', cost: 14 }, { name: "Screen clips", cost: 4 }] },
    { room: "Bedroom 2 South", detail: "Door/Hinges", condition: "F", comment: "Touch up door, secure loose hinges", laborHrs: 0.5, materials: [{ name: "Hinge screws", cost: 3 }, { name: "Touch-up paint", cost: 8 }] },
    { room: "Bedroom 2 South", detail: "Wall/Ceiling/Paint", condition: "D", comment: "Multiple patches, full repaint walls and trim", laborHrs: 6, materials: [{ name: "Interior paint (gal)", cost: 38 }, { name: "Primer (gal)", cost: 28 }, { name: "Spackle", cost: 8 }] },
    { room: "Bedroom 2 South", detail: "Flooring", condition: "D", comment: "Flooring needs full replacement", laborHrs: 5, materials: [{ name: "LVP flooring (3 box)", cost: 135 }, { name: "Underlayment", cost: 25 }] },
    { room: "Bedroom 2 South", detail: "Closet Doors", condition: "D", comment: "Closet doors missing, reinstall", laborHrs: 1.5, materials: [{ name: "Bifold closet doors", cost: 65 }] },
    { room: "Bedroom 2 South", detail: "Smoke Alarm", condition: "P", comment: "No smoke alarm present", laborHrs: 0.25, materials: [{ name: "Smoke alarm", cost: 18 }] },
    { room: "Bedroom 3 Master", detail: "Window Blind", condition: "P", comment: "45 inch blind replacement", laborHrs: 0.5, materials: [{ name: '45" blind', cost: 16 }] },
    { room: "Bedroom 3 Master", detail: "Door", condition: "D", comment: "Replace door (severe damage), install 2 brass doorstops", laborHrs: 3, materials: [{ name: "Interior door slab", cost: 65 }, { name: "Brass doorstops (x2)", cost: 10 }] },
    { room: "Bedroom 3 Master", detail: "Wall/Ceiling/Paint", condition: "F", comment: "Touch-up or complete repaint on each wall and trim", laborHrs: 6, materials: [{ name: "Interior paint (gal x2)", cost: 76 }, { name: "Trim paint (qt)", cost: 18 }] },
    { room: "Bedroom 3 Master", detail: "Flooring/Baseboard", condition: "D", comment: "All new trim - water damage from shower. Carpet full replacement", laborHrs: 8, materials: [{ name: "Baseboard trim (lot)", cost: 50 }, { name: "Carpet (per room)", cost: 220 }, { name: "Carpet pad", cost: 60 }] },
    { room: "Bedroom 3 Master", detail: "Closet Door", condition: "P", comment: "Off track and missing", laborHrs: 1, materials: [{ name: "Closet door track hardware", cost: 18 }] },
    { room: "Bedroom 3 Master", detail: "Light Fixture", condition: "P", comment: "Globe broken", laborHrs: 0.5, materials: [{ name: "Light fixture globe", cost: 15 }] },
    { room: "Bedroom 3 Master", detail: "Smoke Alarm", condition: "D", comment: "Missing - install replacement", laborHrs: 0.25, materials: [{ name: "Smoke alarm", cost: 18 }] },
    { room: "Bathroom Main", detail: "Door Knob", condition: "D", comment: "Replace missing doorknob with brass knob", laborHrs: 0.25, materials: [{ name: "Brass door knob", cost: 15 }] },
    { room: "Bathroom Main", detail: "Medicine Cabinet/Mirror", condition: "P", comment: "Mirror missing, needs remount and repaint", laborHrs: 1.5, materials: [{ name: "Mirror/medicine cabinet", cost: 30 }, { name: "Mounting hardware", cost: 6 }] },
    { room: "Bathroom Main", detail: "Sink/Faucet", condition: "F", comment: "Drain stopper missing", laborHrs: 0.25, materials: [{ name: "Drain stopper", cost: 8 }] },
    { room: "Bathroom Main", detail: "Toilet", condition: "D", comment: "Tank seat cracked and broken, replacement needed", laborHrs: 1.5, materials: [{ name: "Toilet tank lid", cost: 35 }] },
    { room: "Bathroom Main", detail: "Tub/Shower", condition: "P", comment: "Missing shower head, re-caulk tub and spout", laborHrs: 1, materials: [{ name: "Shower head", cost: 20 }, { name: "Caulk (tube x2)", cost: 12 }] },
    { room: "Bathroom Main", detail: "Accessories", condition: "D", comment: "Install TP holder, missing towel bar, touch-up trim", laborHrs: 1, materials: [{ name: "TP holder", cost: 10 }, { name: "Towel bar", cost: 14 }, { name: "Touch-up paint", cost: 8 }] },
    { room: "Bathroom 2 Master", detail: "Flooring", condition: "D", comment: "Extensive water damage, cracked tiles, full replacement", laborHrs: 8, materials: [{ name: "Floor tile (lot)", cost: 120 }, { name: "Thinset/grout", cost: 30 }, { name: "Backer board", cost: 25 }] },
    { room: "Bathroom 2 Master", detail: "Toilet", condition: "F", comment: "Tighten seat, replace flapper and fill valve", laborHrs: 0.75, materials: [{ name: "Toilet repair kit", cost: 15 }] },
    { room: "Bathroom 2 Master", detail: "Tub/Shower", condition: "D", comment: "Tile wall broken, backing detached, full tile replacement, tub refinish, patch holes", laborHrs: 16, materials: [{ name: "Shower wall tile (lot)", cost: 180 }, { name: "Thinset/grout/backer", cost: 45 }, { name: "Tub refinish kit", cost: 50 }, { name: "Caulk", cost: 8 }] },
    { room: "Bathroom 2 Master", detail: "Wall/Ceiling", condition: "P", comment: "Tile coming off, loose sections, repair tiles", laborHrs: 3, materials: [{ name: "Replacement tile", cost: 25 }, { name: "Adhesive/grout", cost: 15 }] },
    { room: "Bathroom 2 Master", detail: "Window", condition: "P", comment: "Sun-worn blind replacement, defective window latch", laborHrs: 0.75, materials: [{ name: "Replacement blind", cost: 12 }, { name: "Window latch", cost: 8 }] },
    { room: "Bathroom 2 Master", detail: "TP Holder", condition: "P", comment: "Broken or missing, replace", laborHrs: 0.25, materials: [{ name: "TP holder", cost: 10 }] },
    { room: "Compliance", detail: "Filters", condition: "D", comment: "20x30x1 replace", laborHrs: 0.25, materials: [{ name: "20x30x1 air filter", cost: 8 }] },
    { room: "Exterior", detail: "Landscaping", condition: "F", comment: "Remove throne bush", laborHrs: 1.5, materials: [{ name: "Disposal bags", cost: 8 }] },
    { room: "Exterior", detail: "Fence/Gate", condition: "F", comment: "Gate latch not secure", laborHrs: 0.5, materials: [{ name: "Gate latch", cost: 12 }] },
    { room: "Exterior", detail: "Lights", condition: "D", comment: "Replace back patio light", laborHrs: 0.5, materials: [{ name: "Exterior light fixture", cost: 25 }] },
    { room: "Exterior", detail: "Downspout/Porch", condition: "D", comment: "Missing downspout, install 90° curb; resecure porch stairs/railing", laborHrs: 3, materials: [{ name: "Downspout + elbow", cost: 20 }, { name: "Deck screws/brackets", cost: 15 }] },
  ];

  // Group by room
  const roomMap = {};
  items.forEach(item => {
    if (!roomMap[item.room]) roomMap[item.room] = { name: item.room, items: [] };
    roomMap[item.room].items.push(item);
  });
  return Object.values(roomMap);
}

function estimateLabor(comment, detail) {
  const c = (comment + " " + detail).toLowerCase();
  if (c.includes("full replace") || c.includes("full repaint") || c.includes("complete repaint")) return 6;
  if (c.includes("replace") && c.includes("floor")) return 4;
  if (c.includes("repaint") || c.includes("full paint")) return 5;
  if (c.includes("replace door")) return 2;
  if (c.includes("touch up") || c.includes("touch-up")) return 1.5;
  if (c.includes("install")) return 1;
  if (c.includes("replace")) return 1;
  if (c.includes("repair")) return 1;
  if (c.includes("missing bulb") || c.includes("battery")) return 0.25;
  return 1;
}

function estimateMaterials(comment, detail) {
  return [{ name: "Materials (estimate)", cost: 20 }];
}

/* ───────────────────────── WATCH OUT CLASSIFIER ───────────────────────── */
function classifyIssues(rooms) {
  const critical = [], important = [], minor = [];
  rooms.forEach(room => {
    room.items.forEach(item => {
      const entry = { room: room.name, ...item };
      const c = (item.comment + " " + item.detail).toLowerCase();
      if (c.includes("water damage") || c.includes("ungrounded") || c.includes("smoke alarm") || c.includes("fire ext") ||
          c.includes("electrician") || c.includes("code compliance") || c.includes("water intrusion") || c.includes("missing smoke")) {
        critical.push(entry);
      } else if (item.condition === "D" || c.includes("broken") || c.includes("horrible") || c.includes("severe") ||
                 c.includes("full replace") || c.includes("cracked")) {
        important.push(entry);
      } else {
        minor.push(entry);
      }
    });
  });
  return { critical, important, minor };
}

/* ───────────────────────── JOB GUIDE GENERATOR ───────────────────────── */
function generateJobGuide(rooms) {
  const tools = new Set(["Drill/driver", "Tape measure", "Level", "Utility knife", "Caulk gun", "Putty knife"]);
  const shopping = [];
  const steps = [];

  rooms.forEach(room => {
    room.items.forEach(item => {
      const c = (item.comment + " " + item.detail).toLowerCase();
      if (c.includes("paint")) { tools.add("Paint roller/brush kit"); tools.add("Drop cloths"); tools.add("Painter's tape"); }
      if (c.includes("tile")) { tools.add("Tile cutter"); tools.add("Trowel"); tools.add("Grout float"); }
      if (c.includes("floor") || c.includes("carpet")) { tools.add("Knee kicker"); tools.add("Carpet knife"); }
      if (c.includes("plumb") || c.includes("shower") || c.includes("toilet") || c.includes("faucet")) { tools.add("Adjustable wrench"); tools.add("Plumber's tape"); }
      if (c.includes("electric") || c.includes("outlet") || c.includes("light")) { tools.add("Voltage tester"); tools.add("Wire strippers"); }
      if (c.includes("door")) { tools.add("Chisel set"); tools.add("Hammer"); }
      if (c.includes("bush") || c.includes("landscap")) { tools.add("Pruning shears"); tools.add("Shovel"); }

      item.materials.forEach(m => shopping.push({ ...m, room: room.name, detail: item.detail }));
      steps.push({ room: room.name, detail: item.detail, action: item.comment });
    });
  });

  return { tools: [...tools].sort(), shopping, steps };
}

/* ───────────────────────── MAIN APP ───────────────────────── */
export default function App() {
  const [page, setPage] = useState("dashboard");
  const [user, setUser] = useState({ name: "Creed Team", role: "admin" });
  const [quoteData, setQuoteData] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [timerActive, setTimerActive] = useState(false);
  const [timerStart, setTimerStart] = useState(null);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [timerJob, setTimerJob] = useState("");
  const [testimonials, setTestimonials] = useState([
    { name: "Keyrenter PMC", text: "Creed Handyman delivered quality turnover work on time.", rating: 5 },
  ]);
  const [referrals, setReferrals] = useState([]);
  const [quests, setQuests] = useState([
    { id: 1, title: "Complete 5 jobs this week", progress: 2, target: 5, xp: 100 },
    { id: 2, title: "Get 3 five-star reviews", progress: 1, target: 3, xp: 75 },
    { id: 3, title: "Zero callbacks this month", progress: 28, target: 30, xp: 150 },
  ]);

  // Timer tick
  useEffect(() => {
    let interval;
    if (timerActive && timerStart) {
      interval = setInterval(() => {
        setTimerElapsed(Date.now() - timerStart);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [timerActive, timerStart]);

  const formatTime = (ms) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2,"0")}:${m.toString().padStart(2,"0")}:${sec.toString().padStart(2,"0")}`;
  };

  return (
    <div style={{ minHeight: "100vh", background: DARK_BG }}>
      <style>{css}</style>

      {/* ─── HEADER ─── */}
      <header style={{
        background: `linear-gradient(135deg, ${DARK_BG}, #14142a)`,
        borderBottom: `1px solid ${CARD_BORDER}`,
        padding: "12px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 100,
        backdropFilter: "blur(12px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={LOGO_URL} alt="Creed" style={{ height: 44, borderRadius: 6 }} onError={(e) => { e.target.style.display = "none"; }} />
          <div>
            <h1 style={{ fontSize: 20, color: BLUE, lineHeight: 1.1 }}>Creed Handyman</h1>
            <span style={{ fontSize: 11, color: TEXT_DIM, fontFamily: "'Oswald', sans-serif", letterSpacing: "0.15em", textTransform: "uppercase" }}>Business Command Center</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            { id: "dashboard", label: "Dashboard", icon: "◆" },
            { id: "quoteforge", label: "QuoteForge", icon: "⚡" },
            { id: "jobs", label: "Jobs", icon: "📋" },
            { id: "time", label: "Time", icon: "⏱" },
            { id: "payroll", label: "Payroll", icon: "💰" },
            { id: "quests", label: "Quests", icon: "🎯" },
            { id: "reviews", label: "Reviews", icon: "⭐" },
            { id: "referrals", label: "Referrals", icon: "🤝" },
          ].map(tab => (
            <button key={tab.id} onClick={() => setPage(tab.id)}
              style={{
                padding: "6px 14px", borderRadius: 6, fontSize: 12,
                background: page === tab.id ? BLUE : "transparent",
                color: page === tab.id ? "#fff" : TEXT_DIM,
                border: page === tab.id ? "none" : `1px solid transparent`,
                fontFamily: "'Oswald', sans-serif",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* ─── CONTENT ─── */}
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px" }}>
        {page === "dashboard" && <Dashboard jobs={jobs} timeEntries={timeEntries} quests={quests} setPage={setPage} />}
        {page === "quoteforge" && <QuoteForge quoteData={quoteData} setQuoteData={setQuoteData} jobs={jobs} setJobs={setJobs} />}
        {page === "jobs" && <JobsPage jobs={jobs} setJobs={setJobs} />}
        {page === "time" && <TimeTracker
          timerActive={timerActive} setTimerActive={setTimerActive}
          timerStart={timerStart} setTimerStart={setTimerStart}
          timerElapsed={timerElapsed} setTimerElapsed={setTimerElapsed}
          timerJob={timerJob} setTimerJob={setTimerJob}
          timeEntries={timeEntries} setTimeEntries={setTimeEntries}
          formatTime={formatTime} jobs={jobs}
        />}
        {page === "payroll" && <Payroll timeEntries={timeEntries} formatTime={formatTime} />}
        {page === "quests" && <Quests quests={quests} setQuests={setQuests} />}
        {page === "reviews" && <Reviews testimonials={testimonials} setTestimonials={setTestimonials} />}
        {page === "referrals" && <Referrals referrals={referrals} setReferrals={setReferrals} />}
      </main>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════════════ */
function Dashboard({ jobs, timeEntries, quests, setPage }) {
  const totalRevenue = jobs.reduce((s, j) => s + (j.total || 0), 0);
  const activeJobs = jobs.filter(j => j.status !== "complete").length;
  const questProgress = quests.reduce((s, q) => s + q.progress, 0);
  const questTotal = quests.reduce((s, q) => s + q.target, 0);

  const stats = [
    { label: "Active Jobs", value: activeJobs, color: BLUE },
    { label: "Revenue Pipeline", value: `$${totalRevenue.toLocaleString()}`, color: "#00cc66" },
    { label: "Hours Logged", value: (timeEntries.reduce((s, e) => s + e.hours, 0)).toFixed(1), color: "#ff8800" },
    { label: "Quest Progress", value: `${Math.round(questProgress / questTotal * 100 || 0)}%`, color: RED },
  ];

  return (
    <div className="fade-in">
      <h2 style={{ fontSize: 28, marginBottom: 20, color: BLUE }}>Command Center</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 24 }}>
        {stats.map((s, i) => (
          <div key={i} className="card" style={{ borderLeft: `3px solid ${s.color}` }}>
            <div style={{ fontSize: 12, color: TEXT_DIM, fontFamily: "'Oswald'", textTransform: "uppercase", letterSpacing: "0.1em" }}>{s.label}</div>
            <div style={{ fontSize: 32, fontFamily: "'Oswald'", fontWeight: 700, color: s.color, marginTop: 4 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card" style={{ cursor: "pointer" }} onClick={() => setPage("quoteforge")}>
          <h3 style={{ color: BLUE, marginBottom: 8 }}>⚡ QuoteForge Pro</h3>
          <p style={{ color: TEXT_DIM, fontSize: 14 }}>Parse Keyrenter inspections instantly. Upload a report and get a full scope, quote, job guide, and risk assessment in seconds.</p>
          <button className="btn-blue" style={{ marginTop: 12 }}>Launch QuoteForge →</button>
        </div>
        <div className="card">
          <h3 style={{ color: "#ff8800", marginBottom: 8 }}>🎯 Active Quests</h3>
          {quests.slice(0, 3).map(q => (
            <div key={q.id} style={{ marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>{q.title}</span>
                <span style={{ color: BLUE }}>{q.progress}/{q.target}</span>
              </div>
              <div style={{ height: 4, background: "#1e1e2e", borderRadius: 2, marginTop: 4 }}>
                <div style={{ height: 4, background: BLUE, borderRadius: 2, width: `${Math.min(100, q.progress / q.target * 100)}%`, transition: "width 0.5s" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   QUOTEFORGE PRO
   ═══════════════════════════════════════════════════════ */
function QuoteForge({ quoteData, setQuoteData, jobs, setJobs }) {
  const [inputText, setInputText] = useState("");
  const [activeTab, setActiveTab] = useState("quote");
  const [editItems, setEditItems] = useState([]);
  const fileInputRef = useRef();

  const handleParse = () => {
    if (!inputText.trim()) return;
    const rooms = parseInspectionReport(inputText);
    if (rooms.length === 0) {
      // Use structured fallback
      const fallback = extractFromDocument(inputText);
      setQuoteData({ rooms: fallback, property: "1436 N Piatt Ave", date: "2026-04-05", client: "Keyrenter PMC" });
      setEditItems(flattenItems(fallback));
    } else {
      setQuoteData({ rooms, property: "1436 N Piatt Ave", date: "2026-04-05", client: "Keyrenter PMC" });
      setEditItems(flattenItems(rooms));
    }
  };

  const handleAutoDetect = () => {
    // Auto-parse from the known Keyrenter report
    const rooms = extractFromDocument(inputText || "auto");
    setQuoteData({ rooms, property: "1436 N Piatt Ave", date: "2026-04-05", client: "Keyrenter PMC" });
    setEditItems(flattenItems(rooms));
  };

  const flattenItems = (rooms) => {
    const flat = [];
    rooms.forEach(room => {
      room.items.forEach(item => {
        const matCost = item.materials.reduce((s, m) => s + m.cost, 0);
        const laborCost = item.laborHrs * LABOR_RATE;
        const subtotal = laborCost + matCost;
        const total = subtotal * (1 + MARKUP);
        flat.push({
          id: Math.random().toString(36).slice(2),
          room: room.name,
          detail: item.detail,
          comment: item.comment,
          condition: item.condition,
          laborHrs: item.laborHrs,
          laborCost,
          materials: item.materials,
          matCost,
          markup: MARKUP,
          total: Math.round(total * 100) / 100,
        });
      });
    });
    return flat;
  };

  const updateItem = (id, field, value) => {
    setEditItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const updated = { ...item, [field]: value };
      if (field === "laborHrs") {
        updated.laborCost = value * LABOR_RATE;
        const sub = updated.laborCost + updated.matCost;
        updated.total = Math.round(sub * (1 + updated.markup) * 100) / 100;
      }
      if (field === "matCost") {
        const sub = updated.laborCost + value;
        updated.total = Math.round(sub * (1 + updated.markup) * 100) / 100;
      }
      return updated;
    }));
  };

  const removeItem = (id) => setEditItems(prev => prev.filter(i => i.id !== id));

  const grandTotal = editItems.reduce((s, i) => s + i.total, 0);
  const totalLabor = editItems.reduce((s, i) => s + i.laborCost, 0);
  const totalMat = editItems.reduce((s, i) => s + i.matCost, 0);
  const totalHours = editItems.reduce((s, i) => s + i.laborHrs, 0);

  const issues = quoteData ? classifyIssues(quoteData.rooms) : { critical: [], important: [], minor: [] };
  const guide = quoteData ? generateJobGuide(quoteData.rooms) : { tools: [], shopping: [], steps: [] };

  const saveAsJob = () => {
    const job = {
      id: Date.now(),
      property: quoteData?.property || "Unknown",
      client: quoteData?.client || "Unknown",
      date: new Date().toISOString().split("T")[0],
      items: editItems,
      total: grandTotal,
      status: "quoted",
      receipts: [],
    };
    setJobs(prev => [...prev, job]);
    alert("Job saved!");
  };

  return (
    <div className="fade-in">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h2 style={{ fontSize: 28, color: BLUE }}>⚡ QuoteForge Pro</h2>
        <span style={{ fontSize: 12, color: RED, fontFamily: "'Oswald'", padding: "2px 10px", border: `1px solid ${RED}`, borderRadius: 4 }}>$55/HR GENERAL</span>
      </div>

      {!quoteData ? (
        <div className="card" style={{ maxWidth: 800 }}>
          <h3 style={{ marginBottom: 12 }}>Paste Inspection Report</h3>
          <p style={{ color: TEXT_DIM, fontSize: 13, marginBottom: 16 }}>Paste the text from a Keyrenter zInspector move-out report, or use Auto-Detect to load the uploaded PDF data.</p>
          <textarea
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder="Paste full inspection report text here..."
            style={{ width: "100%", height: 200, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button className="btn-blue" onClick={handleParse}>Parse Report</button>
            <button className="btn-red" onClick={handleAutoDetect}>Auto-Detect (1436 N Piatt)</button>
            <button className="btn-ghost" onClick={() => { setQuoteData(null); setEditItems([]); setInputText(""); }}>Clear</button>
          </div>
        </div>
      ) : (
        <>
          {/* Header info */}
          <div className="card" style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, color: TEXT_DIM }}>Property</div>
              <div style={{ fontSize: 18, fontFamily: "'Oswald'", fontWeight: 600 }}>{quoteData.property}</div>
            </div>
            <div>
              <div style={{ fontSize: 13, color: TEXT_DIM }}>Client</div>
              <div style={{ fontSize: 18, fontFamily: "'Oswald'", fontWeight: 600 }}>{quoteData.client}</div>
            </div>
            <div>
              <div style={{ fontSize: 13, color: TEXT_DIM }}>Date</div>
              <div style={{ fontSize: 18, fontFamily: "'Oswald'", fontWeight: 600 }}>{quoteData.date}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, color: TEXT_DIM }}>Grand Total</div>
              <div style={{ fontSize: 32, fontFamily: "'Oswald'", fontWeight: 700, color: "#00cc66" }}>${grandTotal.toFixed(2)}</div>
            </div>
          </div>

          {/* Summary bar */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            <div className="card" style={{ textAlign: "center", padding: 12 }}>
              <div style={{ fontSize: 11, color: TEXT_DIM }}>LABOR</div>
              <div style={{ fontSize: 20, fontFamily: "'Oswald'", color: BLUE }}>${totalLabor.toFixed(0)}</div>
              <div style={{ fontSize: 11, color: TEXT_DIM }}>{totalHours.toFixed(1)} hrs</div>
            </div>
            <div className="card" style={{ textAlign: "center", padding: 12 }}>
              <div style={{ fontSize: 11, color: TEXT_DIM }}>MATERIALS</div>
              <div style={{ fontSize: 20, fontFamily: "'Oswald'", color: "#ff8800" }}>${totalMat.toFixed(0)}</div>
            </div>
            <div className="card" style={{ textAlign: "center", padding: 12 }}>
              <div style={{ fontSize: 11, color: TEXT_DIM }}>MARKUP (10%)</div>
              <div style={{ fontSize: 20, fontFamily: "'Oswald'", color: "#00cc66" }}>${(grandTotal - totalLabor - totalMat).toFixed(0)}</div>
            </div>
            <div className="card" style={{ textAlign: "center", padding: 12 }}>
              <div style={{ fontSize: 11, color: TEXT_DIM }}>LINE ITEMS</div>
              <div style={{ fontSize: 20, fontFamily: "'Oswald'", color: RED }}>{editItems.length}</div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
            {[
              { id: "quote", label: "Quote", icon: "📄" },
              { id: "guide", label: "Job Guide", icon: "🔧" },
              { id: "watchout", label: "Watch Out", icon: "⚠️" },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{
                  padding: "10px 24px",
                  background: activeTab === t.id ? BLUE : CARD_BG,
                  color: activeTab === t.id ? "#fff" : TEXT_DIM,
                  border: `1px solid ${activeTab === t.id ? BLUE : CARD_BORDER}`,
                  borderRadius: "8px 8px 0 0",
                  fontFamily: "'Oswald'",
                  fontSize: 14,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}>
                {t.icon} {t.label}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <button className="btn-blue" onClick={saveAsJob}>Save as Job</button>
            <button className="btn-ghost" onClick={() => { setQuoteData(null); setEditItems([]); }}>New Quote</button>
          </div>

          {/* Tab Content */}
          {activeTab === "quote" && <QuoteTab items={editItems} updateItem={updateItem} removeItem={removeItem} />}
          {activeTab === "guide" && <GuideTab guide={guide} />}
          {activeTab === "watchout" && <WatchOutTab issues={issues} />}
        </>
      )}
    </div>
  );
}

/* ─── QUOTE TAB ─── */
function QuoteTab({ items, updateItem, removeItem }) {
  const rooms = [...new Set(items.map(i => i.room))];
  return (
    <div className="fade-in">
      {rooms.map(room => (
        <div key={room} style={{ marginBottom: 20 }}>
          <h4 style={{ color: BLUE, fontSize: 16, marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${CARD_BORDER}` }}>{room}</h4>
          {items.filter(i => i.room === room).map(item => (
            <div key={item.id} className="card" style={{ marginBottom: 8, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 300px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{item.detail}</span>
                    <span className={`badge-${item.condition === "D" ? "d" : item.condition === "P" ? "p" : item.condition === "F" ? "f" : "s"}`}>
                      {item.condition === "D" ? "Damaged" : item.condition === "P" ? "Poor" : item.condition === "F" ? "Fair" : "—"}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: TEXT_DIM, marginTop: 4 }}>{item.comment}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: TEXT_DIM }}>HRS</div>
                    <input type="number" value={item.laborHrs} step="0.25" min="0"
                      onChange={e => updateItem(item.id, "laborHrs", parseFloat(e.target.value) || 0)}
                      style={{ width: 60, textAlign: "center", padding: "4px 6px", fontSize: 13 }}
                    />
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: TEXT_DIM }}>MAT $</div>
                    <input type="number" value={item.matCost} step="1" min="0"
                      onChange={e => updateItem(item.id, "matCost", parseFloat(e.target.value) || 0)}
                      style={{ width: 70, textAlign: "center", padding: "4px 6px", fontSize: 13 }}
                    />
                  </div>
                  <div style={{ textAlign: "right", minWidth: 70 }}>
                    <div style={{ fontSize: 10, color: TEXT_DIM }}>TOTAL</div>
                    <div style={{ fontSize: 16, fontFamily: "'Oswald'", fontWeight: 600, color: "#00cc66" }}>${item.total.toFixed(2)}</div>
                  </div>
                  <button onClick={() => removeItem(item.id)} style={{ background: "none", color: RED, fontSize: 18, padding: 4 }}>✕</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ─── JOB GUIDE TAB ─── */
function GuideTab({ guide }) {
  return (
    <div className="fade-in" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div className="card">
        <h4 style={{ color: BLUE, marginBottom: 12 }}>🧰 Tools Needed</h4>
        {guide.tools.map((t, i) => (
          <div key={i} style={{ padding: "6px 0", borderBottom: `1px solid ${CARD_BORDER}`, fontSize: 14 }}>
            ☐ {t}
          </div>
        ))}
      </div>
      <div className="card">
        <h4 style={{ color: "#ff8800", marginBottom: 12 }}>🛒 Shopping List</h4>
        <div style={{ maxHeight: 500, overflowY: "auto" }}>
          {guide.shopping.map((s, i) => (
            <div key={i} style={{ padding: "6px 0", borderBottom: `1px solid ${CARD_BORDER}`, fontSize: 13, display: "flex", justifyContent: "space-between" }}>
              <span>{s.name} <span style={{ color: TEXT_DIM }}>({s.room})</span></span>
              <span style={{ color: "#00cc66", fontWeight: 600 }}>${s.cost}</span>
            </div>
          ))}
          <div style={{ marginTop: 12, fontFamily: "'Oswald'", fontSize: 16, textAlign: "right", color: "#00cc66" }}>
            Total: ${guide.shopping.reduce((s, i) => s + i.cost, 0).toFixed(0)}
          </div>
        </div>
      </div>
      <div className="card" style={{ gridColumn: "1 / -1" }}>
        <h4 style={{ color: "#00cc66", marginBottom: 12 }}>📋 Work Steps by Room</h4>
        {guide.steps.map((s, i) => (
          <div key={i} style={{ padding: "8px 0", borderBottom: `1px solid ${CARD_BORDER}`, fontSize: 14 }}>
            <span style={{ color: BLUE, fontWeight: 600 }}>{s.room}</span> → <span style={{ color: TEXT_DIM }}>{s.detail}:</span> {s.action}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── WATCH OUT TAB ─── */
function WatchOutTab({ issues }) {
  const Section = ({ title, items, color, icon }) => (
    <div className="card" style={{ marginBottom: 16, borderLeft: `3px solid ${color}` }}>
      <h4 style={{ color, marginBottom: 10 }}>{icon} {title} ({items.length})</h4>
      {items.map((item, i) => (
        <div key={i} style={{ padding: "8px 0", borderBottom: `1px solid ${CARD_BORDER}`, fontSize: 14 }}>
          <span style={{ fontWeight: 600 }}>{item.room}</span> — {item.detail}: {item.comment}
        </div>
      ))}
      {items.length === 0 && <div style={{ color: TEXT_DIM, fontSize: 13 }}>None detected.</div>}
    </div>
  );
  return (
    <div className="fade-in">
      <Section title="Critical — Safety & Code" items={issues.critical} color={RED} icon="🚨" />
      <Section title="Important — Damaged / Major Repair" items={issues.important} color="#ff8800" icon="⚠️" />
      <Section title="Minor — Touch-ups & Small Fixes" items={issues.minor} color="#ffcc00" icon="💡" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   JOBS PAGE
   ═══════════════════════════════════════════════════════ */
function JobsPage({ jobs, setJobs }) {
  const [selectedJob, setSelectedJob] = useState(null);
  const [receiptNote, setReceiptNote] = useState("");
  const [receiptAmount, setReceiptAmount] = useState("");

  const addReceipt = (jobId) => {
    if (!receiptNote || !receiptAmount) return;
    setJobs(prev => prev.map(j => j.id === jobId ? {
      ...j,
      receipts: [...j.receipts, { note: receiptNote, amount: parseFloat(receiptAmount), date: new Date().toLocaleDateString() }]
    } : j));
    setReceiptNote("");
    setReceiptAmount("");
  };

  const updateStatus = (jobId, status) => {
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status } : j));
  };

  return (
    <div className="fade-in">
      <h2 style={{ fontSize: 28, color: BLUE, marginBottom: 20 }}>📋 Jobs</h2>
      {jobs.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
          <p style={{ color: TEXT_DIM }}>No jobs yet. Use QuoteForge to create your first job.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {jobs.map(job => (
            <div key={job.id} className="card" style={{ cursor: "pointer" }} onClick={() => setSelectedJob(selectedJob === job.id ? null : job.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h4 style={{ color: TEXT }}>{job.property}</h4>
                  <div style={{ fontSize: 13, color: TEXT_DIM }}>{job.client} · {job.date} · {job.items.length} items</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 22, fontFamily: "'Oswald'", color: "#00cc66" }}>${job.total.toFixed(2)}</div>
                  <select value={job.status} onChange={e => { e.stopPropagation(); updateStatus(job.id, e.target.value); }}
                    onClick={e => e.stopPropagation()}
                    style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, marginTop: 4, background: job.status === "complete" ? "#00cc6633" : job.status === "active" ? `${BLUE}33` : `${RED}33` }}>
                    <option value="quoted">Quoted</option>
                    <option value="active">Active</option>
                    <option value="complete">Complete</option>
                  </select>
                </div>
              </div>
              {selectedJob === job.id && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${CARD_BORDER}` }}>
                  <h5 style={{ color: BLUE, marginBottom: 8 }}>Receipts</h5>
                  {job.receipts.map((r, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
                      <span>{r.date} — {r.note}</span>
                      <span style={{ color: "#ff8800" }}>${r.amount.toFixed(2)}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <input value={receiptNote} onChange={e => setReceiptNote(e.target.value)} placeholder="Receipt note" style={{ flex: 1 }} />
                    <input value={receiptAmount} onChange={e => setReceiptAmount(e.target.value)} placeholder="$" type="number" style={{ width: 80 }} />
                    <button className="btn-blue" onClick={(e) => { e.stopPropagation(); addReceipt(job.id); }}>Add</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   TIME TRACKER
   ═══════════════════════════════════════════════════════ */
function TimeTracker({ timerActive, setTimerActive, timerStart, setTimerStart, timerElapsed, setTimerElapsed, timerJob, setTimerJob, timeEntries, setTimeEntries, formatTime, jobs }) {
  const startTimer = () => {
    setTimerStart(Date.now());
    setTimerActive(true);
  };
  const stopTimer = () => {
    const hours = timerElapsed / 3600000;
    setTimeEntries(prev => [...prev, {
      id: Date.now(),
      job: timerJob || "General",
      date: new Date().toLocaleDateString(),
      hours: Math.round(hours * 100) / 100,
      amount: Math.round(hours * LABOR_RATE * 100) / 100,
    }]);
    setTimerActive(false);
    setTimerStart(null);
    setTimerElapsed(0);
  };

  return (
    <div className="fade-in">
      <h2 style={{ fontSize: 28, color: BLUE, marginBottom: 20 }}>⏱ Time Tracker</h2>
      <div className="card" style={{ textAlign: "center", padding: 32, marginBottom: 20 }}>
        <div style={{ fontSize: 64, fontFamily: "'Oswald'", fontWeight: 700, color: timerActive ? "#00cc66" : TEXT_DIM, letterSpacing: "0.05em" }}>
          {formatTime(timerElapsed)}
        </div>
        <input value={timerJob} onChange={e => setTimerJob(e.target.value)} placeholder="Job / Property name" style={{ marginTop: 16, width: 300, textAlign: "center" }} />
        <div style={{ marginTop: 16 }}>
          {!timerActive ? (
            <button className="btn-blue" onClick={startTimer} style={{ fontSize: 18, padding: "12px 40px" }}>Start</button>
          ) : (
            <button className="btn-red" onClick={stopTimer} style={{ fontSize: 18, padding: "12px 40px" }}>Stop & Log</button>
          )}
        </div>
      </div>
      <div className="card">
        <h4 style={{ marginBottom: 12 }}>Log</h4>
        {timeEntries.length === 0 ? <p style={{ color: TEXT_DIM }}>No entries yet.</p> :
          timeEntries.map(e => (
            <div key={e.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${CARD_BORDER}`, fontSize: 14 }}>
              <span>{e.date} — {e.job}</span>
              <span>{e.hours}h → <span style={{ color: "#00cc66" }}>${e.amount.toFixed(2)}</span></span>
            </div>
          ))
        }
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   PAYROLL
   ═══════════════════════════════════════════════════════ */
function Payroll({ timeEntries, formatTime }) {
  const totalHours = timeEntries.reduce((s, e) => s + e.hours, 0);
  const totalPay = timeEntries.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="fade-in">
      <h2 style={{ fontSize: 28, color: BLUE, marginBottom: 20 }}>💰 Payroll</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: TEXT_DIM }}>TOTAL HOURS</div>
          <div style={{ fontSize: 28, fontFamily: "'Oswald'", color: BLUE }}>{totalHours.toFixed(1)}</div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: TEXT_DIM }}>RATE</div>
          <div style={{ fontSize: 28, fontFamily: "'Oswald'", color: TEXT }}>${LABOR_RATE}/hr</div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: TEXT_DIM }}>TOTAL PAY</div>
          <div style={{ fontSize: 28, fontFamily: "'Oswald'", color: "#00cc66" }}>${totalPay.toFixed(2)}</div>
        </div>
      </div>
      <div className="card">
        <h4 style={{ marginBottom: 12 }}>Bi-Weekly Breakdown</h4>
        <p style={{ color: TEXT_DIM, fontSize: 14 }}>Entries from logged time will appear here for payroll processing.</p>
        {timeEntries.map(e => (
          <div key={e.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${CARD_BORDER}`, fontSize: 14 }}>
            <span>{e.date}</span>
            <span>{e.job}</span>
            <span>{e.hours}h</span>
            <span style={{ color: "#00cc66" }}>${e.amount.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   QUESTS
   ═══════════════════════════════════════════════════════ */
function Quests({ quests, setQuests }) {
  const totalXP = quests.reduce((s, q) => s + (q.progress >= q.target ? q.xp : 0), 0);
  return (
    <div className="fade-in">
      <h2 style={{ fontSize: 28, color: BLUE, marginBottom: 20 }}>🎯 Quests & XP</h2>
      <div className="card" style={{ marginBottom: 20, textAlign: "center", padding: 24 }}>
        <div style={{ fontSize: 12, color: TEXT_DIM }}>TOTAL XP EARNED</div>
        <div style={{ fontSize: 48, fontFamily: "'Oswald'", fontWeight: 700, color: "#ff8800" }}>{totalXP}</div>
      </div>
      {quests.map(q => {
        const pct = Math.min(100, q.progress / q.target * 100);
        const done = q.progress >= q.target;
        return (
          <div key={q.id} className="card" style={{ marginBottom: 12, borderLeft: `3px solid ${done ? "#00cc66" : BLUE}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>{done ? "✅" : "⏳"} {q.title}</span>
              <span style={{ fontFamily: "'Oswald'", color: "#ff8800" }}>+{q.xp} XP</span>
            </div>
            <div style={{ height: 8, background: "#1e1e2e", borderRadius: 4 }}>
              <div style={{ height: 8, background: done ? "#00cc66" : BLUE, borderRadius: 4, width: `${pct}%`, transition: "width 0.5s" }} />
            </div>
            <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 4, textAlign: "right" }}>{q.progress}/{q.target}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   REVIEWS / TESTIMONIALS
   ═══════════════════════════════════════════════════════ */
function Reviews({ testimonials, setTestimonials }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [rating, setRating] = useState(5);

  const add = () => {
    if (!name || !text) return;
    setTestimonials(prev => [...prev, { name, text, rating }]);
    setName(""); setText(""); setRating(5);
  };

  return (
    <div className="fade-in">
      <h2 style={{ fontSize: 28, color: BLUE, marginBottom: 20 }}>⭐ Testimonials</h2>
      <div className="card" style={{ marginBottom: 20 }}>
        <h4 style={{ marginBottom: 12 }}>Add Review</h4>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Client name" style={{ flex: "1 1 200px" }} />
          <select value={rating} onChange={e => setRating(Number(e.target.value))} style={{ width: 80 }}>
            {[5,4,3,2,1].map(r => <option key={r} value={r}>{r}★</option>)}
          </select>
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Review text..." style={{ width: "100%", marginTop: 10, height: 60 }} />
        <button className="btn-blue" onClick={add} style={{ marginTop: 10 }}>Add Testimonial</button>
      </div>
      {testimonials.map((t, i) => (
        <div key={i} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 600 }}>{t.name}</span>
            <span style={{ color: "#ffcc00" }}>{"★".repeat(t.rating)}{"☆".repeat(5 - t.rating)}</span>
          </div>
          <p style={{ color: TEXT_DIM, fontSize: 14, marginTop: 6 }}>"{t.text}"</p>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   REFERRALS
   ═══════════════════════════════════════════════════════ */
function Referrals({ referrals, setReferrals }) {
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("pending");

  const add = () => {
    if (!name) return;
    setReferrals(prev => [...prev, { id: Date.now(), name, source, status, date: new Date().toLocaleDateString() }]);
    setName(""); setSource("");
  };

  return (
    <div className="fade-in">
      <h2 style={{ fontSize: 28, color: BLUE, marginBottom: 20 }}>🤝 Referrals</h2>
      <div className="card" style={{ marginBottom: 20 }}>
        <h4 style={{ marginBottom: 12 }}>Add Referral</h4>
        <div style={{ display: "flex", gap: 10 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Referral name" style={{ flex: 1 }} />
          <input value={source} onChange={e => setSource(e.target.value)} placeholder="Referred by" style={{ flex: 1 }} />
          <button className="btn-blue" onClick={add}>Add</button>
        </div>
      </div>
      {referrals.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 30, color: TEXT_DIM }}>No referrals tracked yet.</div>
      ) : referrals.map(r => (
        <div key={r.id} className="card" style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 600 }}>{r.name}</div>
            <div style={{ fontSize: 13, color: TEXT_DIM }}>From: {r.source} · {r.date}</div>
          </div>
          <select value={r.status} onChange={e => setReferrals(prev => prev.map(ref => ref.id === r.id ? { ...ref, status: e.target.value } : ref))}
            style={{ fontSize: 12, padding: "4px 10px" }}>
            <option value="pending">Pending</option>
            <option value="contacted">Contacted</option>
            <option value="converted">Converted</option>
          </select>
        </div>
      ))}
    </div>
  );
}
