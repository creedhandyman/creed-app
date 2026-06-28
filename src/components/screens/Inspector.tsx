"use client";
import { apiFetch } from "@/lib/api";
import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/lib/store";
import CustomerPicker from "../CustomerPicker";
import { Icon } from "../Icon";
import CameraModal from "../CameraModal";
import VoiceWalk, { type VoiceWalkResult, type VoiceWalkRoomStatus } from "../VoiceWalk";
import { aiParseVoiceWalkRoom } from "@/lib/parser";
import { tradeConfig, resolvePrimaryTrade } from "@/lib/trades";
import VoiceWalkTip from "../VoiceWalkTip";

/* ── Preset rooms and items ── */

/**
 * Gap-fill an empty / generic ("General") checklist with the org's
 * primary-trade checklist. Specialized trades (plumber, electrician, …) get
 * a relevant default checklist on rooms the inspection type has no preset for,
 * without ever overriding the real room presets (Kitchen, Bath, …). Handyman
 * has an empty template, so its behavior is unchanged.
 */
function applyTradeChecklist(base: string[], primaryTrade?: string | null): string[] {
  const generic = base.length === 0 || (base.length === 1 && base[0] === "General");
  if (!generic) return base;
  const tradeList = tradeConfig(resolvePrimaryTrade(primaryTrade)).checklistTemplate;
  return tradeList.length ? tradeList : base;
}
export const ROOM_PRESETS: Record<string, string[]> = {
  Kitchen: ["Sink/Faucet", "Counters", "Cabinets", "Flooring", "Walls/Ceiling", "Doors", "Windows/Blinds", "Appliances", "Electrical/Lights", "Caulking"],
  "Living Room": ["Flooring", "Walls/Ceiling", "Doors", "Windows/Blinds", "Electrical/Lights", "Baseboards"],
  "Dining Room": ["Flooring", "Walls/Ceiling", "Doors", "Windows/Blinds", "Electrical/Lights", "Baseboards"],
  Entry: ["Flooring", "Walls/Ceiling", "Door/Lock", "Doorbell", "Electrical/Lights"],
  "Hallway/Stairs": ["Flooring", "Walls/Ceiling", "Electrical/Lights", "Railings", "Baseboards"],
  "Laundry Room": ["Flooring", "Walls/Ceiling", "Connections", "Venting", "Cabinets", "Electrical"],
  "Bedroom 1": ["Flooring", "Walls/Ceiling", "Doors", "Windows/Blinds", "Closet", "Electrical/Lights", "Baseboards"],
  "Bedroom 2": ["Flooring", "Walls/Ceiling", "Doors", "Windows/Blinds", "Closet", "Electrical/Lights", "Baseboards"],
  "Bedroom 3": ["Flooring", "Walls/Ceiling", "Doors", "Windows/Blinds", "Closet", "Electrical/Lights", "Baseboards"],
  "Bedroom 4": ["Flooring", "Walls/Ceiling", "Doors", "Windows/Blinds", "Closet", "Electrical/Lights", "Baseboards"],
  "Bathroom 1": ["Toilet", "Sink/Vanity", "Tub/Shower", "Flooring", "Walls/Ceiling", "Mirror/Medicine Cabinet", "Towel Bar/TP Holder", "Exhaust Fan", "Caulking", "Electrical/Lights"],
  "Bathroom 2": ["Toilet", "Sink/Vanity", "Tub/Shower", "Flooring", "Walls/Ceiling", "Mirror/Medicine Cabinet", "Towel Bar/TP Holder", "Exhaust Fan", "Caulking", "Electrical/Lights"],
  "Bathroom 3": ["Toilet", "Sink/Vanity", "Tub/Shower", "Flooring", "Walls/Ceiling", "Mirror/Medicine Cabinet", "Towel Bar/TP Holder", "Exhaust Fan", "Caulking", "Electrical/Lights"],
  Garage: ["Door/Opener", "Flooring", "Walls", "Electrical/Lights", "Exterior Door"],
  Exterior: ["Siding", "Gutters/Downspouts", "Porch/Deck", "Landscaping", "Exterior Lights", "Fencing", "HVAC Unit"],
  Compliance: ["Water Heater", "HVAC System", "Air Filter", "Condenser Unit", "Breaker Panel", "Smoke/CO Detectors", "Fire Extinguisher", "Thermostat", "GFCI Outlets"],
};

/* Context-specific quick actions per item type */
function getPresets(itemName: string): string[] {
  const n = itemName.toLowerCase();
  if (/sink|faucet|vanity|toilet|tub|shower|connect/.test(n))
    return ["Fix leak", "Replace fixture", "Unclog", "Re-caulk", "Tighten", "Replace supply line"];
  if (/wall|ceiling/.test(n))
    return ["Patch", "Touch-up paint", "Full repaint", "Drywall repair", "Texture match"];
  if (/breaker|panel/.test(n))
    return ["Label breakers", "Replace breaker", "Tighten connections", "Cover plate"];
  if (/gfci|outlet|switch/.test(n))
    return ["Replace outlet", "Replace cover plate", "Replace switch", "Tighten"];
  if (/electric|light/.test(n))
    return ["Replace bulb", "Replace cover plate", "Replace fixture", "Replace switch", "Re-secure"];
  if (/floor/.test(n))
    return ["Replace with LVP", "Replace with carpet", "Replace with tile", "Refinish hardwood", "Patch", "Repair plank"];
  if (/door|lock/.test(n) && !/window/.test(n))
    return ["Adjust", "Replace hardware", "Replace door", "Re-key", "Weatherstrip"];
  if (/window|blind/.test(n))
    return ["Replace blinds", "Re-caulk", "Replace screen", "Repair sash"];
  if (/cabinet/.test(n) && !/medicine/.test(n))
    return ["Adjust hinges", "Replace handle", "Repaint", "Replace shelf"];
  if (/exhaust|vent/.test(n))
    return ["Clean", "Replace", "Replace cover"];
  if (/appliance/.test(n))
    return ["Replace", "Repair", "Clean", "Check connections"];
  if (/caulk/.test(n))
    return ["Re-caulk", "Remove mildew"];
  if (/baseboard|trim|railing/.test(n))
    return ["Replace section", "Touch-up paint", "Re-nail", "Re-secure"];
  if (/counter/.test(n))
    return ["Replace - laminate", "Replace - butcher block", "Replace - quartz", "Replace - granite", "Re-seal", "Polish"];
  if (/mirror|medicine/.test(n))
    return ["Replace", "Re-secure", "Replace hardware"];
  if (/towel|tp|paper holder/.test(n))
    return ["Re-secure", "Replace"];
  if (/siding|stucco/.test(n))
    return ["Patch", "Repaint", "Replace section"];
  if (/gutter|downspout/.test(n))
    return ["Clean", "Re-secure", "Replace section"];
  if (/porch|deck/.test(n))
    return ["Re-seal", "Re-stain", "Replace boards"];
  if (/landscape|yard/.test(n))
    return ["Trim", "Remove debris", "Mulch"];
  if (/fenc/.test(n))
    return ["Replace section", "Repaint", "Re-secure"];
  if (/hvac|condenser|furnace/.test(n))
    return ["Service", "Replace filter", "Repair", "Clean coils"];
  if (/filter/.test(n))
    return ["Replace filter", "Clean"];
  if (/water heater|tankless/.test(n))
    return ["Flush tank", "Replace anode", "Replace unit", "Check relief valve"];
  if (/smoke|co detect|carbon/.test(n))
    return ["Replace battery", "Replace unit", "Test"];
  if (/fire ext|extinguisher/.test(n))
    return ["Inspect charge", "Replace", "Mount"];
  if (/thermostat/.test(n))
    return ["Replace", "Calibrate", "Check wiring"];
  if (/garage|opener/.test(n))
    return ["Lubricate tracks", "Replace spring", "Replace opener"];
  if (/closet/.test(n))
    return ["Adjust door", "Replace rod", "Replace shelf"];
  if (/doorbell/.test(n))
    return ["Replace", "Repair wiring"];
  return ["Replace", "Repair needed", "Missing", "Broken", "Clean"];
}

// Display order for the room selection grid
const ROOM_ORDER = [
  "Kitchen", "Living Room",
  "Dining Room", "Entry",
  "Hallway/Stairs", "Laundry Room",
  "Bedroom 1", "Bedroom 2",
  "Bedroom 3", "Bedroom 4",
  "Bathroom 1", "Bathroom 2",
  "Bathroom 3", "Garage",
  "Exterior", "Compliance",
];

/* ── Inspection types ───────────────────────────────────────────────
   Five entry-flow flavors. The user picks one before selecting areas;
   the choice controls which areas appear in the chip grid AND which
   item checklist each area walks through. The choice also gets
   stamped on the resulting InspectionData so the AI parser knows
   what kind of work to scope. */

export type InspectionType = "move-out" | "flooring" | "painting" | "yard" | "initial";

const PAINTING_ITEMS = ["Walls", "Ceiling", "Trim/Baseboards", "Doors", "Window Casings"];
// Floor-only inspection items. Was a single "Flooring" line per room
// (too thin to capture demo / transition / baseboard scope); expanded
// to walk the inspector through every sqft-priced sub-task that the
// quoting AI needs separate signal for.
const FLOORING_ITEMS = [
  "Flooring (condition)",
  "Sqft",
  "Subfloor",
  "Transitions/Thresholds",
  "Baseboards",
  "Tear-out/Haul-away",
];

// Yard/landscape areas — used by the Yard Cutting type. Each area has
// its own item preset focused on recurring grounds tasks rather than
// repair conditions.
const YARD_AREAS = [
  "Front Yard", "Back Yard", "Side Yard", "Driveway",
  "Walkways", "Fence", "Landscaping Beds",
];

const YARD_PRESETS: Record<string, string[]> = {
  "Front Yard": ["Mow", "Edge", "Trim Shrubs", "Cleanup", "Debris Haul"],
  "Back Yard":  ["Mow", "Edge", "Trim Shrubs", "Cleanup", "Debris Haul"],
  "Side Yard":  ["Mow", "Edge", "Trim", "Cleanup"],
  "Driveway":   ["Blow Off Debris", "Weed Control", "Edge"],
  "Walkways":   ["Blow Off", "Edge", "Weed Control"],
  "Fence":      ["Visual Check", "Weed/Vine Clear", "Stain Touch-up"],
  "Landscaping Beds": ["Mulch Refresh", "Weed Pull", "Plant Trim", "Pest Check"],
};

// Structural / MEP areas — used by the Initial Walkthrough type to
// capture a comprehensive baseline (foundation/roof/HVAC/etc.) beyond
// the standard interior rooms.
const STRUCTURAL_AREAS = [
  "Foundation", "Roof", "Drainage",
  "Electrical Panel", "HVAC System", "Plumbing", "Water Heater",
];

const STRUCTURAL_PRESETS: Record<string, string[]> = {
  "Foundation":      ["Cracks", "Settling/Movement", "Moisture/Water intrusion", "Grading/Drainage"],
  "Roof":            ["Shingles/Surface", "Flashing", "Sagging", "Gutters/Downspouts", "Age/Material"],
  "Drainage":        ["Gutter Attached", "Downspout Extension", "Grade Slope", "Pooling/Standing Water"],
  "Electrical Panel": ["Brand/Age", "Capacity (Amp)", "Double-taps", "Labeling", "GFCI/AFCI"],
  "HVAC System":     ["Age", "Condition", "Refrigerant Leaks", "Function (heat + cool)", "Filter Size"],
  "Plumbing":        ["Age", "Supply Line Material", "Visible Leaks", "Function (pressure + drain)", "Visible Corrosion"],
  "Water Heater":    ["Age", "Capacity (gal)", "Leaks", "Function", "T&P Valve"],
};

interface InspectionTypeConfig {
  id: InspectionType;
  label: string;
  /** Lucide icon name registered in src/components/Icon.tsx. */
  icon: string;
  description: string;
  /** Areas suggested in the room-selection chip grid. Switching types
   *  re-renders the grid against this list AND filters the current
   *  selection down to areas the new type recognizes (so a yard
   *  inspection never carries over "Kitchen" silently). */
  suggestedRooms: string[];
  /** Per-area item checklist override. When omitted, the type uses the
   *  standard ROOM_PRESETS lookup. Flooring/Painting Only override to
   *  a fixed item set per room. Yard uses YARD_PRESETS. Initial extends
   *  ROOM_PRESETS with STRUCTURAL_PRESETS for the structural areas. */
  itemsForRoom: (room: string) => string[];
}

const moveOutItems = (room: string): string[] => {
  const exact = ROOM_PRESETS[room];
  if (exact) return exact;
  const baseKey = Object.keys(ROOM_PRESETS).find(
    (k) => room.startsWith(k.replace(/ \d+$/, "")),
  );
  return baseKey ? ROOM_PRESETS[baseKey] : ["General"];
};

export const INSPECTION_TYPES: InspectionTypeConfig[] = [
  {
    id: "move-out",
    label: "Move Out",
    icon: "package",
    description: "Standard move-out walkthrough — condition per item across every area.",
    suggestedRooms: ROOM_ORDER,
    itemsForRoom: moveOutItems,
  },
  {
    id: "flooring",
    label: "Flooring Only",
    icon: "layers",
    description: "Floor-only inspection — sqft + condition per room.",
    // Skip non-floor areas (Compliance/Exterior have no flooring to track).
    suggestedRooms: ROOM_ORDER.filter((r) => !["Compliance", "Exterior"].includes(r)),
    itemsForRoom: () => FLOORING_ITEMS,
  },
  {
    id: "painting",
    label: "Painting Only",
    icon: "paint",
    description: "Painted-surface inspection — walls, ceilings, trim, doors.",
    suggestedRooms: ROOM_ORDER.filter((r) => !["Compliance", "Exterior"].includes(r)),
    itemsForRoom: () => PAINTING_ITEMS,
  },
  {
    id: "yard",
    label: "Yard Cutting",
    icon: "leaf",
    description: "Recurring lawn/landscape service — task checklist per area.",
    suggestedRooms: YARD_AREAS,
    itemsForRoom: (r) => YARD_PRESETS[r] || ["Mow", "Cleanup"],
  },
  {
    id: "initial",
    label: "Initial Walkthrough",
    icon: "list",
    description: "Comprehensive first visit — interior rooms + structural/MEP baseline.",
    suggestedRooms: [...ROOM_ORDER, ...STRUCTURAL_AREAS],
    itemsForRoom: (r) => STRUCTURAL_PRESETS[r] || moveOutItems(r),
  },
];

const CONDITIONS = [
  { code: "S", label: "OK", color: "var(--color-success)", bg: "#00cc6622" },
  { code: "F", label: "Fair", color: "var(--color-highlight)", bg: "#ffcc0022" },
  { code: "P", label: "Poor", color: "var(--color-warning)", bg: "#ff880022" },
  { code: "D", label: "DMG", color: "var(--color-accent-red)", bg: "#C0000022" },
];

// Re-export shared inspection types so callers like QuoteForge/VoiceWalk
// that import from "./Inspector" keep working.
export type { InspectionItem, InspectionRoom } from "@/lib/types";
import type { InspectionItem, InspectionRoom } from "@/lib/types";

export interface InspectionData {
  rooms: InspectionRoom[];
  property: string;
  client: string;
  /** Optional FKs into the new Customer/Address entities. When set, the
   *  resulting inspection job inherits the structured link; otherwise
   *  the legacy free-text `property`/`client` strings remain the source
   *  of truth. */
  customer_id?: string;
  address_id?: string;
  /** Which inspection flavor the user picked at the start (move-out /
   *  flooring / painting / yard / initial). Stamped here so QuoteForge
   *  can pass it to the AI parser and downstream code knows whether
   *  this is a comprehensive inspection, a single-trade survey, or a
   *  recurring yard-cutting log. Optional / defaults to "move-out"
   *  for backward compatibility with saved data. */
  inspection_type?: InspectionType;
}

interface Props {
  onComplete: (data: InspectionData) => void;
  onCancel: () => void;
  darkMode: boolean;
  /** When set, Inspector mounts in edit mode for a saved inspection:
   *  state is seeded from `editing.initialData` instead of localStorage,
   *  the Resume banner is suppressed, the room-selection step is skipped,
   *  the header reads "Edit Inspection", and the bottom action button
   *  reads "Save Changes" instead of "Generate Quote". The parent decides
   *  via this prop whether to db.patch the existing inspection record or
   *  go through the new-inspection flow.
   *  linkedQuoteCount > 0 → show a warning banner that edits won't auto-
   *  flow into the existing quote. */
  editing?: {
    id: string;
    initialData: InspectionData;
    linkedQuoteCount: number;
  };
}

type Step = "rooms" | "inspect" | "review";

export default function Inspector({ onComplete, onCancel, darkMode, editing }: Props) {
  const isEditing = !!editing;
  // Load saved state from localStorage — but ONLY for fresh inspections.
  // Edit mode seeds state from editing.initialData and never touches the
  // localStorage resume slot (so an in-progress edit can't pollute a
  // future fresh inspection's resume banner).
  const loadSaved = <T,>(key: string, fallback: T): T => {
    if (isEditing) return fallback;
    try {
      const v = localStorage.getItem("c_inspect_" + key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  };

  const initialRooms = editing?.initialData.rooms ?? [];

  // In edit mode, jump straight to the "inspect" step — rooms are already
  // chosen and pre-populated from the saved record. The user navigates
  // room-by-room exactly like a fresh inspection but with their data
  // already in place.
  const [step, setStep] = useState<Step>(() =>
    isEditing ? "inspect" : loadSaved("step", "rooms" as Step)
  );
  const [selectedRooms, setSelectedRooms] = useState<string[]>(() =>
    isEditing ? initialRooms.map((r) => r.name) : loadSaved("rooms", []),
  );
  const [customRoom, setCustomRoom] = useState("");
  const [property, setProperty] = useState(() =>
    isEditing ? editing!.initialData.property : loadSaved("property", ""),
  );
  const [client, setClient] = useState(() =>
    isEditing ? editing!.initialData.client : loadSaved("client", ""),
  );
  const [customerId, setCustomerId] = useState<string | undefined>(
    () => isEditing ? editing!.initialData.customer_id : loadSaved<string | undefined>("customerId", undefined),
  );
  const [addressId, setAddressId] = useState<string | undefined>(
    () => isEditing ? editing!.initialData.address_id : loadSaved<string | undefined>("addressId", undefined),
  );
  // The active inspection type drives which areas + items per area get
  // suggested. Default to "move-out" so existing saved inspections that
  // don't have a type field land on the right preset.
  const [inspectionType, setInspectionType] = useState<InspectionType>(() =>
    isEditing
      ? (editing!.initialData.inspection_type || "move-out")
      : loadSaved("inspectionType", "move-out" as InspectionType),
  );
  const activeTypeConfig =
    INSPECTION_TYPES.find((t) => t.id === inspectionType) || INSPECTION_TYPES[0];
  const [currentRoomIdx, setCurrentRoomIdx] = useState(() =>
    isEditing ? 0 : loadSaved("roomIdx", 0),
  );
  const [roomData, setRoomData] = useState<InspectionRoom[]>(() =>
    isEditing ? initialRooms : loadSaved("roomData", []),
  );
  // uploading state replaced by uploadCount for non-blocking batch uploads
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Photo target uses a REF, not state, so its value is captured
  // synchronously at the moment the camera/gallery button is tapped
  // and read back when the file input's onChange fires. With useState
  // the update is async; a second tap on a different item's camera
  // button before the first React re-render could swap the target out
  // from under the in-flight file picker, attaching the photo to the
  // wrong item. Refs update synchronously so the race is gone, and we
  // don't need to re-render anything when the target changes.
  const photoTargetRef = useRef<{ room: number; item: number } | null>(null);
  const [inspCam, setInspCam] = useState(false);
  const [showResume, setShowResume] = useState(() =>
    isEditing ? false : !!localStorage.getItem("c_inspect_roomData"),
  );
  // Per-room voice-walk overlay. When non-null, render the VoiceWalk
  // component in single-room mode for the room at this index. On Done,
  // its raw recording is processed asynchronously by processRoomVoice
  // (Whisper + AI) — the user is auto-advanced to the next room while
  // the previous one transcribes/categorizes in the background.
  const [voiceRoomIdx, setVoiceRoomIdx] = useState<number | null>(null);
  // Per-room background processing status, keyed by room NAME (since
  // VoiceWalk's strip is keyed that way). Drives the ⏳/✓ chip badges.
  const [voiceProcessingStatus, setVoiceProcessingStatus] =
    useState<Record<string, VoiceWalkRoomStatus>>({});

  // Auto-save to localStorage on every change. Suppressed in edit mode so
  // an in-progress edit can't overwrite the resume slot a fresh inspection
  // is supposed to own.
  const save = useCallback((key: string, value: unknown) => {
    if (isEditing) return;
    try {
      localStorage.setItem("c_inspect_" + key, JSON.stringify(value));
    } catch (e) {
      // localStorage full — clear old data and try again
      console.warn("localStorage save failed, clearing old inspection data:", e);
      try {
        localStorage.removeItem("c_inspect_roomData");
        if (key !== "roomData") localStorage.setItem("c_inspect_" + key, JSON.stringify(value));
      } catch { /* give up */ }
    }
  }, [isEditing]);

  useEffect(() => save("step", step), [step, save]);
  useEffect(() => save("rooms", selectedRooms), [selectedRooms, save]);
  useEffect(() => save("property", property), [property, save]);
  useEffect(() => save("client", client), [client, save]);
  useEffect(() => save("customerId", customerId), [customerId, save]);
  useEffect(() => save("addressId", addressId), [addressId, save]);
  useEffect(() => save("roomIdx", currentRoomIdx), [currentRoomIdx, save]);
  useEffect(() => save("inspectionType", inspectionType), [inspectionType, save]);
  // Save roomData but limit photo URLs to prevent localStorage overflow
  useEffect(() => {
    try {
      const compact = roomData.map((r) => ({
        ...r,
        items: r.items.map((it) => ({
          ...it,
          photos: it.photos.slice(0, 20), // Cap at 20 photos per item for storage
        })),
      }));
      save("roomData", compact);
    } catch { /* */ }
  }, [roomData, save]);

  const clearSaved = () => {
    ["step", "rooms", "property", "client", "customerId", "addressId", "roomIdx", "roomData"].forEach(
      (k) => localStorage.removeItem("c_inspect_" + k)
    );
  };

  const border = darkMode ? "#1e1e2e" : "#eee";

  /* ── Room selection helpers ── */
  const toggleRoom = (room: string) => {
    setSelectedRooms((prev) =>
      prev.includes(room) ? prev.filter((r) => r !== room) : [...prev, room]
    );
  };

  const addCustomRoom = () => {
    if (!customRoom.trim() || selectedRooms.includes(customRoom.trim())) return;
    setSelectedRooms((prev) => [...prev, customRoom.trim()]);
    setCustomRoom("");
  };

  /** Background processing for a finished VoiceWalk recording. The user
   *  has already advanced to the next room — this runs Whisper +
   *  aiParseVoiceWalkRoom on the prior room's audio/photos and merges
   *  the resulting items into roomData. The ⏳ / ✓ status drives the
   *  strip chips so the user can see progress without blocking.
   *
   *  roomName is passed by the caller (which has the fresh roomData in
   *  scope) instead of being looked up here, so we don't need a stale
   *  closure or a side-effecting setState read. */
  const processRoomVoice = useCallback(async (roomIdx: number, roomName: string, result: VoiceWalkResult) => {
    if (!roomName) return;

    setVoiceProcessingStatus((prev) => ({ ...prev, [roomName]: "analyzing" }));

    try {
      // Whisper transcribe the audio. Fall back to whatever Web Speech
      // captured (`partialTranscript`) if Whisper is unavailable.
      let transcript = result.partialTranscript;
      if (result.audioBlob && result.audioBlob.size > 1024) {
        try {
          const fd = new FormData();
          fd.append("audio", result.audioBlob, `voicewalk-${roomName.replace(/\W+/g, "-")}.webm`);
          const res = await apiFetch("/api/transcribe", { method: "POST", body: fd });
          if (res.ok) {
            const data = await res.json();
            const text = (data.text as string) || "";
            console.log(`[Inspector] Whisper for "${roomName}": ${result.audioBlob.size}B → ${text.length} chars`);
            if (text.trim()) transcript = text.trim();
          } else {
            // Toasts stay user-friendly; technical detail goes to console.
            // We always have partialTranscript as a fallback, so transcription
            // failure isn't a hard error — downgrade to warning severity.
            const errBody = await res.json().catch(() => ({}));
            const fellBackMsg = result.partialTranscript
              ? "using live preview text"
              : "no narration captured";
            if (res.status === 503) {
              useStore.getState().showToast(
                `Voice transcription unavailable — ${fellBackMsg}.`,
                "warning"
              );
            } else {
              useStore.getState().showToast(
                `Voice transcription failed — ${fellBackMsg}.`,
                "warning"
              );
            }
            console.warn("[Inspector] Whisper failed:", res.status, errBody);
          }
        } catch (e) {
          console.warn("[Inspector] Whisper network error:", e);
        }
      } else {
        console.warn(`[Inspector] No audio blob for "${roomName}" (size ${result.audioBlob?.size || 0}B); using partial transcript only`);
      }

      if (!transcript && result.photos.length === 0) {
        // Nothing to feed AI. Mark as failed so the chip shows ✕.
        setVoiceProcessingStatus((prev) => ({ ...prev, [roomName]: "failed" }));
        return;
      }

      // AI categorization. For rooms with no preset, gap-fill with the org's
      // primary-trade checklist so the AI gets trade-relevant item names.
      const baseChecklist = ROOM_PRESETS[roomName] || (() => {
        const baseKey = Object.keys(ROOM_PRESETS).find((k) => roomName.startsWith(k.replace(/ \d+$/, "")));
        return baseKey ? ROOM_PRESETS[baseKey] : [];
      })();
      const checklist = applyTradeChecklist(baseChecklist, useStore.getState().org?.primary_trade);
      console.log(`[Inspector] AI for "${roomName}": ${transcript.length} chars, ${result.photos.length} photos, ${checklist.length} checklist items`);
      const items = await aiParseVoiceWalkRoom(
        roomName,
        transcript,
        result.photos,
        checklist,
        property,
        client
      );
      console.log(`[Inspector] AI returned ${items.length} items for "${roomName}":`, items.map((it) => `${it.name}[${it.condition}]`).join(", "));

      // Merge into roomData. Policy:
      //  1. Drop scaffold-S items the user never touched (they're the
      //     default placeholders and would clutter the result).
      //  2. Keep user-edited items (non-S, OR has notes, OR has photos).
      //  3. For each AI item, drop it if a user-edited item with the
      //     same name already exists — user edits win over AI for the
      //     same component. Otherwise append.
      //  4. AI items with a name matching a dropped scaffold replace it.
      // This prevents the previous duplicate-Flooring problem where AI
      // and scaffold both produced an entry under the same name.
      if (items.length > 0) {
        setRoomData((prev) => prev.map((r, ri) => {
          if (ri !== roomIdx) return r;
          const isUserEdited = (it: InspectionItem) =>
            it.condition !== "S" || !!(it.notes && it.notes.trim()) || (it.photos && it.photos.length > 0);
          // Keep EVERY existing checklist item. Items the inspector didn't
          // talk about must persist (blank, condition "S") so they can still
          // be filled in by hand — they used to get dropped, which deleted
          // the whole checklist except the few things mentioned. Per item:
          // user edits always win; otherwise the AI's assessment replaces the
          // untouched scaffold for that component; otherwise keep the scaffold
          // as-is. Then append any AI findings that aren't on the checklist.
          const aiByName = new Map(items.map((it) => [it.name.toLowerCase(), it]));
          const existingNames = new Set(r.items.map((it) => it.name.toLowerCase()));
          const merged = r.items.map((it) => {
            if (isUserEdited(it)) return it;
            return aiByName.get(it.name.toLowerCase()) ?? it;
          });
          const extra = items.filter((it) => !existingNames.has(it.name.toLowerCase()));
          return { ...r, items: [...merged, ...extra] };
        }));
      } else {
        useStore.getState().showToast(`AI couldn't categorize "${roomName}" — checklist scaffold kept.`, "warning");
      }
      setVoiceProcessingStatus((prev) => ({ ...prev, [roomName]: "done" }));
    } catch (err) {
      console.error(`[Inspector] processRoomVoice failed for "${roomName}":`, err);
      setVoiceProcessingStatus((prev) => ({ ...prev, [roomName]: "failed" }));
      useStore.getState().showToast(`Processing failed for ${roomName}`, "error");
    }
  }, [property, client]);

  const startInspection = () => {
    // In edit mode: do a DELTA. Preserve every existing room's items /
    // photos / sqft / dimensions; initialize new rooms (added via the
    // selection screen) with a fresh checklist; drop rooms the user
    // un-selected. A bare reset would obliterate hours of inspection
    // data the user is trying to extend.
    // Type-aware item picker. Falls back to the standard ROOM_PRESETS
    // for any area the active type doesn't have an override for.
    const itemsFor = (room: string): string[] => {
      const fromType = applyTradeChecklist(
        activeTypeConfig.itemsForRoom(room),
        useStore.getState().org?.primary_trade,
      );
      return fromType.length > 0 ? fromType : ["General"];
    };

    if (isEditing) {
      const existing = new Map(roomData.map((r) => [r.name, r]));
      const data = selectedRooms.map((room) => {
        const prior = existing.get(room);
        if (prior) return prior;
        const items = itemsFor(room).map(
          (name) => ({ name, condition: "S", notes: "", photos: [] }),
        );
        return { name: room, sqft: 0, items };
      });
      setRoomData(data);
      setCurrentRoomIdx(0);
      setStep("inspect");
      return;
    }
    const data = selectedRooms.map((room) => {
      const items = itemsFor(room).map(
        (name) => ({ name, condition: "S", notes: "", photos: [] })
      );
      return { name: room, sqft: 0, items };
    });
    setRoomData(data);
    setCurrentRoomIdx(0);
    setStep("inspect");
  };

  /* ── Inspection helpers ── */
  const updateItem = (roomIdx: number, itemIdx: number, field: keyof InspectionItem, value: string | string[]) => {
    setRoomData((prev) =>
      prev.map((r, ri) =>
        ri === roomIdx
          ? {
              ...r,
              items: r.items.map((it, ii) =>
                ii === itemIdx ? { ...it, [field]: value } : it
              ),
            }
          : r
      )
    );
  };

  // Compress image before upload
  const compressFile = async (file: File, maxSize = 1200): Promise<Blob> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", 0.7);
      };
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  };

  const [uploadCount, setUploadCount] = useState(0);

  const uploadPhoto = async (file: File, roomIdx: number, itemIdx: number) => {
    setUploadCount((c) => c + 1);
    try {
      const compressed = await compressFile(file);
      const path = `inspections/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
      const { error } = await supabase.storage.from("receipts").upload(path, compressed);
      if (error) throw error;
      const { data } = supabase.storage.from("receipts").getPublicUrl(path);
      const url = data.publicUrl;
      setRoomData((prev) =>
        prev.map((r, ri) =>
          ri === roomIdx
            ? { ...r, items: r.items.map((it, ii) => ii === itemIdx ? { ...it, photos: [...it.photos, url] } : it) }
            : r
        )
      );
    } catch (err) {
      console.error("Photo upload failed:", err);
      useStore.getState().showToast("Photo upload failed", "error");
    }
    setUploadCount((c) => c - 1);
  };

  // Batch upload — multiple files at once, non-blocking
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    // Read the target the user intended at click-time (set on the ref
    // immediately before `.click()`). Reading the ref instead of state
    // guarantees we get the value the user actually targeted, not a
    // stale value from a previous tap or an interleaved re-render.
    const target = photoTargetRef.current;
    if (!files?.length || !target) return;
    // Upload all files concurrently
    Array.from(files).forEach((file) => {
      uploadPhoto(file, target.room, target.item);
    });
    if (cameraRef.current) cameraRef.current.value = "";
    if (fileRef.current) fileRef.current.value = "";
  };

  // Same as handlePhotoSelect but for the in-app CameraModal, which hands
  // back File[] directly instead of via an <input> change event.
  const handleCapturedFiles = (files: File[]) => {
    const target = photoTargetRef.current;
    if (!files.length || !target) return;
    files.forEach((file) => uploadPhoto(file, target.room, target.item));
  };

  const addItemToRoom = (roomIdx: number) => {
    setRoomData((prev) =>
      prev.map((r, ri) =>
        ri === roomIdx
          ? { ...r, items: [...r.items, { name: "Custom Item", condition: "S", notes: "", photos: [] }] }
          : r
      )
    );
  };

  /* ── Review helpers ── */
  const findingsCount = roomData.reduce(
    (s, r) => s + r.items.filter((it) => it.condition !== "S").length,
    0
  );
  const photosCount = roomData.reduce(
    (s, r) => s + r.items.reduce((ss, it) => ss + it.photos.length, 0),
    0
  );

  const handleGenerate = () => {
    // Don't clearSaved in edit mode — there's nothing in localStorage to
    // clear (we never wrote there) and we don't want a stale fresh-
    // inspection resume slot to get nuked just because someone edited
    // a saved inspection.
    if (!isEditing) clearSaved();
    onComplete({
      rooms: roomData,
      property,
      client,
      customer_id: customerId,
      address_id: addressId,
      inspection_type: inspectionType,
    });
  };

  /* ═══════════════════════════════════
     ROOM SELECTION
     ═══════════════════════════════════ */
  if (step === "rooms") {
    return (
      <div className="fi">
        <div className="row mb">
          <button className="bo" onClick={() => { if (!isEditing) clearSaved(); onCancel(); }}>←</button>
          <h2 style={{ fontSize: 20, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="search" size={18} color="var(--color-primary)" />{isEditing ? "Edit Inspection" : "New Inspection"}
          </h2>
        </div>

        {/* Linked-quote warning — surfaces in edit mode when one or more
            quotes were previously generated from this inspection. The
            edit doesn't auto-update those quotes, so the user knows to
            regenerate if they want the changes flowed through. */}
        {isEditing && (editing?.linkedQuoteCount ?? 0) > 0 && (
          <div
            className="cd mb statusstrip"
            style={{
              ["--c" as any]: "var(--color-accent-red)",
              padding: 10,
            }}
          >
            <b style={{ fontSize: 15 }}>⚠ This inspection has {editing!.linkedQuoteCount} linked quote{editing!.linkedQuoteCount === 1 ? "" : "s"}</b>
            <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>
              Edits will not auto-update the existing quote{editing!.linkedQuoteCount === 1 ? "" : "s"} — regenerate from this inspection to flow the changes through.
            </div>
          </div>
        )}

        {/* Resume banner */}
        {showResume && roomData.length > 0 && (
          <div
            className="cd mb statusstrip"
            style={{
              ["--c" as any]: "var(--color-warning)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <b style={{ fontSize: 15 }}>Resume inspection?</b>
              <div className="dim" style={{ fontSize: 13 }}>
                {property || "Untitled"} · {roomData.length} areas
              </div>
            </div>
            <div className="row">
              <button
                className="bb"
                onClick={() => { setStep(roomData.length ? "inspect" : "rooms"); setShowResume(false); }}
                style={{ fontSize: 14, padding: "5px 12px" }}
              >
                Resume
              </button>
              <button
                className="bo"
                onClick={() => {
                  clearSaved();
                  setRoomData([]);
                  setSelectedRooms([]);
                  setProperty("");
                  setClient("");
                  setCustomerId(undefined);
                  setAddressId(undefined);
                  setCurrentRoomIdx(0);
                  setShowResume(false);
                }}
                style={{ fontSize: 14, padding: "5px 10px", color: "var(--color-accent-red)" }}
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {/* Property + Client */}
        <div className="cd mb">
          <CustomerPicker
            prop={property}
            setProp={setProperty}
            client={client}
            setClient={setClient}
            customerId={customerId}
            setCustomerId={setCustomerId}
            addressId={addressId}
            setAddressId={setAddressId}
          />
        </div>

        {/* Inspection-type chip strip. Five flavors; the active one
            drives both the suggested-rooms grid below AND the per-area
            item checklist each room walks through. Switching types
            filters the current selection to areas the new type
            recognizes (never auto-discards picks the new type still
            supports — Move-Out → Flooring keeps Kitchen/Living Room
            etc.; Move-Out → Yard drops them because Yard has its own
            area set). */}
        <div className="cd mb" style={{ padding: 10 }}>
          <h4 style={{ fontSize: 15, marginBottom: 6 }}>Inspection Type</h4>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
            {INSPECTION_TYPES.map((t) => {
              const active = t.id === inspectionType;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    if (t.id === inspectionType) return;
                    setInspectionType(t.id);
                    // Filter the current selection down to areas the
                    // new type knows about. Move-Out → Flooring keeps
                    // shared rooms; Move-Out → Yard drops everything.
                    setSelectedRooms((prev) =>
                      prev.filter((r) => t.suggestedRooms.includes(r)),
                    );
                  }}
                  title={t.description}
                  style={{
                    flexShrink: 0,
                    padding: "6px 12px",
                    borderRadius: 16,
                    fontSize: 14,
                    fontFamily: "Oswald",
                    letterSpacing: ".04em",
                    background: active ? "var(--color-primary)" : "transparent",
                    color: active ? "#fff" : "var(--color-primary)",
                    border: `1px solid var(--color-primary)`,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Icon
                    name={t.icon}
                    size={14}
                    color={active ? "#fff" : "var(--color-primary)"}
                    strokeWidth={2}
                  />
                  {t.label}
                </button>
              );
            })}
          </div>
          <p className="dim" style={{ fontSize: 13, margin: "6px 0 0" }}>
            {activeTypeConfig.description}
          </p>
        </div>

        {/* Room checklist */}
        <div className="cd mb">
          <h4 style={{ fontSize: 15, marginBottom: 8 }}>Select Areas to Inspect</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {activeTypeConfig.suggestedRooms.map((room) => {
              const checked = selectedRooms.includes(room);
              return (
                <label
                  key={room}
                  onClick={() => toggleRoom(room)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 8px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 14,
                    background: checked ? "var(--color-primary)" + "22" : "transparent",
                    border: `1px solid ${checked ? "var(--color-primary)" : border}`,
                  }}
                >
                  <span style={{ color: checked ? "var(--color-primary)" : "#888", fontSize: 16 }}>
                    {checked ? "☑" : "☐"}
                  </span>
                  {room}
                </label>
              );
            })}
          </div>

          {/* Custom room */}
          <div className="row" style={{ marginTop: 8 }}>
            <input
              value={customRoom}
              onChange={(e) => setCustomRoom(e.target.value)}
              placeholder="Add custom area"
              style={{ flex: 1, fontSize: 14 }}
              onKeyDown={(e) => e.key === "Enter" && addCustomRoom()}
            />
            <button className="bo" onClick={addCustomRoom} style={{ fontSize: 14, padding: "5px 10px" }}>
              + Add
            </button>
          </div>

          {/* Custom rooms added */}
          {selectedRooms
            .filter((r) => !Object.keys(ROOM_PRESETS).includes(r))
            .map((r) => (
              <div
                key={r}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 8px",
                  borderRadius: 12,
                  fontSize: 15,
                  background: "var(--color-primary)" + "22",
                  color: "var(--color-primary)",
                  margin: "4px 4px 0 0",
                }}
              >
                {r}
                <span
                  onClick={() => setSelectedRooms((prev) => prev.filter((x) => x !== r))}
                  style={{ cursor: "pointer", color: "var(--color-accent-red)" }}
                >
                  ✕
                </span>
              </div>
            ))}
        </div>

        {/* Start button */}
        <button
          className="bb"
          onClick={startInspection}
          disabled={!selectedRooms.length || !property}
          style={{
            width: "100%",
            padding: 12,
            fontSize: 17,
            opacity: !selectedRooms.length || !property ? 0.5 : 1,
          }}
        >
          {isEditing ? "Continue Editing" : "Start Inspection"} ({selectedRooms.length} areas) →
        </button>
        <p className="dim" style={{ fontSize: 13, textAlign: "center", marginTop: 6 }}>
          Each room has a Voice mic — tap it inside the inspection to record continuously and let AI fill the checklist.
        </p>
      </div>
    );
  }

  /* ═══════════════════════════════════
     ROOM INSPECTION
     ═══════════════════════════════════ */
  if (step === "inspect") {
    const room = roomData[currentRoomIdx];
    if (!room) return null;

    // When the user taps the per-room mic, render VoiceWalk in
    // single-room mode for that room. On Done, merge findings into
    // the room's items (replacing scaffold S items so the AI's
    // conditioned items don't duplicate them).
    if (voiceRoomIdx !== null) {
      const voiceRoom = roomData[voiceRoomIdx];
      if (!voiceRoom) {
        setVoiceRoomIdx(null);
      } else {
        return (
          <>
            <VoiceWalkTip show={true} />
            <VoiceWalk
            // Remount on auto-advance so VoiceWalk's internal state
            // (currentIdx, recordings, mentioned, audio chunks) starts
            // fresh for the new room instead of carrying state from
            // the previous one.
            key={voiceRoomIdx}
            property={property}
            client={client}
            // Pass ONLY the active room. VoiceWalk's currentIdx defaults
            // to 0 so it naturally shows rooms[0] = the active room.
            // The strip is hidden in singleRoom mode anyway, so passing
            // the full list bought nothing and caused the title /
            // checklist / audio-bucket to all key off the wrong room.
            rooms={[voiceRoom.name]}
            singleRoom
            // Single source of truth — the same `type × area` checklist
            // the Inspector form uses. Without this, VoiceWalk falls
            // back to the legacy move-out ROOM_PRESETS map and shows
            // Kitchen voice prompts even on a Painting/Yard/Initial
            // inspection. Threading the active type's items function
            // here keeps the voice "things to mention" list in lockstep
            // with what the user sees on the inspection form.
            itemsForRoom={activeTypeConfig.itemsForRoom}
            roomStatuses={voiceProcessingStatus}
            onComplete={(result) => {
              // Capture the index AND name BEFORE we mutate state —
              // processRoomVoice runs in the background and needs both.
              const idx = voiceRoomIdx;
              const name = idx !== null ? roomData[idx]?.name : undefined;
              if (idx !== null && name) {
                // Fire and forget. The user advances immediately; the
                // chip in the strip flips ⏳ → ✓ when this finishes.
                void processRoomVoice(idx, name, result);
              }
              // Auto-advance to the next area: open Voice Walk for the
              // next room and move the underlying Inspector cursor too.
              const nextIdx = (idx ?? 0) + 1;
              if (nextIdx < roomData.length) {
                setCurrentRoomIdx(nextIdx);
                setVoiceRoomIdx(nextIdx);
                useStore.getState().showToast(`Moving to ${roomData[nextIdx].name}…`, "info");
              } else {
                setVoiceRoomIdx(null);
                useStore.getState().showToast("All rooms recorded — processing in the background.", "success");
              }
            }}
            onCancel={() => setVoiceRoomIdx(null)}
            darkMode={darkMode}
          />
          </>
        );
      }
    }

    return (
      <div className="fi">
        {/* Hidden file inputs — one for camera, one for gallery/files */}
        <CameraModal
          open={inspCam}
          onClose={() => setInspCam(false)}
          onCapture={handleCapturedFiles}
          multiple
          title="Inspection photo"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={handlePhotoSelect}
        />

        {/* Header */}
        <div className="row mb" style={{ justifyContent: "space-between" }}>
          <div className="row">
            <button className="bo" onClick={() => setStep("rooms")} style={{ fontSize: 14, padding: "4px 8px" }}>←</button>
            <h2 style={{ fontSize: 20, color: "var(--color-primary)" }}>{room.name}</h2>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {/* Per-room voice walk: tap to open a one-continuous-recording
                + camera + checklist panel for THIS room. AI fills the
                checklist with conditions and notes when you tap Done. */}
            <button
              onClick={() => setVoiceRoomIdx(currentRoomIdx)}
              title="Voice walk this room"
              style={{
                background: "rgba(0,204,102,0.14)",
                border: "1.5px solid rgba(0,204,102,0.85)",
                boxShadow: "0 0 24px -2px rgba(0,204,102,0.5), inset 0 0 22px -8px rgba(0,204,102,0.45)",
                color: "#fff",
                borderRadius: 16,
                padding: "5px 12px",
                fontSize: 15,
                fontFamily: "Oswald",
                letterSpacing: ".04em",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                cursor: "pointer",
              }}
            >
              <Icon name="mic" size={14} color="#3ee08f" strokeWidth={2.25} />
              Voice
            </button>
            <span className="dim" style={{ fontSize: 15, fontFamily: "Oswald" }}>
              {currentRoomIdx + 1} / {roomData.length}
            </span>
          </div>
        </div>

        {/* Upload indicator */}
        {uploadCount > 0 && (
          <div style={{ fontSize: 14, color: "var(--color-primary)", textAlign: "center", marginBottom: 6 }}>
            📤 Uploading {uploadCount} photo{uploadCount > 1 ? "s" : ""}...
          </div>
        )}

        {/* Room jump — tap any room to jump to it. Voice processing
            status (⏳/✓/✕) shows here too so the user can see which
            rooms are still being categorized after leaving VoiceWalk. */}
        <div style={{ display: "flex", gap: 3, marginBottom: 10, overflowX: "auto", paddingBottom: 4 }}>
          {roomData.map((r, ri) => {
            const hasFindings = r.items.some((it) => it.condition !== "S");
            const hasPhotos = r.items.some((it) => it.photos.length > 0);
            const vStatus = voiceProcessingStatus[r.name];
            const statusBadge = vStatus === "analyzing" ? "⏳ "
              : vStatus === "done" ? "✓ "
              : vStatus === "failed" ? "✕ "
              : "";
            return (
              <button
                key={ri}
                onClick={() => setCurrentRoomIdx(ri)}
                style={{
                  padding: "4px 8px", borderRadius: 6, fontSize: 13, whiteSpace: "nowrap",
                  background: ri === currentRoomIdx ? "var(--color-primary)" : "transparent",
                  color: ri === currentRoomIdx ? "#fff" : hasFindings ? "var(--color-warning)" : "#888",
                  border: `1px solid ${ri === currentRoomIdx ? "var(--color-primary)" : border}`,
                  fontFamily: "Oswald", flexShrink: 0,
                }}
              >
                {statusBadge}
                {r.name.length > 10 ? r.name.slice(0, 10) + "…" : r.name}
                {hasPhotos && " 📷"}
              </button>
            );
          })}
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, background: border, borderRadius: 2, marginBottom: 10 }}>
          <div style={{ height: 3, background: "var(--color-primary)", borderRadius: 2, width: `${((currentRoomIdx + 1) / roomData.length) * 100}%`, transition: "width 0.3s" }} />
        </div>

        {/* Room size — W × L auto-calculates sqft. Width/length persist on
            the room so the inputs round-trip when the inspector navigates
            back; sqft is still the source of truth for downstream pricing. */}
        <div className="cd" style={{ marginBottom: 8, padding: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="calc" size={14} color="var(--color-primary)" />
          <div style={{ flex: 1 }}>
            <label className="sl">Area Size (W × L)</label>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
              <input
                type="number"
                inputMode="decimal"
                value={room.width || ""}
                placeholder="W"
                min="0"
                step="0.1"
                style={{ fontSize: 15, width: 70, textAlign: "center" }}
                onChange={(e) => {
                  const w = parseFloat(e.target.value) || 0;
                  setRoomData((prev) =>
                    prev.map((r, ri) => ri === currentRoomIdx
                      ? { ...r, width: w, sqft: w && r.length ? +(w * r.length).toFixed(1) : r.sqft }
                      : r)
                  );
                }}
              />
              <span style={{ fontSize: 16, color: "#888" }}>×</span>
              <input
                type="number"
                inputMode="decimal"
                value={room.length || ""}
                placeholder="L"
                min="0"
                step="0.1"
                style={{ fontSize: 15, width: 70, textAlign: "center" }}
                onChange={(e) => {
                  const l = parseFloat(e.target.value) || 0;
                  setRoomData((prev) =>
                    prev.map((r, ri) => ri === currentRoomIdx
                      ? { ...r, length: l, sqft: r.width && l ? +(r.width * l).toFixed(1) : r.sqft }
                      : r)
                  );
                }}
              />
              <span style={{ fontSize: 13, color: "#888" }}>ft</span>
            </div>
          </div>
          {room.sqft > 0 && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 20, fontFamily: "Oswald", color: "var(--color-primary)", lineHeight: 1 }}>{room.sqft}</div>
              <div className="dim" style={{ fontSize: 10 }}>sq ft</div>
            </div>
          )}
        </div>

        {/* Items */}
        {room.items.map((item, itemIdx) => (
          <div
            key={itemIdx}
            className="cd statusstrip"
            style={{
              marginBottom: 6,
              padding: 10,
              ["--c" as any]: CONDITIONS.find((c) => c.code === item.condition)?.color || "#888",
            }}
          >
            {/* Item name (editable for custom items) */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <input
                value={item.name}
                onChange={(e) => updateItem(currentRoomIdx, itemIdx, "name", e.target.value)}
                style={{
                  background: "transparent",
                  border: "none",
                  fontWeight: 600,
                  fontSize: 15,
                  padding: 0,
                  width: "auto",
                  flex: 1,
                }}
              />
              {/* Photo buttons */}
              <div style={{ display: "flex", gap: 2 }}>
                <button
                  onClick={() => {
                    // Stamp the target synchronously so the capture handler
                    // reads the room/item the user just tapped, even if
                    // another item's button gets tapped first.
                    photoTargetRef.current = { room: currentRoomIdx, item: itemIdx };
                    setInspCam(true);
                  }}
                  disabled={uploadCount > 0}
                  title="Take photo"
                  style={{
                    background: "none",
                    padding: "2px 4px",
                    color: item.photos.length ? "var(--color-success)" : "#888",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <Icon name="camera" size={16} />
                </button>
                <button
                  onClick={() => {
                    // Same synchronous stamp as the camera button.
                    photoTargetRef.current = { room: currentRoomIdx, item: itemIdx };
                    fileRef.current?.click();
                  }}
                  disabled={uploadCount > 0}
                  title="Upload photo"
                  style={{
                    background: "none",
                    padding: "2px 4px",
                    color: "#888",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <Icon name="upload" size={16} />
                </button>
                {item.photos.length > 0 && (
                  <span style={{ fontSize: 15, color: "var(--color-success)", alignSelf: "center" }}>
                    {item.photos.length}
                  </span>
                )}
              </div>
            </div>

            {/* Condition buttons */}
            <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
              {CONDITIONS.map((c) => (
                <button
                  key={c.code}
                  onClick={() => updateItem(currentRoomIdx, itemIdx, "condition", c.code)}
                  style={{
                    flex: 1,
                    padding: "4px 0",
                    borderRadius: 4,
                    fontSize: 14,
                    fontFamily: "Oswald",
                    background: item.condition === c.code ? c.bg : "transparent",
                    color: item.condition === c.code ? c.color : "#666",
                    border: `1px solid ${item.condition === c.code ? c.color : border}`,
                    fontWeight: item.condition === c.code ? 700 : 400,
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Notes + quick presets (show when not S) */}
            {item.condition !== "S" && (<>
              {/* Quick note presets — tailored to this item type */}
              <div style={{ display: "flex", gap: 3, marginBottom: 4, flexWrap: "wrap" }}>
                {getPresets(item.name).map((preset) => (
                  <button
                    key={preset}
                    onClick={() => {
                      const current = (item.notes || "").trim();
                      const lcCurrent = current.toLowerCase();
                      const lcPreset = preset.toLowerCase();
                      // Verbatim already there — no-op (avoid the
                      // "Replace LVP. Replace LVP" duplication).
                      if (lcCurrent.includes(lcPreset)) return;
                      // Pull the chip's "intent" word — the last
                      // non-filler word, usually the material noun
                      // ("carpet" / "LVP" / "tile" / "hardwood").
                      // If the existing notes already mention that
                      // intent (a fragment the user free-typed like
                      // "Replace carpet"), upgrade it to the
                      // canonical chip text instead of appending and
                      // creating "Replace carpet. Replace with carpet".
                      const filler = new Set(["with", "and", "the", "or", "a", "to", "for"]);
                      const significant = (lcPreset.match(/\b[\w/]+\b/g) || []).filter((w) => !filler.has(w));
                      const intent = significant[significant.length - 1] || "";
                      if (intent && lcCurrent.includes(intent)) {
                        updateItem(currentRoomIdx, itemIdx, "notes", preset);
                        return;
                      }
                      const updated = current ? `${current}. ${preset}` : preset;
                      updateItem(currentRoomIdx, itemIdx, "notes", updated);
                    }}
                    style={{
                      fontSize: 13, padding: "2px 6px", borderRadius: 4,
                      background: "transparent", border: `1px solid ${border}`,
                      color: item.notes?.toLowerCase().includes(preset.toLowerCase()) ? "var(--color-primary)" : "#888",
                      cursor: "pointer",
                    }}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <input
                value={item.notes}
                onChange={(e) => updateItem(currentRoomIdx, itemIdx, "notes", e.target.value)}
                placeholder="Describe the issue..."
                style={{ fontSize: 14 }}
              />
            </>)}

            {/* Photo thumbnails */}
            {item.photos.length > 0 && (
              <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                {item.photos.map((url, pi) => (
                  <div key={pi} style={{ position: "relative" }}>
                    <img
                      src={url}
                      alt=""
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 4,
                        objectFit: "cover",
                        border: `1px solid ${border}`,
                      }}
                    />
                    <span
                      onClick={() => {
                        const newPhotos = item.photos.filter((_, i) => i !== pi);
                        updateItem(currentRoomIdx, itemIdx, "photos", newPhotos);
                      }}
                      style={{
                        position: "absolute",
                        top: -4,
                        right: -4,
                        background: "var(--color-accent-red)",
                        color: "#fff",
                        borderRadius: "50%",
                        width: 14,
                        height: 14,
                        fontSize: 15,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Add custom item */}
        <button
          className="bo"
          onClick={() => addItemToRoom(currentRoomIdx)}
          style={{ fontSize: 14, padding: "5px 12px", marginBottom: 12 }}
        >
          + Add Item
        </button>

        {/* Navigation — sticky above the bottom nav so the Next button
            never gets clipped when the user scrolls to the bottom of a
            room with a long item list. */}
        <div className="sb" style={{ display: "flex", gap: 8 }}>
          {currentRoomIdx > 0 && (
            <button
              className="bo"
              onClick={() => setCurrentRoomIdx((prev) => prev - 1)}
              style={{ flex: 1, padding: 10, fontSize: 15 }}
            >
              ← {roomData[currentRoomIdx - 1]?.name}
            </button>
          )}
          {currentRoomIdx < roomData.length - 1 ? (
            <button
              className="bb"
              onClick={() => setCurrentRoomIdx((prev) => prev + 1)}
              style={{ flex: 1, padding: 10, fontSize: 15 }}
            >
              {roomData[currentRoomIdx + 1]?.name} →
            </button>
          ) : (
            <button
              className="bg"
              onClick={() => setStep("review")}
              style={{ flex: 1, padding: 10, fontSize: 15 }}
            >
              Review Inspection →
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════
     REVIEW
     ═══════════════════════════════════ */
  return (
    <div className="fi">
      <div className="row mb">
        <button className="bo" onClick={() => setStep("inspect")} style={{ fontSize: 14, padding: "4px 8px" }}>← Edit</button>
        <h2 style={{ fontSize: 20, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="search" size={18} color="var(--color-primary)" />Inspection Review
        </h2>
      </div>

      {/* Property */}
      <div className="cd mb">
        <div style={{ fontSize: 15 }}>
          <b>{property}</b>
          {client && <span className="dim"> · {client}</span>}
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div className="cd" style={{ textAlign: "center" }}>
          <div className="sl">Areas</div>
          <div className="sv" style={{ color: "var(--color-primary)" }}>{roomData.length}</div>
        </div>
        <div className="cd" style={{ textAlign: "center" }}>
          <div className="sl">Findings</div>
          <div className="sv" style={{ color: "var(--color-warning)" }}>{findingsCount}</div>
        </div>
        <div className="cd" style={{ textAlign: "center" }}>
          <div className="sl">Photos</div>
          <div className="sv" style={{ color: "var(--color-success)" }}>{photosCount}</div>
        </div>
      </div>

      {/* Room-by-room summary */}
      {roomData.map((room, ri) => {
        const issues = room.items.filter((it) => it.condition !== "S");
        const roomPhotos = room.items.reduce((s, it) => s + it.photos.length, 0);
        return (
          <div
            key={ri}
            className="cd mb"
            style={{ cursor: "pointer" }}
            onClick={() => { setCurrentRoomIdx(ri); setStep("inspect"); }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <b style={{ fontSize: 15 }}>{room.name}</b>
                <div className="dim" style={{ fontSize: 13 }}>
                  {issues.length} issue{issues.length !== 1 ? "s" : ""}
                  {room.sqft > 0 && ` · ${room.sqft} sqft`}
                  {roomPhotos > 0 && ` · ${roomPhotos} photo${roomPhotos !== 1 ? "s" : ""}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 3 }}>
                {issues.map((it, i) => (
                  <span
                    key={i}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: CONDITIONS.find((c) => c.code === it.condition)?.color || "#888",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}

      {/* Generate / Save button — sticky above the bottom nav so it never
          gets covered when the room list at the top of review scrolls
          long. Edit mode allows saving with zero findings (Bernard might
          mark all rooms OK after a re-walk) so the disabled gate only
          applies to fresh inspections. */}
      <div className="sb">
        <button
          className="bb"
          onClick={handleGenerate}
          disabled={!isEditing && findingsCount === 0}
          style={{
            width: "100%",
            padding: 14,
            fontSize: 18,
            background: !isEditing && findingsCount === 0 ? "#333" : "var(--color-primary)",
            opacity: !isEditing && findingsCount === 0 ? 0.5 : 1,
          }}
        >
          {isEditing
            ? `💾 Save Changes (${findingsCount} finding${findingsCount === 1 ? "" : "s"})`
            : `🤖 Generate Quote (${findingsCount} findings)`}
        </button>
        {!isEditing && findingsCount === 0 && (
          <p className="dim" style={{ fontSize: 15, textAlign: "center", marginTop: 6 }}>
            Mark at least one item as Fair, Poor, or Damaged to generate a quote
          </p>
        )}
      </div>
    </div>
  );
}
