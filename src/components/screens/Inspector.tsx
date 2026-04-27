"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/lib/store";
import CustomerPicker from "../CustomerPicker";
import { Icon } from "../Icon";
import VoiceWalk, { type VoiceWalkResult, type VoiceWalkRoomStatus } from "../VoiceWalk";
import { aiParseVoiceWalkRoom } from "@/lib/parser";

/* ── Preset rooms and items ── */
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
    return ["Patch", "Replace plank", "Re-grout", "Refinish", "Deep clean"];
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
    return ["Re-seal", "Polish", "Replace section"];
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
}

interface Props {
  onComplete: (data: InspectionData) => void;
  onCancel: () => void;
  darkMode: boolean;
}

type Step = "rooms" | "inspect" | "review";

export default function Inspector({ onComplete, onCancel, darkMode }: Props) {
  // Load saved state from localStorage
  const loadSaved = <T,>(key: string, fallback: T): T => {
    try {
      const v = localStorage.getItem("c_inspect_" + key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  };

  const [step, setStep] = useState<Step>(() => loadSaved("step", "rooms" as Step));
  const [selectedRooms, setSelectedRooms] = useState<string[]>(() => loadSaved("rooms", []));
  const [customRoom, setCustomRoom] = useState("");
  const [property, setProperty] = useState(() => loadSaved("property", ""));
  const [client, setClient] = useState(() => loadSaved("client", ""));
  const [customerId, setCustomerId] = useState<string | undefined>(
    () => loadSaved<string | undefined>("customerId", undefined)
  );
  const [addressId, setAddressId] = useState<string | undefined>(
    () => loadSaved<string | undefined>("addressId", undefined)
  );
  const [currentRoomIdx, setCurrentRoomIdx] = useState(() => loadSaved("roomIdx", 0));
  const [roomData, setRoomData] = useState<InspectionRoom[]>(() => loadSaved("roomData", []));
  // uploading state replaced by uploadCount for non-blocking batch uploads
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoTarget, setPhotoTarget] = useState<{ room: number; item: number } | null>(null);
  const [showResume, setShowResume] = useState(() => !!localStorage.getItem("c_inspect_roomData"));
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

  // Auto-save to localStorage on every change
  const save = useCallback((key: string, value: unknown) => {
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
  }, []);

  useEffect(() => save("step", step), [step, save]);
  useEffect(() => save("rooms", selectedRooms), [selectedRooms, save]);
  useEffect(() => save("property", property), [property, save]);
  useEffect(() => save("client", client), [client, save]);
  useEffect(() => save("customerId", customerId), [customerId, save]);
  useEffect(() => save("addressId", addressId), [addressId, save]);
  useEffect(() => save("roomIdx", currentRoomIdx), [currentRoomIdx, save]);
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
          const res = await fetch("/api/transcribe", { method: "POST", body: fd });
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

      // AI categorization
      const checklist = ROOM_PRESETS[roomName] || (() => {
        const baseKey = Object.keys(ROOM_PRESETS).find((k) => roomName.startsWith(k.replace(/ \d+$/, "")));
        return baseKey ? ROOM_PRESETS[baseKey] : [];
      })();
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
          const userEditedNames = new Set(
            r.items.filter(isUserEdited).map((it) => it.name.toLowerCase())
          );
          const kept = r.items.filter(isUserEdited);
          const newAi = items.filter((it) => !userEditedNames.has(it.name.toLowerCase()));
          return { ...r, items: [...kept, ...newAi] };
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
    const data = selectedRooms.map((room) => {
      const presetKey = Object.keys(ROOM_PRESETS).find(
        (k) => k === room || room.startsWith(k.replace(/ \d+$/, ""))
      );
      const items = (presetKey ? ROOM_PRESETS[presetKey] : ["General"]).map(
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
    if (!files?.length || !photoTarget) return;
    // Upload all files concurrently
    Array.from(files).forEach((file) => {
      uploadPhoto(file, photoTarget.room, photoTarget.item);
    });
    if (cameraRef.current) cameraRef.current.value = "";
    if (fileRef.current) fileRef.current.value = "";
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
    clearSaved();
    onComplete({
      rooms: roomData,
      property,
      client,
      customer_id: customerId,
      address_id: addressId,
    });
  };

  /* ═══════════════════════════════════
     ROOM SELECTION
     ═══════════════════════════════════ */
  if (step === "rooms") {
    return (
      <div className="fi">
        <div className="row mb">
          <button className="bo" onClick={() => { clearSaved(); onCancel(); }}>←</button>
          <h2 style={{ fontSize: 18, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="search" size={18} color="var(--color-primary)" />New Inspection
          </h2>
        </div>

        {/* Resume banner */}
        {showResume && roomData.length > 0 && (
          <div
            className="cd mb"
            style={{
              borderLeft: "3px solid var(--color-warning)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <b style={{ fontSize: 13 }}>Resume inspection?</b>
              <div className="dim" style={{ fontSize: 11 }}>
                {property || "Untitled"} · {roomData.length} areas
              </div>
            </div>
            <div className="row">
              <button
                className="bb"
                onClick={() => { setStep(roomData.length ? "inspect" : "rooms"); setShowResume(false); }}
                style={{ fontSize: 12, padding: "5px 12px" }}
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
                style={{ fontSize: 12, padding: "5px 10px", color: "var(--color-accent-red)" }}
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

        {/* Room checklist */}
        <div className="cd mb">
          <h4 style={{ fontSize: 13, marginBottom: 8 }}>Select Areas to Inspect</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {ROOM_ORDER.map((room) => {
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
                    fontSize: 12,
                    background: checked ? "var(--color-primary)" + "22" : "transparent",
                    border: `1px solid ${checked ? "var(--color-primary)" : border}`,
                  }}
                >
                  <span style={{ color: checked ? "var(--color-primary)" : "#888", fontSize: 14 }}>
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
              style={{ flex: 1, fontSize: 12 }}
              onKeyDown={(e) => e.key === "Enter" && addCustomRoom()}
            />
            <button className="bo" onClick={addCustomRoom} style={{ fontSize: 12, padding: "5px 10px" }}>
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
                  fontSize: 13,
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
            fontSize: 15,
            opacity: !selectedRooms.length || !property ? 0.5 : 1,
          }}
        >
          Start Inspection ({selectedRooms.length} areas) →
        </button>
        <p className="dim" style={{ fontSize: 11, textAlign: "center", marginTop: 6 }}>
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
        );
      }
    }

    return (
      <div className="fi">
        {/* Hidden file inputs — one for camera, one for gallery/files */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={handlePhotoSelect}
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
            <button className="bo" onClick={() => setStep("rooms")} style={{ fontSize: 12, padding: "4px 8px" }}>←</button>
            <h2 style={{ fontSize: 18, color: "var(--color-primary)" }}>{room.name}</h2>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {/* Per-room voice walk: tap to open a one-continuous-recording
                + camera + checklist panel for THIS room. AI fills the
                checklist with conditions and notes when you tap Done. */}
            <button
              onClick={() => setVoiceRoomIdx(currentRoomIdx)}
              title="Voice walk this room"
              style={{
                background: "var(--color-success)",
                color: "#fff",
                border: "none",
                borderRadius: 16,
                padding: "5px 12px",
                fontSize: 13,
                fontFamily: "Oswald",
                letterSpacing: ".04em",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Icon name="mic" size={14} color="#fff" strokeWidth={2.25} />
              Voice
            </button>
            <span className="dim" style={{ fontSize: 13, fontFamily: "Oswald" }}>
              {currentRoomIdx + 1} / {roomData.length}
            </span>
          </div>
        </div>

        {/* Upload indicator */}
        {uploadCount > 0 && (
          <div style={{ fontSize: 12, color: "var(--color-primary)", textAlign: "center", marginBottom: 6 }}>
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
                  padding: "4px 8px", borderRadius: 6, fontSize: 11, whiteSpace: "nowrap",
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

        {/* Room size */}
        <div className="cd" style={{ marginBottom: 8, padding: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="calc" size={14} color="var(--color-primary)" />
          <div style={{ flex: 1 }}>
            <label className="sl">Area Size (sq ft)</label>
            <input
              type="number"
              value={room.sqft || ""}
              placeholder="e.g. 120"
              min="0"
              style={{ marginTop: 2, fontSize: 13 }}
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 0;
                setRoomData((prev) =>
                  prev.map((r, ri) => ri === currentRoomIdx ? { ...r, sqft: val } : r)
                );
              }}
            />
          </div>
          {room.sqft > 0 && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 16, fontFamily: "Oswald", color: "var(--color-primary)" }}>{room.sqft}</div>
              <div className="dim" style={{ fontSize: 8 }}>sq ft</div>
            </div>
          )}
        </div>

        {/* Items */}
        {room.items.map((item, itemIdx) => (
          <div
            key={itemIdx}
            className="cd"
            style={{
              marginBottom: 6,
              padding: 10,
              borderLeft: `3px solid ${CONDITIONS.find((c) => c.code === item.condition)?.color || "#888"}`,
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
                  fontSize: 13,
                  padding: 0,
                  width: "auto",
                  flex: 1,
                }}
              />
              {/* Photo buttons */}
              <div style={{ display: "flex", gap: 2 }}>
                <button
                  onClick={() => {
                    setPhotoTarget({ room: currentRoomIdx, item: itemIdx });
                    cameraRef.current?.click();
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
                    setPhotoTarget({ room: currentRoomIdx, item: itemIdx });
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
                  <span style={{ fontSize: 13, color: "var(--color-success)", alignSelf: "center" }}>
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
                    fontSize: 12,
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
                      const current = item.notes;
                      const updated = current ? `${current}. ${preset}` : preset;
                      updateItem(currentRoomIdx, itemIdx, "notes", updated);
                    }}
                    style={{
                      fontSize: 11, padding: "2px 6px", borderRadius: 4,
                      background: "transparent", border: `1px solid ${border}`,
                      color: item.notes?.includes(preset) ? "var(--color-primary)" : "#888",
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
                style={{ fontSize: 12 }}
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
                        fontSize: 13,
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
          style={{ fontSize: 12, padding: "5px 12px", marginBottom: 12 }}
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
              style={{ flex: 1, padding: 10, fontSize: 13 }}
            >
              ← {roomData[currentRoomIdx - 1]?.name}
            </button>
          )}
          {currentRoomIdx < roomData.length - 1 ? (
            <button
              className="bb"
              onClick={() => setCurrentRoomIdx((prev) => prev + 1)}
              style={{ flex: 1, padding: 10, fontSize: 13 }}
            >
              {roomData[currentRoomIdx + 1]?.name} →
            </button>
          ) : (
            <button
              className="bg"
              onClick={() => setStep("review")}
              style={{ flex: 1, padding: 10, fontSize: 13 }}
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
        <button className="bo" onClick={() => setStep("inspect")} style={{ fontSize: 12, padding: "4px 8px" }}>← Edit</button>
        <h2 style={{ fontSize: 18, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="search" size={18} color="var(--color-primary)" />Inspection Review
        </h2>
      </div>

      {/* Property */}
      <div className="cd mb">
        <div style={{ fontSize: 13 }}>
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
                <b style={{ fontSize: 13 }}>{room.name}</b>
                <div className="dim" style={{ fontSize: 11 }}>
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

      {/* Generate button — sticky above the bottom nav so it never gets
          covered when the room list at the top of review scrolls long. */}
      <div className="sb">
        <button
          className="bb"
          onClick={handleGenerate}
          disabled={findingsCount === 0}
          style={{
            width: "100%",
            padding: 14,
            fontSize: 16,
            background: findingsCount === 0 ? "#333" : "var(--color-primary)",
            opacity: findingsCount === 0 ? 0.5 : 1,
          }}
        >
          🤖 Generate Quote ({findingsCount} findings)
        </button>
        {findingsCount === 0 && (
          <p className="dim" style={{ fontSize: 13, textAlign: "center", marginTop: 6 }}>
            Mark at least one item as Fair, Poor, or Damaged to generate a quote
          </p>
        )}
      </div>
    </div>
  );
}
