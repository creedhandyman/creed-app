// Creed App — Per-trade tailoring config.
//
// One map drives everything a "primary trade" tailors: the default labor
// rate, the unit labels, Grizz's onboarding line, which materials-db
// categories to bias toward, the default inspection checklist, and the
// starter quote items. Picked in onboarding + Operations → Settings; stored
// on `organizations.primary_trade` (TEXT DEFAULT 'handyman').
//
// IMPORTANT — three trade namespaces exist and DO NOT match:
//   1. primary_trade ids (this file's keys): handyman, plumber, electrician…
//   2. parser TRADE_CATEGORY_LIST (quote buckets + trade_rates keys):
//      Plumbing, Electrical, Carpentry, HVAC, Painting, Flooring, General
//   3. materials-db categories: Plumbing, Electrical, HVAC, Paint, Flooring,
//      Hardware, Appliances, Janitorial, Safety  (note "Paint" ≠ "Painting")
// `materialCategories` below uses namespace 3 (real materials-db keys).
// `primaryTradeToRateCategory()` bridges to namespace 2 so seeding a
// per-trade rate writes the key the quote engine actually reads.

import type { IconName } from "@/components/Icon";

export interface TradeConfig {
  /** primary_trade id — the org-level key. */
  id: string;
  /** Display label. */
  name: string;
  /** Icon.tsx semantic name. */
  icon: IconName;
  /** Seeds organizations.default_rate when the trade is picked. */
  defaultRate: number;
  /** How this trade measures work — shown as a hint, not a column rename. */
  units: string;
  /** Grizz's onboarding speech for this trade (live in the picker step). */
  grizzLine: string;
  /** materials-db category names to bias the material picker toward. */
  materialCategories: string[];
  /** Default inspection checklist items — used as a gap-fill in Inspector
   *  when no room/inspection-type preset already covers the room. */
  checklistTemplate: string[];
  /** Quick-add line items offered on a fresh quote. */
  starterItems: string[];
}

/** Display + iteration order (handyman first = the default). */
export const TRADE_IDS = [
  "handyman",
  "plumber",
  "electrician",
  "hvac",
  "painter",
  "flooring",
  "roofer",
  "gc",
  "landscaper",
] as const;

export type TradeId = (typeof TRADE_IDS)[number];

export const DEFAULT_TRADE = "handyman";

export const TRADE_CONFIG: Record<string, TradeConfig> = {
  handyman: {
    id: "handyman",
    name: "Handyman",
    icon: "hammer",
    defaultRate: 55,
    units: "Hours · sq ft",
    grizzLine:
      "Nice — I'll load general-repair pricing and a multi-trade checklist so you can quote anything.",
    materialCategories: [
      "Plumbing",
      "Electrical",
      "HVAC",
      "Paint",
      "Flooring",
      "Hardware",
      "Appliances",
      "Safety",
      "Janitorial",
    ],
    checklistTemplate: [],
    starterItems: ["Drywall patch & paint", "Door / trim install", "Faucet & fixture swap"],
  },
  plumber: {
    id: "plumber",
    name: "Plumber",
    icon: "plumbing",
    defaultRate: 95,
    units: "Fixtures · fittings",
    grizzLine:
      "Plumber it is. I'll stock fixtures, fittings, and a leak / rough-in checklist for you.",
    materialCategories: ["Plumbing", "Hardware", "Appliances"],
    checklistTemplate: [
      "Water heater",
      "Fixtures & valves",
      "Supply lines",
      "Drains & P-traps",
      "Shutoffs",
      "Leaks / corrosion",
      "Water pressure",
      "Caulking & seals",
    ],
    starterItems: ["Water heater replace", "Fixture & valve set", "Repipe section"],
  },
  electrician: {
    id: "electrician",
    name: "Electrician",
    icon: "electric",
    defaultRate: 90,
    units: "Circuits · amps",
    grizzLine: "Sparky! Panels, circuits, and a code-inspection checklist — loaded.",
    materialCategories: ["Electrical", "Hardware", "Safety"],
    checklistTemplate: [
      "Panel & breakers",
      "Outlets & GFCI",
      "Switches",
      "Light fixtures",
      "Wiring & junctions",
      "Smoke / CO detectors",
      "Grounding",
      "Code violations",
    ],
    starterItems: ["Panel upgrade (200A)", "Add circuit / outlet", "Light fixture install"],
  },
  hvac: {
    id: "hvac",
    name: "HVAC",
    icon: "hvac",
    defaultRate: 110,
    units: "Tons · CFM",
    grizzLine: "HVAC — I'll set up tonnage, equipment, and maintenance-plan templates.",
    materialCategories: ["HVAC", "Electrical", "Hardware"],
    checklistTemplate: [
      "Furnace / air handler",
      "Condenser / coil",
      "Thermostat",
      "Filters",
      "Ductwork",
      "Refrigerant lines",
      "Drain pan / line",
      "Airflow",
    ],
    starterItems: ["System install", "Coil / condenser", "Seasonal tune-up"],
  },
  painter: {
    id: "painter",
    name: "Painter",
    icon: "paint",
    defaultRate: 50,
    units: "Sq ft · gallons",
    grizzLine: "Painter — walls, ceilings, prep, and coats all dialed in by square foot.",
    materialCategories: ["Paint", "Hardware"],
    checklistTemplate: [
      "Walls",
      "Ceilings",
      "Trim & baseboards",
      "Doors",
      "Prep & patching",
      "Caulking",
      "Primer needs",
      "Exterior surfaces",
    ],
    starterItems: ["Interior repaint", "Cabinet refinish", "Exterior + trim"],
  },
  flooring: {
    id: "flooring",
    name: "Flooring",
    icon: "layers",
    defaultRate: 60,
    units: "Sq ft",
    grizzLine: "Flooring — I'll price by square foot for LVP, tile, and carpet.",
    materialCategories: ["Flooring", "Hardware"],
    checklistTemplate: [
      "Subfloor",
      "Existing flooring",
      "Transitions",
      "Baseboards / quarter round",
      "Moisture",
      "Underlayment",
      "Squeaks / level",
      "Trim",
    ],
    starterItems: ["LVP plank install", "Tile + grout", "Carpet & pad"],
  },
  roofer: {
    id: "roofer",
    name: "Roofer",
    icon: "home",
    defaultRate: 75,
    units: "Squares",
    grizzLine: "Roofer — squares, tear-off, and flashing templates ready to go.",
    materialCategories: ["Hardware", "Safety"],
    checklistTemplate: [
      "Shingles / membrane",
      "Flashing",
      "Vents & boots",
      "Gutters",
      "Decking",
      "Soffit & fascia",
      "Leaks / stains",
      "Chimney",
    ],
    starterItems: ["Tear-off + reroof", "Leak repair", "Flashing & vent"],
  },
  gc: {
    id: "gc",
    name: "General",
    icon: "worker",
    defaultRate: 85,
    units: "Project · subs",
    grizzLine: "GC — I'll set up project pricing, sub-trade tracking, and permits.",
    materialCategories: [
      "Plumbing",
      "Electrical",
      "HVAC",
      "Paint",
      "Flooring",
      "Hardware",
      "Appliances",
      "Safety",
    ],
    checklistTemplate: [
      "Structure",
      "Electrical",
      "Plumbing",
      "HVAC",
      "Finishes",
      "Permits",
      "Sub-trades",
      "Safety",
    ],
    starterItems: ["Remodel management", "Subcontractor costs", "Permits & inspections"],
  },
  landscaper: {
    id: "landscaper",
    name: "Landscape",
    icon: "leaf",
    defaultRate: 45,
    units: "Sq ft · hours",
    grizzLine: "Landscaping — cleanups, installs, and recurring maintenance plans.",
    materialCategories: ["Hardware", "Safety", "Janitorial"],
    checklistTemplate: [
      "Lawn / turf",
      "Beds & mulch",
      "Trees / shrubs",
      "Irrigation",
      "Hardscape",
      "Drainage",
      "Edging",
      "Cleanup / haul",
    ],
    starterItems: ["Cleanup & haul", "Install / hardscape", "Maintenance plan"],
  },
};

/** Safe getter — unknown / undefined ids fall back to handyman so the app
 *  never crashes on a legacy org with no primary_trade. */
export function tradeConfig(id?: string | null): TradeConfig {
  return (id && TRADE_CONFIG[id]) || TRADE_CONFIG[DEFAULT_TRADE];
}

/** Resolve an org's primary trade id, coalescing to handyman. */
export function resolvePrimaryTrade(primaryTrade?: string | null): string {
  return primaryTrade && TRADE_CONFIG[primaryTrade] ? primaryTrade : DEFAULT_TRADE;
}

/** Bridge: primary_trade id → the parser's canonical trade-bucket name used
 *  as a `trade_rates` key. Only the trades with a clean 1:1 match return a
 *  name; handyman (multi) and roofer/gc/landscaper (no canonical bucket)
 *  return null, so seeding only sets `default_rate` for those and never
 *  pollutes the "General" catch-all bucket. */
export function primaryTradeToRateCategory(id?: string | null): string | null {
  switch (id) {
    case "plumber":
      return "Plumbing";
    case "electrician":
      return "Electrical";
    case "hvac":
      return "HVAC";
    case "painter":
      return "Painting";
    case "flooring":
      return "Flooring";
    default:
      return null;
  }
}

/** Build the org patch applied when a trade is chosen (onboarding + Ops
 *  Settings). Seeds default_rate always; seeds trade_rates[canonical] only
 *  when (a) the trade has a clean canonical bucket and (b) that key isn't
 *  already set — never overwrites a rate the owner tuned by hand. */
export function tradePatch(
  id: string,
  existingTradeRatesJson?: string | null,
): { primary_trade: string; default_rate: number; trade_rates?: string } {
  const cfg = tradeConfig(id);
  const patch: { primary_trade: string; default_rate: number; trade_rates?: string } = {
    primary_trade: cfg.id,
    default_rate: cfg.defaultRate,
  };
  const cat = primaryTradeToRateCategory(cfg.id);
  if (cat) {
    let rates: Record<string, number> = {};
    try {
      rates = existingTradeRatesJson ? JSON.parse(existingTradeRatesJson) : {};
    } catch {
      rates = {};
    }
    if (!(rates[cat] > 0)) {
      rates[cat] = cfg.defaultRate;
      patch.trade_rates = JSON.stringify(rates);
    }
  }
  return patch;
}
