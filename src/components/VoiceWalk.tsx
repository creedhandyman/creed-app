"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/lib/store";
import { aiParseVoiceWalkRoom } from "@/lib/parser";
import { ROOM_PRESETS } from "./screens/Inspector";
import type { InspectionRoom, InspectionItem } from "./screens/Inspector";

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

/* ── Keyword expansion for the per-room checklist ──────────────────── */
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
  return itemName
    .toLowerCase()
    .split(/[/,]/)
    .map((p) => p.trim().replace(/s$/, ""))
    .filter((p) => p.length >= 3);
}

function presetItemsFor(room: string): string[] {
  const exact = ROOM_PRESETS[room];
  if (exact) return exact;
  const baseKey = Object.keys(ROOM_PRESETS).find(
    (k) => room.startsWith(k.replace(/ \d+$/, ""))
  );
  return baseKey ? ROOM_PRESETS[baseKey] : [];
}

/* ── Component ─────────────────────────────────────────────────────── */

export interface VoiceMoment {
  id: string;
  photoUrl: string;
  transcript: string;
  ts: number;
}

type RoomStatus = "pending" | "analyzing" | "done" | "failed";

interface Props {
  property: string;
  client: string;
  rooms: string[];
  onComplete: (data: InspectionRoom[]) => void;
  onCancel: () => void;
  darkMode: boolean;
}

export default function VoiceWalk({ property, client, rooms, onComplete, onCancel, darkMode }: Props) {
  // Refs that survive renders
  const fileFallbackRef = useRef<HTMLInputElement>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const recogShouldRunRef = useRef(false);
  // Restart bookkeeping. Each new SpeechRecognition session triggers the
  // OS "mic on" chime (especially on iOS / accessibility-enabled Android),
  // so we want to avoid rapid-fire restarts. We track the session's start
  // time and whether it produced any speech; sessions that die fast and
  // empty get exponentially-backed-off restarts.
  const sessionStartRef = useRef(0);
  const sessionGotResultRef = useRef(false);
  const restartFailuresRef = useRef(0);
  const restartTimerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Speech support detection
  const [supported] = useState<boolean>(() => !!getSpeechRecognition());
  // Single inspecting toggle — drives mic AND camera together. Off by
  // default so the user lands on each room with everything quiet, taps
  // Start when ready, taps Stop when done.
  const [inspecting, setInspecting] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [pendingTranscript, setPendingTranscript] = useState(""); // typed-fallback buffer
  // Per-room transcript chunk that's "owned" by the next photo capture.
  const captureChunkRef = useRef("");

  // Per-room transcripts for auto-checking (everything ever spoken in that room).
  const roomTranscriptRef = useRef<Record<string, string>>({});
  const [roomTranscriptTick, setRoomTranscriptTick] = useState(0);

  // Per-room state
  const [currentIdx, setCurrentIdx] = useState(0);
  const [roomMoments, setRoomMoments] = useState<Record<string, VoiceMoment[]>>({});
  const [roomItems, setRoomItems] = useState<Record<string, InspectionItem[]>>({});
  const [roomStatus, setRoomStatus] = useState<Record<string, RoomStatus>>({});
  // Mirror of roomStatus so async code (the finish-poll loop, the
  // fireRoomAi early-skip check) reads the latest value without stale
  // closures. Always updated in tandem with setRoomStatus.
  const roomStatusRef = useRef<Record<string, RoomStatus>>({});
  const [mentioned, setMentioned] = useState<Record<string, Set<string>>>({});
  // Track how many moments were sent through AI most recently per room — so
  // we don't re-fire the same call when the user revisits a "done" room
  // without adding new photos.
  const roomLastProcessedRef = useRef<Record<string, number>>({});

  // Camera state
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  // Flash/torch — only available on the rear camera of supported mobile
  // browsers (most Android Chrome). track.getCapabilities() is unreliable
  // for detection — plenty of devices that flash fine don't list torch in
  // capabilities — so we render the button optimistically whenever the
  // camera is on, attempt applyConstraints when tapped, and hide the
  // button only after a failed attempt.
  const [torchAvailable, setTorchAvailable] = useState(true);
  const [torchOn, setTorchOn] = useState(false);

  // Final state
  const [finishing, setFinishing] = useState(false);
  const [finishStatus, setFinishStatus] = useState("");

  const currentRoom = rooms[currentIdx] || rooms[0] || null;
  const currentRoomRef = useRef<string | null>(currentRoom);
  useEffect(() => { currentRoomRef.current = currentRoom; }, [currentRoom]);

  const border = darkMode ? "#1e1e2e" : "#eee";

  /* ── Speech recognition lifecycle ───────────────────────────────── */
  // Hard-shutdown a recognizer: detach its handlers FIRST so its own
  // onend can't queue a self-restart, then abort/stop. Used both before
  // creating a new recognizer and from stopRecognition.
  const killRecognizer = (rec: SpeechRecognitionLike | null) => {
    if (!rec) return;
    try { (rec as unknown as { onstart: unknown }).onstart = null; } catch { /* */ }
    try { rec.onend = null; rec.onresult = null; rec.onerror = null; } catch { /* */ }
    try { rec.abort(); } catch { /* */ }
    try { rec.stop(); } catch { /* */ }
  };

  // Internal builder — actually constructs and starts a recognizer.
  // startRecognition wraps this with the "is one already running?" guard;
  // the onend handler calls scheduleRestart() to bring up a fresh one
  // with backoff so we don't machine-gun the OS mic-on chime.
  const buildAndStart = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    // Always tear down any previous instance before spawning a new one.
    killRecognizer(recogRef.current);
    recogRef.current = null;

    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    // Track whether this particular session actually produced any speech;
    // failed/empty sessions trigger backoff so we don't restart in a
    // tight loop and chime repeatedly.
    sessionStartRef.current = Date.now();
    sessionGotResultRef.current = false;
    (r as unknown as { onstart: (() => void) | null }).onstart = () => {
      sessionStartRef.current = Date.now();
    };
    r.onresult = (e) => {
      // Only the currently-active recognizer's events count. A
      // previously-aborted instance whose onresult fires one last time
      // would otherwise leak duplicate text into the transcript.
      if (recogRef.current !== r) return;
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0]?.transcript || "";
        if (result.isFinal) final += text + " ";
        else interim += text;
      }
      // Any result (even interim) means the session is healthy — reset
      // the failure counter so the next legitimate restart is fast.
      sessionGotResultRef.current = true;
      restartFailuresRef.current = 0;
      if (final) {
        captureChunkRef.current += final;
        const room = currentRoomRef.current;
        if (room) {
          roomTranscriptRef.current[room] = (roomTranscriptRef.current[room] || "") + final;
          setRoomTranscriptTick((t) => t + 1);
        }
      }
      setLiveTranscript(captureChunkRef.current + interim);
    };
    r.onend = () => {
      // Only the active recognizer is allowed to schedule a restart.
      // Stale instances (from a prior start/stop cycle) bail here so they
      // can't run in parallel with the current one.
      if (recogRef.current !== r) return;
      if (!recogShouldRunRef.current) return;
      // Decide how aggressively to back off based on this session's life.
      const lived = Date.now() - sessionStartRef.current;
      if (sessionGotResultRef.current || lived > 4000) {
        // Healthy session — engine ended on its own (iOS 60s cap, long
        // silence). Restart quickly; the chime is unavoidable but rare.
        restartFailuresRef.current = 0;
      } else {
        // Session died fast and empty (e.g. immediate no-speech, mic
        // permission flap, network blip). Back off so we don't chime on
        // top of chime.
        restartFailuresRef.current = Math.min(restartFailuresRef.current + 1, 5);
      }
      const delay =
        restartFailuresRef.current === 0
          ? 120
          : Math.min(2500, 400 * 2 ** (restartFailuresRef.current - 1));
      // Coalesce — only the most recent scheduled restart fires.
      if (restartTimerRef.current !== null) {
        clearTimeout(restartTimerRef.current);
      }
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null;
        if (!recogShouldRunRef.current) return;
        if (recogRef.current !== r) return;
        // Replace this dead instance with a fresh one (a new SR after end
        // is sometimes more reliable than calling .start() on the old).
        buildAndStart();
      }, delay);
    };
    r.onerror = (ev) => {
      if (ev.error && ev.error !== "no-speech" && ev.error !== "aborted") {
        console.warn("SpeechRecognition error:", ev.error);
      }
    };
    recogRef.current = r;
    try { r.start(); } catch { /* already running */ }
  }, []);

  const startRecognition = useCallback(() => {
    if (!getSpeechRecognition()) return;
    // If a recognizer is already alive for this session, don't spawn a
    // second one — that's the path that produced doubled transcripts.
    if (recogRef.current && recogShouldRunRef.current) return;
    recogShouldRunRef.current = true;
    restartFailuresRef.current = 0;
    buildAndStart();
  }, [buildAndStart]);

  const stopRecognition = useCallback(() => {
    recogShouldRunRef.current = false;
    if (restartTimerRef.current !== null) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    const prev = recogRef.current;
    recogRef.current = null;
    killRecognizer(prev);
  }, []);

  // The inspecting flag drives BOTH mic and camera below — see the unified
  // useEffect after the camera lifecycle helpers.

  /* ── Camera lifecycle ──────────────────────────────────────────── */
  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraOn(true);
      // Reset torch state for this camera session; availability is decided
      // optimistically (button visible) and only flipped to false if the
      // first toggle attempt fails.
      setTorchAvailable(true);
      setTorchOn(false);
    } catch (err) {
      console.warn("Camera unavailable:", err);
      setCameraError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Camera permission denied. Use the file picker below."
          : "Camera unavailable. Use the file picker below."
      );
      setCameraOn(false);
      setTorchAvailable(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    setTorchAvailable(true); // reset for next camera session
    setTorchOn(false);
  }, []);

  // Apply the torch constraint on toggle. The advanced[] array silently
  // ignores unsupported constraints rather than throwing, so we also check
  // the resulting track settings to confirm the toggle actually took effect.
  // Hide the button on a confirmed-no-op so the user gets honest feedback.
  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await (track.applyConstraints as (c: MediaTrackConstraints & { advanced?: Array<{ torch?: boolean }> }) => Promise<void>)({
        advanced: [{ torch: next }],
      });
      // Verify the constraint actually applied by reading back settings.
      const settings = track.getSettings?.() as undefined | MediaTrackSettings & { torch?: boolean };
      if (settings && "torch" in settings && settings.torch !== next) {
        // Apply was accepted but the device ignored it — torch isn't real here.
        setTorchAvailable(false);
        setTorchOn(false);
        useStore.getState().showToast("Flash not supported on this device", "info");
        return;
      }
      setTorchOn(next);
    } catch (err) {
      console.warn("Torch toggle failed:", err);
      setTorchAvailable(false);
      setTorchOn(false);
      useStore.getState().showToast("Flash not supported on this device", "info");
    }
  }, [torchOn]);

  // Unified inspecting toggle: when on, start mic (if supported) + camera.
  // When off, stop both. The user gets one obvious "▶ Start" / "■ Stop"
  // control instead of separate confusing affordances.
  useEffect(() => {
    if (inspecting) {
      if (supported) startRecognition();
      startCamera();
    } else {
      stopRecognition();
      stopCamera();
    }
    return () => { stopRecognition(); stopCamera(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspecting, supported]);

  // When the user moves to a different room, force-stop the active session
  // and clear the on-screen transcript so they don't see leftover speech
  // from the previous room. The per-room transcript ref + roomMoments stay
  // intact — those are the saved work, only the live UI clears.
  useEffect(() => {
    setInspecting(false);
    setLiveTranscript("");
    setPendingTranscript("");
    captureChunkRef.current = "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx]);

  /* ── Auto-check items on transcript ─────────────────────────────── */
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

  const toggleItem = (room: string, item: string) => {
    setMentioned((prev) => {
      const set = new Set(prev[room] || []);
      if (set.has(item)) set.delete(item);
      else set.add(item);
      return { ...prev, [room]: set };
    });
  };

  /* ── Photo capture ─────────────────────────────────────────────── */
  const compressBlob = (blob: Blob, maxSize = 1200): Promise<Blob> =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement("canvas");
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        canvas.toBlob((b) => resolve(b || blob), "image/jpeg", 0.7);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(blob); };
      img.src = url;
    });

  const attachMomentBlob = useCallback(async (blob: Blob) => {
    const room = currentRoomRef.current;
    if (!room) return;
    // Snap off the current transcript chunk.
    const chunk = (captureChunkRef.current + " " + liveTranscript + " " + pendingTranscript).trim();
    captureChunkRef.current = "";
    setLiveTranscript("");
    setPendingTranscript("");

    setUploading((c) => c + 1);
    try {
      const compressed = await compressBlob(blob);
      const path = `inspections/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
      const { error } = await supabase.storage.from("receipts").upload(path, compressed);
      if (error) throw error;
      const { data } = supabase.storage.from("receipts").getPublicUrl(path);
      setRoomMoments((prev) => ({
        ...prev,
        [room]: [
          ...(prev[room] || []),
          {
            id: crypto.randomUUID().slice(0, 8),
            photoUrl: data.publicUrl,
            transcript: chunk,
            ts: Date.now(),
          },
        ],
      }));
    } catch (err) {
      console.error("Voice walk photo upload failed:", err);
      useStore.getState().showToast("Photo upload failed", "error");
    }
    setUploading((c) => c - 1);
  }, [liveTranscript, pendingTranscript]);

  const snapFromVideo = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      useStore.getState().showToast("Camera not ready yet", "warning");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.85));
    if (!blob) return;
    await attachMomentBlob(blob);
  };

  const onFallbackFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    for (const f of Array.from(files)) await attachMomentBlob(f);
    if (fileFallbackRef.current) fileFallbackRef.current.value = "";
  };

  /* ── Per-room AI processing (background) ────────────────────────── */
  const fireRoomAi = useCallback(async (room: string) => {
    const moments = roomMoments[room] || [];
    if (moments.length === 0) return;
    // Skip if we've already processed exactly this set of moments.
    if (
      roomLastProcessedRef.current[room] === moments.length &&
      roomStatusRef.current[room] === "done"
    ) return;
    roomLastProcessedRef.current[room] = moments.length;
    setRoomStatus((prev) => ({ ...prev, [room]: "analyzing" }));
    roomStatusRef.current[room] = "analyzing";
    try {
      const items = await aiParseVoiceWalkRoom(
        room,
        moments.map((m) => ({ photoUrl: m.photoUrl, transcript: m.transcript, room })),
        property,
        client
      );
      setRoomItems((prev) => ({ ...prev, [room]: items }));
      setRoomStatus((prev) => ({ ...prev, [room]: "done" }));
      roomStatusRef.current[room] = "done";
    } catch (err) {
      console.error(`AI failed for room ${room}:`, err);
      setRoomStatus((prev) => ({ ...prev, [room]: "failed" }));
      roomStatusRef.current[room] = "failed";
    }
  }, [roomMoments, property, client]);

  const advanceRoom = () => {
    if (!currentRoom) return;
    // Fire AI for the room being left (if it has photos and isn't already
    // analyzed against this exact moment count).
    fireRoomAi(currentRoom);
    if (currentIdx < rooms.length - 1) {
      setCurrentIdx(currentIdx + 1);
    }
  };

  const finish = async () => {
    if (!currentRoom) return;
    setFinishing(true);

    // Fire AI for the current room first.
    setFinishStatus("Analyzing this room...");
    await fireRoomAi(currentRoom);

    // Wait for any rooms still analyzing to settle. Poll the ref (not the
    // captured state) so we see updates that happened after this function
    // started.
    setFinishStatus("Waiting for any background analysis to finish...");
    const stillAnalyzing = () =>
      Object.values(roomStatusRef.current).some((s) => s === "analyzing");
    let safety = 120; // 60 seconds max
    while (stillAnalyzing() && safety-- > 0) {
      await new Promise((res) => setTimeout(res, 500));
    }

    setFinishStatus("Building inspection...");
    // Build final InspectionRoom[] from accumulated items.
    const out: InspectionRoom[] = [];
    for (const room of rooms) {
      const items = roomItems[room];
      if (items && items.length > 0) {
        out.push({ name: room, sqft: 0, items });
        continue;
      }
      // Fall back to raw moments if AI didn't (or hasn't) produced items.
      const fallbackMoments = roomMoments[room] || [];
      if (fallbackMoments.length > 0) {
        out.push({
          name: room,
          sqft: 0,
          items: fallbackMoments.map((m, i) => ({
            name: `Voice note ${i + 1}`,
            condition: "F",
            notes: m.transcript || "(no description)",
            photos: [m.photoUrl],
          })),
        });
      }
    }
    if (out.length === 0) {
      useStore.getState().showToast("No moments captured — nothing to build", "warning");
      setFinishing(false);
      return;
    }
    onComplete(out);
  };

  /* ── Render ────────────────────────────────────────────────────── */

  if (finishing) {
    return (
      <div className="fi" style={{ textAlign: "center", padding: "40px 20px" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🤖</div>
        <h3 style={{ color: "var(--color-primary)", fontSize: 16, marginBottom: 8 }}>
          {finishStatus || "Finishing..."}
        </h3>
        <p className="dim" style={{ fontSize: 12 }}>
          {Object.values(roomMoments).reduce((a, b) => a + b.length, 0)} photos · {rooms.length} rooms
        </p>
      </div>
    );
  }

  const items = currentRoom ? presetItemsFor(currentRoom) : [];
  const checkedSet = currentRoom ? mentioned[currentRoom] || new Set<string>() : new Set<string>();
  const thisRoomMoments = currentRoom ? roomMoments[currentRoom] || [] : [];
  const isLastRoom = currentIdx === rooms.length - 1;

  const statusColor = (s?: RoomStatus) => {
    if (s === "done") return "var(--color-success)";
    if (s === "analyzing") return "var(--color-highlight)";
    if (s === "failed") return "var(--color-accent-red)";
    return "var(--color-primary)";
  };
  const statusIcon = (s?: RoomStatus) => {
    if (s === "done") return "✓";
    if (s === "analyzing") return "⏳";
    if (s === "failed") return "✕";
    return "•";
  };

  return (
    <div className="fi">
      {/* Hidden fallback file input — used when getUserMedia is unavailable. */}
      <input
        ref={fileFallbackRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={onFallbackFile}
      />

      {/* Header */}
      <div className="row mb" style={{ justifyContent: "space-between" }}>
        <button className="bo" onClick={() => { stopCamera(); stopRecognition(); onCancel(); }} style={{ fontSize: 12, padding: "4px 8px" }}>← Cancel</button>
        <h2 style={{ fontSize: 18, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span>🎤</span> Voice Walk
        </h2>
        <span className="dim" style={{ fontSize: 11 }}>
          Room {currentIdx + 1}/{rooms.length}
        </span>
      </div>

      {/* Progress strip — every room with its status */}
      <div className="cd mb" style={{ padding: 8 }}>
        <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 2 }}>
          {rooms.map((r, idx) => {
            const active = idx === currentIdx;
            const status = roomStatus[r];
            const total = presetItemsFor(r).length;
            const checked = mentioned[r]?.size || 0;
            const photoCount = (roomMoments[r] || []).length;
            const c = statusColor(status);
            return (
              <button
                key={r}
                onClick={() => setCurrentIdx(idx)}
                style={{
                  padding: "5px 10px",
                  borderRadius: 14,
                  fontSize: 11,
                  whiteSpace: "nowrap",
                  background: active ? c : "transparent",
                  color: active ? "#fff" : c,
                  border: `1px solid ${c}`,
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
                title={status ? `Status: ${status}` : "Pending"}
              >
                <span>{statusIcon(status)}</span>
                <span>{r}</span>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "Oswald",
                    background: active ? "rgba(255,255,255,0.18)" : `${c}1a`,
                    padding: "1px 5px",
                    borderRadius: 8,
                  }}
                >
                  {checked}/{total}{photoCount > 0 ? ` · 📷${photoCount}` : ""}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {!supported && (
        <div
          className="cd mb"
          style={{ borderLeft: "3px solid var(--color-warning)", fontSize: 12 }}
        >
          <b style={{ color: "var(--color-warning)" }}>Voice not available</b>
          <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
            This browser doesn&apos;t support speech recognition. You can still snap photos and type a description below each — items will auto-check the same way.
          </div>
        </div>
      )}

      {/* Active room — title + checklist */}
      {currentRoom && (
        <div className="cd mb" style={{ padding: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <h3 style={{ fontSize: 16, color: "var(--color-primary)", margin: 0 }}>{currentRoom}</h3>
            {items.length > 0 && (
              <span className="dim" style={{ fontSize: 11, fontFamily: "Oswald" }}>
                {checkedSet.size}/{items.length} mentioned
              </span>
            )}
          </div>
          {items.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {items.map((item) => {
                const isChecked = checkedSet.has(item);
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
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isChecked ? "✓ " : "○ "}{item}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Single Start/Stop control — drives mic + camera together so the
          user always knows whether the inspection is "live" or paused. */}
      <div className="cd mb" style={{ padding: 10, textAlign: "center" }}>
        <button
          onClick={() => setInspecting((v) => !v)}
          style={{
            padding: "10px 22px",
            fontSize: 14,
            fontFamily: "Oswald",
            background: inspecting ? "var(--color-accent-red)" : "var(--color-success)",
            color: "#fff",
            borderRadius: 22,
            border: "none",
            animation: inspecting ? "vw-pulse 1.5s ease-in-out infinite" : "none",
            letterSpacing: ".04em",
          }}
        >
          {inspecting ? "■ Stop Inspecting" : "▶ Start Inspecting"}
        </button>
        <style>{`@keyframes vw-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.75; } }`}</style>
        <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
          {inspecting
            ? "Mic + camera live. Talk through what you see, snap photos."
            : "Tap to turn on the mic and camera for this room."}
        </div>
      </div>

      {/* Live transcript — only shown while inspecting (so a stale transcript
          from the last room doesn't linger after you advance). */}
      {inspecting && (
        <div className="cd mb" style={{ padding: 10 }}>
          <div className="dim" style={{ fontSize: 11, marginBottom: 6, fontFamily: "Oswald", letterSpacing: ".06em" }}>
            TRANSCRIPT
          </div>
          <div
            style={{
              background: darkMode ? "#0d0d14" : "#f7f7fa",
              border: `1px dashed ${border}`,
              borderRadius: 8,
              padding: 8,
              minHeight: 50,
              fontSize: 12,
              color: liveTranscript || pendingTranscript ? "inherit" : "#888",
            }}
          >
            {supported ? (
              liveTranscript || "Listening… describe what you see, then tap 📸 to attach a photo."
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
                  minHeight: 48,
                  fontSize: 12,
                  color: "inherit",
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Inline camera preview + snap — only mounted while inspecting so
          the camera light doesn't come on the moment you enter the screen. */}
      {inspecting && (
      <div className="cd mb" style={{ padding: 10 }}>
        <div className="dim" style={{ fontSize: 11, marginBottom: 6, fontFamily: "Oswald", letterSpacing: ".06em" }}>
          CAMERA
        </div>
        <div
          style={{
            position: "relative",
            background: "#000",
            borderRadius: 8,
            overflow: "hidden",
            // Portrait aspect ratio fills more of a phone screen than the
            // old landscape 4:3 — about 1.3× taller for the same width.
            aspectRatio: "3 / 4",
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: cameraOn ? "block" : "none",
            }}
          />
          {!cameraOn && (
            <div style={{ color: "#bbb", fontSize: 12, padding: 16, textAlign: "center" }}>
              {cameraError || "Starting camera..."}
            </div>
          )}
          {/* Torch toggle overlay — top-right of the preview. Shown
              optimistically when the camera is on; if the first tap turns
              out to be a no-op (device doesn't actually support flash),
              the button hides itself with a toast for honest feedback. */}
          {cameraOn && torchAvailable && (
            <button
              onClick={toggleTorch}
              aria-label={torchOn ? "Turn flash off" : "Turn flash on"}
              title={torchOn ? "Flash on" : "Flash off"}
              style={{
                position: "absolute",
                top: 10,
                right: 10,
                width: 40,
                height: 40,
                borderRadius: "50%",
                border: "none",
                background: torchOn ? "rgba(255,204,0,0.95)" : "rgba(0,0,0,0.55)",
                color: torchOn ? "#1a1a1a" : "#fff",
                fontSize: 20,
                lineHeight: 1,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: torchOn ? "0 0 16px rgba(255,204,0,0.6)" : "0 1px 4px rgba(0,0,0,0.4)",
              }}
            >
              {torchOn ? "⚡" : "🔦"}
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={snapFromVideo}
            disabled={!cameraOn}
            style={{
              flex: 1,
              padding: "10px",
              fontSize: 14,
              fontFamily: "Oswald",
              background: cameraOn ? "var(--color-primary)" : "#888",
              color: "#fff",
              borderRadius: 8,
              border: "none",
              opacity: cameraOn ? 1 : 0.5,
            }}
          >
            📸 Snap &amp; Attach
          </button>
          {!cameraOn ? (
            <button
              onClick={() => fileFallbackRef.current?.click()}
              className="bo"
              style={{ fontSize: 12, padding: "10px 14px" }}
            >
              📁 File
            </button>
          ) : (
            <button
              onClick={() => fileFallbackRef.current?.click()}
              className="bo"
              style={{ fontSize: 11, padding: "6px 10px" }}
              title="Pick from gallery instead"
            >
              📁
            </button>
          )}
        </div>
        {uploading > 0 && (
          <div style={{ fontSize: 11, color: "var(--color-primary)", marginTop: 6, textAlign: "center" }}>
            Uploading {uploading} photo{uploading === 1 ? "" : "s"}…
          </div>
        )}
      </div>
      )}

      {/* This room's captured moments — small thumb strip */}
      {thisRoomMoments.length > 0 && (
        <div className="cd mb" style={{ padding: 10 }}>
          <div className="dim" style={{ fontSize: 11, marginBottom: 6, fontFamily: "Oswald", letterSpacing: ".06em" }}>
            CAPTURED IN {currentRoom?.toUpperCase()} ({thisRoomMoments.length})
          </div>
          <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
            {thisRoomMoments.map((m) => (
              <div key={m.id} style={{ position: "relative", flexShrink: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.photoUrl}
                  alt=""
                  title={m.transcript || "(no description)"}
                  style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6 }}
                />
                <button
                  onClick={() => {
                    if (!currentRoom) return;
                    setRoomMoments((prev) => ({
                      ...prev,
                      [currentRoom]: (prev[currentRoom] || []).filter((x) => x.id !== m.id),
                    }));
                    // Force re-fire on next advance.
                    delete roomLastProcessedRef.current[currentRoom];
                  }}
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    background: "var(--color-accent-red)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "50%",
                    width: 18,
                    height: 18,
                    fontSize: 11,
                    lineHeight: "16px",
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Advance / Finish */}
      <button
        className="bb"
        onClick={isLastRoom ? finish : advanceRoom}
        disabled={uploading > 0}
        style={{
          width: "100%",
          padding: 14,
          fontSize: 15,
          fontFamily: "Oswald",
          opacity: uploading > 0 ? 0.5 : 1,
        }}
      >
        {isLastRoom
          ? "✓ Finish & Build Inspection"
          : `Next Room: ${rooms[currentIdx + 1]} →`}
      </button>
      {!isLastRoom && (
        <p className="dim" style={{ fontSize: 11, textAlign: "center", marginTop: 4 }}>
          AI starts analyzing this room while you walk the next one.
        </p>
      )}
    </div>
  );
}
