"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/lib/store";
import { aiParseVoiceWalk } from "@/lib/parser";
import { ROOM_PRESETS } from "./screens/Inspector";
import type { InspectionRoom } from "./screens/Inspector";

/* ── Keyword expansion for the per-room checklist ──────────────────── */
// For most preset items the item name itself yields decent keywords (split on
// "/", strip trailing "s" so "Doors" matches "door"). Overrides cover items
// where common spoken language doesn't include the preset name verbatim.
const ITEM_KEYWORD_OVERRIDES: Record<string, string[]> = {
  Caulking: ["caulk", "caulking", "sealant", "seal"],
  Appliances: ["appliance", "stove", "oven", "fridge", "refrigerator", "dishwasher", "microwave", "range"],
  "Electrical/Lights": ["outlet", "switch", "light", "bulb", "fixture", "wiring", "electrical"],
  Counters: ["counter", "countertop", "counter top"],
  "Walls/Ceiling": ["wall", "ceiling", "drywall"],
  "Windows/Blinds": ["window", "blind", "curtain", "screen"],
  "Door/Lock": ["door", "lock", "handle", "knob", "deadbolt"],
  "Door/Opener": ["door", "garage door", "opener"],
  "Mirror/Medicine Cabinet": ["mirror", "medicine"],
  "Towel Bar/TP Holder": ["towel", "tp holder", "toilet paper", "paper holder"],
  "Exhaust Fan": ["exhaust", "fan", "vent fan"],
  "Tub/Shower": ["tub", "shower", "bath"],
  "Sink/Vanity": ["sink", "vanity", "faucet"],
  "Sink/Faucet": ["sink", "faucet", "tap", "aerator"],
  Connections: ["connection", "hookup", "hose"],
  Venting: ["vent", "venting", "duct"],
  Closet: ["closet"],
  Doorbell: ["doorbell", "bell", "chime"],
  Railings: ["rail", "railing", "banister", "handrail"],
  Baseboards: ["baseboard", "trim"],
  "Exterior Door": ["exterior door", "back door", "side door"],
  Siding: ["siding", "stucco"],
  "Gutters/Downspouts": ["gutter", "downspout"],
  "Porch/Deck": ["porch", "deck", "patio"],
  Landscaping: ["landscape", "yard", "grass", "tree", "shrub", "bush", "weed"],
  "Exterior Lights": ["exterior light", "outdoor light", "porch light", "flood light"],
  Fencing: ["fence", "fencing", "gate"],
  "HVAC Unit": ["hvac", "ac unit", "air conditioner", "condenser", "heat pump"],
  "HVAC System": ["hvac", "furnace", "air conditioner", "heating"],
  "Water Heater": ["water heater", "hot water"],
  "Air Filter": ["air filter", "filter"],
  "Condenser Unit": ["condenser", "ac unit"],
  "Breaker Panel": ["breaker", "panel", "electrical panel"],
  "Smoke/CO Detectors": ["smoke", "co detector", "carbon monoxide", "alarm", "detector"],
  "Fire Extinguisher": ["fire extinguisher", "extinguisher"],
  Thermostat: ["thermostat"],
  "GFCI Outlets": ["gfci", "ground fault"],
  Toilet: ["toilet", "commode"],
};

function itemKeywords(itemName: string): string[] {
  const override = ITEM_KEYWORD_OVERRIDES[itemName];
  if (override) return override.map((s) => s.toLowerCase());
  // Default: split on "/" and ",", lowercase, strip trailing "s".
  return itemName
    .toLowerCase()
    .split(/[/,]/)
    .map((p) => p.trim().replace(/s$/, ""))
    .filter((p) => p.length >= 3);
}

/** Look up the preset checklist for a room, accommodating numbered variants
 * like "Bedroom 5" that fall back to the base "Bedroom 1" preset. */
function presetItemsFor(room: string): string[] {
  const exact = ROOM_PRESETS[room];
  if (exact) return exact;
  const baseKey = Object.keys(ROOM_PRESETS).find(
    (k) => room.startsWith(k.replace(/ \d+$/, ""))
  );
  return baseKey ? ROOM_PRESETS[baseKey] : [];
}

/* ── Web Speech API typing — narrow declarations so we don't pull in the
   full DOM lib type for every browser variant. ──────────────────────── */
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: { transcript: string };
    };
  };
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/* ── Component ─────────────────────────────────────────────────────── */

export interface VoiceMoment {
  id: string;
  photoUrl: string;
  transcript: string;
  room: string | null;
  ts: number;
}

interface Props {
  property: string;
  client: string;
  rooms: string[]; // Pre-selected room list from the start screen
  onComplete: (data: InspectionRoom[]) => void;
  onCancel: () => void;
  darkMode: boolean;
}

export default function VoiceWalk({ property, client, rooms, onComplete, onCancel, darkMode }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const recogShouldRunRef = useRef(false);
  const transcriptChunkRef = useRef("");

  const [supported] = useState<boolean>(() => !!getSpeechRecognition());
  const [recording, setRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState(""); // updated as the user speaks
  const [currentRoom, setCurrentRoom] = useState<string | null>(rooms[0] || null);
  const [moments, setMoments] = useState<VoiceMoment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [pendingTranscript, setPendingTranscript] = useState(""); // for the manual-text fallback
  const [processing, setProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState("");
  // Items the user has mentioned (or manually checked) per room. The
  // checklist below the chip strip auto-checks an item the moment its
  // keywords appear in the transcript, giving the user a visual "have I
  // covered everything?" reminder while they walk.
  const [mentioned, setMentioned] = useState<Record<string, Set<string>>>({});
  // Per-room transcript accumulator: only checks against the words spoken
  // since the user entered that room, so leftover speech from a previous
  // room can't accidentally check items in the new one.
  const roomTranscriptRef = useRef<Record<string, string>>({});
  // currentRoomRef mirrors currentRoom so the speech-recognition closure
  // (set up once) can read the latest room without restarting recognition.
  const currentRoomRef = useRef<string | null>(currentRoom);
  useEffect(() => { currentRoomRef.current = currentRoom; }, [currentRoom]);
  // Tick state forces the auto-check useEffect to re-run when finalized
  // speech is appended to a room's transcript ref (refs don't trigger
  // re-renders on their own).
  const [roomTranscriptTick, setRoomTranscriptTick] = useState(0);

  const border = darkMode ? "#1e1e2e" : "#eee";

  /* ── Speech recognition lifecycle ───────────────────────────────── */
  const startRecognition = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    if (recogRef.current) {
      try { recogRef.current.abort(); } catch { /* */ }
    }
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0]?.transcript || "";
        if (result.isFinal) final += text + " ";
        else interim += text;
      }
      if (final) {
        transcriptChunkRef.current += final;
        // Append finalized speech to the current room's running transcript
        // so the auto-check effect re-runs against the up-to-date text.
        const room = currentRoomRef.current;
        if (room) {
          roomTranscriptRef.current[room] = (roomTranscriptRef.current[room] || "") + final;
          setRoomTranscriptTick((t) => t + 1);
        }
      }
      setLiveTranscript(transcriptChunkRef.current + interim);
    };
    r.onend = () => {
      // Auto-restart if we should still be listening (browsers stop after a
      // long pause — restart silently so the walk continues).
      if (recogShouldRunRef.current) {
        try { r.start(); } catch { /* already running */ }
      }
    };
    r.onerror = (ev) => {
      // "no-speech" and "aborted" are noise; everything else worth surfacing.
      if (ev.error && ev.error !== "no-speech" && ev.error !== "aborted") {
        console.warn("SpeechRecognition error:", ev.error);
      }
    };
    recogRef.current = r;
    recogShouldRunRef.current = true;
    try { r.start(); } catch { /* already running */ }
  }, []);

  const stopRecognition = useCallback(() => {
    recogShouldRunRef.current = false;
    try { recogRef.current?.stop(); } catch { /* */ }
  }, []);

  // Toggle on/off with the recording switch.
  useEffect(() => {
    if (recording && supported) startRecognition();
    else stopRecognition();
    return () => { stopRecognition(); };
  }, [recording, supported, startRecognition, stopRecognition]);

  /* ── Auto-check items as they're mentioned in transcript ────────── */
  // Sweep the current room's running transcript on each finalized chunk
  // (or each keystroke in the no-speech-API fallback) and add any preset
  // items whose keywords appear to mentioned[room]. Idempotent: items
  // don't un-check from this effect, and manual taps below merge in.
  useEffect(() => {
    if (!currentRoom) return;
    const speechText = (roomTranscriptRef.current[currentRoom] || "").toLowerCase();
    const fallbackText = supported ? "" : pendingTranscript.toLowerCase();
    const text = `${speechText} ${fallbackText}`.trim();
    if (!text) return;
    const items = presetItemsFor(currentRoom);
    const found: string[] = [];
    const already = mentioned[currentRoom] || new Set<string>();
    for (const item of items) {
      if (already.has(item)) continue;
      const keywords = itemKeywords(item);
      if (keywords.some((k) => text.includes(k))) found.push(item);
    }
    if (found.length === 0) return;
    setMentioned((prev) => {
      const next = new Set(prev[currentRoom] || []);
      for (const f of found) next.add(f);
      return { ...prev, [currentRoom]: next };
    });
  }, [currentRoom, roomTranscriptTick, pendingTranscript, supported, mentioned]);

  // Manual toggle for an item — user tap on the checklist below.
  const toggleItem = (room: string, item: string) => {
    setMentioned((prev) => {
      const set = new Set(prev[room] || []);
      if (set.has(item)) set.delete(item);
      else set.add(item);
      return { ...prev, [room]: set };
    });
  };

  /* ── Photo capture ─────────────────────────────────────────────── */
  const compressFile = (file: File, maxSize = 1200): Promise<Blob> =>
    new Promise((resolve) => {
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

  const captureAndAttach = async (file: File) => {
    // Snap off the current transcript chunk now so subsequent speech goes to
    // the next photo. The fallback text input also feeds into the chunk.
    const chunk = (transcriptChunkRef.current + " " + liveTranscript + " " + pendingTranscript).trim();
    transcriptChunkRef.current = "";
    setLiveTranscript("");
    setPendingTranscript("");

    setUploading((c) => c + 1);
    try {
      const compressed = await compressFile(file);
      const path = `inspections/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
      const { error } = await supabase.storage.from("receipts").upload(path, compressed);
      if (error) throw error;
      const { data } = supabase.storage.from("receipts").getPublicUrl(path);
      setMoments((prev) => [
        ...prev,
        {
          id: crypto.randomUUID().slice(0, 8),
          photoUrl: data.publicUrl,
          transcript: chunk,
          room: currentRoom,
          ts: Date.now(),
        },
      ]);
    } catch (err) {
      console.error("Voice walk photo upload failed:", err);
      useStore.getState().showToast("Photo upload failed", "error");
    }
    setUploading((c) => c - 1);
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    for (const f of Array.from(files)) await captureAndAttach(f);
    if (cameraRef.current) cameraRef.current.value = "";
  };

  // Restart recognition after the camera modal closes — iOS Safari pauses
  // it when the file picker takes over the screen.
  useEffect(() => {
    const onFocus = () => {
      if (recording && supported && recogShouldRunRef.current) {
        try { recogRef.current?.start(); } catch { /* already running */ }
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [recording, supported]);

  /* ── Edit / delete moments ──────────────────────────────────────── */
  const updateMoment = (id: string, patch: Partial<VoiceMoment>) =>
    setMoments((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const removeMoment = (id: string) =>
    setMoments((prev) => prev.filter((m) => m.id !== id));

  /* ── Send to AI for structuring ──────────────────────────────── */
  const finish = async () => {
    if (moments.length === 0) {
      useStore.getState().showToast("Capture at least one photo first", "warning");
      return;
    }
    stopRecognition();
    setRecording(false);
    setProcessing(true);
    setProcessStatus("Structuring your inspection...");
    try {
      const result = await aiParseVoiceWalk(moments, property, client, setProcessStatus);
      if (result && result.length > 0) {
        onComplete(result);
        return;
      }
      // AI returned nothing — fall back to a passthrough that keeps the user's
      // captured data instead of dropping it.
      useStore.getState().showToast("AI didn't structure the walk — using raw moments", "warning");
      onComplete(buildFallbackRooms(moments, rooms));
    } catch (err) {
      console.error("Voice walk AI failed:", err);
      useStore.getState().showToast("AI processing failed — using raw moments", "warning");
      onComplete(buildFallbackRooms(moments, rooms));
    } finally {
      setProcessing(false);
    }
  };

  /* ── Render ────────────────────────────────────────────────────── */
  if (processing) {
    return (
      <div className="fi" style={{ textAlign: "center", padding: "40px 20px" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🤖</div>
        <h3 style={{ color: "var(--color-primary)", fontSize: 16, marginBottom: 8 }}>
          {processStatus || "Processing..."}
        </h3>
        <p className="dim" style={{ fontSize: 12 }}>
          {moments.length} moment{moments.length === 1 ? "" : "s"} captured
        </p>
      </div>
    );
  }

  return (
    <div className="fi">
      {/* Hidden camera input */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={handlePhotoSelect}
      />

      {/* Header */}
      <div className="row mb" style={{ justifyContent: "space-between" }}>
        <button className="bo" onClick={onCancel} style={{ fontSize: 12, padding: "4px 8px" }}>← Cancel</button>
        <h2 style={{ fontSize: 18, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span>🎤</span> Voice Walk
        </h2>
        <span className="dim" style={{ fontSize: 11 }}>
          {moments.length} photo{moments.length === 1 ? "" : "s"}
        </span>
      </div>

      {!supported && (
        <div
          className="cd mb"
          style={{ borderLeft: "3px solid var(--color-warning)", fontSize: 12 }}
        >
          <b style={{ color: "var(--color-warning)" }}>Voice not available</b>
          <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
            This browser doesn&apos;t support speech recognition (try Chrome on Android, or Safari on iOS 14.5+).
            You can still take photos and type a description for each.
          </div>
        </div>
      )}

      {/* Current-room chip strip + checklist */}
      <div className="cd mb" style={{ padding: 10 }}>
        <div className="dim" style={{ fontSize: 11, marginBottom: 6, fontFamily: "Oswald", letterSpacing: ".06em" }}>
          CURRENT AREA
        </div>
        <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 2 }}>
          {rooms.map((r) => {
            const active = r === currentRoom;
            const total = presetItemsFor(r).length;
            const checked = mentioned[r]?.size || 0;
            return (
              <button
                key={r}
                onClick={() => setCurrentRoom(r)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 14,
                  fontSize: 12,
                  whiteSpace: "nowrap",
                  background: active ? "var(--color-primary)" : "transparent",
                  color: active ? "#fff" : "var(--color-primary)",
                  border: `1px solid var(--color-primary)`,
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>{r}</span>
                {total > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: "Oswald",
                      opacity: 0.85,
                      background: active ? "rgba(255,255,255,0.18)" : "rgba(46,117,182,0.12)",
                      padding: "1px 5px",
                      borderRadius: 8,
                    }}
                  >
                    {checked}/{total}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Per-room checklist — auto-checks as items get mentioned, tap to
            toggle manually. Items the user already checked off get a green
            tick; everything else stays unchecked so it's obvious what's
            still left to inspect in this area. */}
        {currentRoom && (() => {
          const items = presetItemsFor(currentRoom);
          if (items.length === 0) return null;
          const set = mentioned[currentRoom] || new Set<string>();
          return (
            <div style={{ marginTop: 8 }}>
              <div className="dim" style={{ fontSize: 10, marginBottom: 4, fontFamily: "Oswald", letterSpacing: ".06em" }}>
                AREAS OF CONCERN — {currentRoom.toUpperCase()} ({set.size}/{items.length})
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {items.map((item) => {
                  const isChecked = set.has(item);
                  return (
                    <button
                      key={item}
                      onClick={() => toggleItem(currentRoom, item)}
                      style={{
                        padding: "3px 8px",
                        borderRadius: 12,
                        fontSize: 11,
                        background: isChecked ? "var(--color-success)" : "transparent",
                        color: isChecked ? "#fff" : "#888",
                        border: `1px solid ${isChecked ? "var(--color-success)" : darkMode ? "#1e1e2e" : "#ddd"}`,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isChecked ? "✓ " : "○ "}{item}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Recording + camera controls */}
      <div className="cd mb" style={{ textAlign: "center" }}>
        {supported && (
          <div style={{ marginBottom: 8 }}>
            <button
              onClick={() => setRecording((r) => !r)}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontFamily: "Oswald",
                background: recording ? "var(--color-accent-red)" : "var(--color-success)",
                color: "#fff",
                borderRadius: 20,
                border: "none",
                animation: recording ? "pulse 1.5s ease-in-out infinite" : "none",
              }}
            >
              {recording ? "● Recording — Tap to pause" : "🎤 Start Recording"}
            </button>
            <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }`}</style>
          </div>
        )}

        {/* Live transcript / fallback text input */}
        <div
          style={{
            background: darkMode ? "#0d0d14" : "#f7f7fa",
            border: `1px dashed ${border}`,
            borderRadius: 8,
            padding: 10,
            minHeight: 70,
            fontSize: 13,
            textAlign: "left",
            color: liveTranscript ? "inherit" : "#888",
            marginBottom: 10,
          }}
        >
          {supported ? (
            liveTranscript || (recording
              ? "Listening… describe what you see."
              : "Tap Start Recording, then describe what you're looking at.")
          ) : (
            <textarea
              value={pendingTranscript}
              onChange={(e) => setPendingTranscript(e.target.value)}
              placeholder="Type a description for the next photo..."
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                resize: "vertical",
                minHeight: 60,
                fontSize: 13,
                color: "inherit",
              }}
            />
          )}
        </div>

        {/* Big camera button */}
        <button
          onClick={() => cameraRef.current?.click()}
          disabled={!currentRoom}
          style={{
            width: "100%",
            padding: "14px 16px",
            fontSize: 16,
            fontFamily: "Oswald",
            background: currentRoom ? "var(--color-primary)" : "#888",
            color: "#fff",
            borderRadius: 10,
            border: "none",
            opacity: currentRoom ? 1 : 0.5,
          }}
        >
          📸 Capture &amp; Attach to {currentRoom || "—"}
        </button>
        {uploading > 0 && (
          <div style={{ fontSize: 11, color: "var(--color-primary)", marginTop: 4 }}>
            Uploading {uploading} photo{uploading === 1 ? "" : "s"}…
          </div>
        )}
      </div>

      {/* Captured moments */}
      {moments.length > 0 && (
        <div className="cd mb">
          <h4 style={{ fontSize: 13, marginBottom: 6 }}>
            Captured Moments ({moments.length})
          </h4>
          {moments.map((m, idx) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                gap: 8,
                padding: "6px 0",
                borderBottom: idx === moments.length - 1 ? "none" : `1px solid ${border}`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={m.photoUrl}
                alt=""
                style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 4, marginBottom: 2 }}>
                  <select
                    value={m.room || ""}
                    onChange={(e) => updateMoment(m.id, { room: e.target.value || null })}
                    style={{ fontSize: 11, padding: "1px 4px", color: "var(--color-primary)", fontWeight: 600 }}
                  >
                    <option value="">— Area —</option>
                    {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button
                    onClick={() => removeMoment(m.id)}
                    style={{ marginLeft: "auto", background: "none", color: "var(--color-accent-red)", fontSize: 11, padding: 0 }}
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  value={m.transcript}
                  onChange={(e) => updateMoment(m.id, { transcript: e.target.value })}
                  placeholder="Description (edit if needed)"
                  style={{
                    width: "100%",
                    fontSize: 12,
                    padding: 4,
                    minHeight: 36,
                    resize: "vertical",
                    background: "transparent",
                    border: `1px solid ${border}`,
                    borderRadius: 4,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Finish */}
      <button
        className="bb"
        onClick={finish}
        disabled={moments.length === 0 || uploading > 0}
        style={{
          width: "100%",
          padding: 12,
          fontSize: 15,
          opacity: moments.length === 0 || uploading > 0 ? 0.5 : 1,
        }}
      >
        Done — Build Inspection ({moments.length})
      </button>
    </div>
  );
}

/** Fallback when AI fails: drop each moment as a single item per its room. */
function buildFallbackRooms(moments: VoiceMoment[], roomList: string[]): InspectionRoom[] {
  const byRoom: Record<string, InspectionRoom> = {};
  for (const r of roomList) {
    byRoom[r] = { name: r, sqft: 0, items: [] };
  }
  moments.forEach((m, i) => {
    const room = m.room || roomList[0] || "General";
    if (!byRoom[room]) byRoom[room] = { name: room, sqft: 0, items: [] };
    byRoom[room].items.push({
      name: `Voice note ${i + 1}`,
      condition: "F",
      notes: m.transcript || "(no description)",
      photos: [m.photoUrl],
    });
  });
  return Object.values(byRoom).filter((r) => r.items.length > 0);
}
