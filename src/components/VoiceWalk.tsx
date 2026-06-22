"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/lib/store";
import { ROOM_PRESETS } from "./screens/Inspector";
import { Icon } from "./Icon";
import { trackHasTorch, findTorchDeviceId } from "@/lib/torch";

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

/* ── Keyword expansion for the per-room checklist auto-tick ─────────── */
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
  "Exhaust Fan": ["exhaust fan", "vent fan", "exhaust"],
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
  Flooring: ["floor", "flooring", "carpet", "tile", "vinyl", "laminate", "hardwood"],
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

// Legacy ROOM_PRESETS-based lookup. Used as a fallback when the parent
// didn't pass an `itemsForRoom` prop (e.g. older callers). The
// type-aware path is preferred — see the wrapper inside the component.
function presetItemsFor(room: string): string[] {
  const exact = ROOM_PRESETS[room];
  if (exact) return exact;
  const baseKey = Object.keys(ROOM_PRESETS).find(
    (k) => room.startsWith(k.replace(/ \d+$/, ""))
  );
  return baseKey ? ROOM_PRESETS[baseKey] : [];
}

/* ── Transcript dedup ────────────────────────────────────────────────
   Given the previous finalized text and a new finalized text, return
   only the portion of `next` to append. This handles two real-world
   buggy patterns we've seen on mobile browsers:

   1. Progressive-superset bug: each interim becomes a new finalized
      result at a new index, with text being the cumulative sentence
      so far. Naive concatenation produces "okay okay so okay so here".
   2. Audio-buffer overlap across recognizer restarts: when a session
      ends mid-sentence and a new one starts, the new session's first
      final often re-includes the tail of the prior session's final.

   We find the longest suffix of `prev` that is also a prefix of `next`,
   strip it, and return the remainder.
*/
// (dedupOverlap removed — it was only used by the live Web Speech recognizer.)

/* ── Component ─────────────────────────────────────────────────────── */

interface RoomPhoto {
  id: string;
  url: string;
  tsRelativeMs: number; // ms from the room's recording-started instant
}

interface RoomRecording {
  transcript: string; // single growing string for the whole room
  photos: RoomPhoto[];
  recordingStartedAt: number | null; // wall-clock ms when first Start happened in this room
  totalRecordedMs: number; // accumulated across pause/resume
  lastResumedAt: number | null; // wall-clock when current segment began (null while paused)
}

const emptyRecording = (): RoomRecording => ({
  transcript: "",
  photos: [],
  recordingStartedAt: null,
  totalRecordedMs: 0,
  lastResumedAt: null,
});

// Internal status type for the strip's color/icon helpers below.
type RoomStatus = "pending" | "analyzing" | "done" | "failed";

// (conditionLabel/Color helpers moved to Inspector — VoiceWalk no
//  longer renders AI condition badges; the parent does that after
//  background processing completes.)

/** Raw recording payload handed back to the parent on finish. The
 *  parent (Inspector) runs Whisper + AI in the background so the
 *  user can advance to the next room without blocking on processing.
 *  See Inspector.processRoomVoice. */
export interface VoiceWalkResult {
  /** Audio captured by MediaRecorder for this segment. Null if the
   *  recorder failed (mic denied, etc.). */
  audioBlob: Blob | null;
  audioMime: string;
  /** Photos captured during the recording, in order with relative
   *  timestamps so AI can correlate "what was being said" per photo. */
  photos: { url: string; tsRelativeMs: number }[];
  /** Whatever Web Speech captured live (peek strip text). On iOS
   *  this is fragmented; the parent should re-transcribe the audio
   *  via Whisper for the canonical transcript. */
  partialTranscript: string;
}

/** Per-room status the parent passes in for the progress strip.
 *  "analyzing" → ⏳ (Whisper/AI running in the background)
 *  "done"      → ✓
 *  "failed"    → ✕
 *  undefined   → not started */
export type VoiceWalkRoomStatus = "analyzing" | "done" | "failed";

interface Props {
  property: string;
  client: string;
  rooms: string[];
  onComplete: (result: VoiceWalkResult) => void;
  onCancel: () => void;
  darkMode: boolean;
  /** When true (or when rooms.length === 1), the strip is informational
   *  only — the user can't navigate to a different room. They came in
   *  via Inspector's per-room mic, do this one room, return. */
  singleRoom?: boolean;
  /** Statuses for OTHER rooms in the inspection that the parent is
   *  processing in the background. Lights up the strip with ⏳/✓. */
  roomStatuses?: Record<string, VoiceWalkRoomStatus>;
  /** Per-area item checklist — single source of truth shared with the
   *  Inspector form. When provided, the "things to mention" list and
   *  auto-tick keywords are derived from this. When omitted, falls back
   *  to the legacy ROOM_PRESETS lookup (move-out behavior). Inspector
   *  passes its active type's `itemsForRoom` here so Painting Only /
   *  Yard Cutting / Initial Walkthrough surface the same checklist on
   *  both the form and the voice screen. */
  itemsForRoom?: (room: string) => string[];
}

export default function VoiceWalk({ property, client: _client, rooms, onComplete, onCancel, darkMode, singleRoom, roomStatuses, itemsForRoom }: Props) {
  void property; void _client; // (used only by the parent's processRoomVoice now)
  const isSingleRoom = singleRoom || rooms.length === 1;

  // Refs that survive renders
  const fileFallbackRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // MediaRecorder owns the canonical audio track. Web Speech is only
  // used for live preview now. The recorder runs continuously from
  // Start to Stop — no cycling, no chimes after the initial mic-on.
  // Per-room: each room collects its own array of audio chunks across
  // any pause/resume segments. They get concatenated and sent to
  // /api/transcribe when the user advances or finishes.
  const recorderRef = useRef<MediaRecorder | null>(null);
  // Per-room accumulated audio. With single-take enforcement (re-record
  // wipes this for the current room before starting fresh), each room's
  // entry is the chunks of exactly ONE MediaRecorder instance — so the
  // resulting Blob is a single coherent WebM/MP4 stream that Whisper
  // can decode end-to-end.
  const roomAudioChunksRef = useRef<Record<string, Blob[]>>({});
  // Callbacks waiting for the recorder's onstop to fire (and chunks to
  // be folded). The Done / Next-Room buttons await this so we don't try
  // to transcribe before MediaRecorder finalizes the audio.
  const recorderStopWaitersRef = useRef<Array<() => void>>([]);

  // Speech support detection
  const [supported] = useState<boolean>(() => !!getSpeechRecognition());
  // Single inspecting toggle — drives mic AND camera together. Off by
  // default. The user lands on each room with everything quiet, taps
  // Start to begin recording, taps Stop to pause.
  const [inspecting, setInspecting] = useState(false);
  const [pendingTyped, setPendingTyped] = useState(""); // typed-fallback buffer when speech unsupported

  // Per-room state — ONE recording per room, append-only across pause/resume.
  const [currentIdx, setCurrentIdx] = useState(0);
  const [roomRecordings, setRoomRecordings] = useState<Record<string, RoomRecording>>({});
  const [mentioned, setMentioned] = useState<Record<string, Set<string>>>({});
  // Tick state to force re-render when transcript grows in roomRecordings.
  const [transcriptTick, setTranscriptTick] = useState(0);

  // Camera state
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [torchAvailable, setTorchAvailable] = useState(true);
  const [torchOn, setTorchOn] = useState(false);

  // Live-elapsed clock for the recording display
  const [nowTick, setNowTick] = useState(0);

  const currentRoom = rooms[currentIdx] || rooms[0] || null;
  const currentRoomRef = useRef<string | null>(currentRoom);
  useEffect(() => { currentRoomRef.current = currentRoom; }, [currentRoom]);

  /**
   * Single source of truth for "what items should the user mention in
   * this area" — same checklist the Inspector form shows. When the
   * parent passes `itemsForRoom` (the active inspection type's
   * type × area config), use that. Otherwise fall back to the legacy
   * ROOM_PRESETS lookup (move-out behavior, kept for back-compat).
   * Used by the auto-tick keyword matcher, the room-strip badges, and
   * the "things to mention" chip grid below the camera.
   */
  const itemsFor = (room: string | null): string[] => {
    if (!room) return [];
    if (itemsForRoom) {
      const fromType = itemsForRoom(room);
      if (fromType.length > 0) return fromType;
    }
    return presetItemsFor(room);
  };

  const border = darkMode ? "#1e1e2e" : "#eee";

  /* ── Recording timing helpers ────────────────────────────────────── */
  const currentTsRelative = useCallback((rec?: RoomRecording): number => {
    const r = rec || (currentRoom ? roomRecordings[currentRoom] : null);
    if (!r) return 0;
    if (r.lastResumedAt) {
      return r.totalRecordedMs + (Date.now() - r.lastResumedAt);
    }
    return r.totalRecordedMs;
  }, [currentRoom, roomRecordings]);

  const fmtMs = (ms: number) => {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  // Live elapsed clock — only ticks while inspecting.
  useEffect(() => {
    if (!inspecting) return;
    const id = window.setInterval(() => setNowTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [inspecting]);

  /* ── Speech recognition lifecycle (LIVE PREVIEW + auto-tick driver) ──
     Web Speech feeds two things while the user is recording:
     1) the small "HEARING …" peek strip (interim words)
     2) the per-room transcript that drives auto-tick of the checklist
        (final words appended via setRoomTranscript)

     We do NOT auto-restart. iOS Safari ends sessions per utterance;
     when that happens the peek goes quiet AND auto-tick stops growing.
     The MediaRecorder keeps capturing audio in the background — at
     end-of-room Whisper transcribes the full thing and OVERWRITES the
     transcript, which re-fires auto-tick on a complete dataset and
     feeds the AI categorization.

     Net: ONE OS mic chime per Resume tap (instead of every 6s), and
     items still tick off live as they're mentioned (continuously on
     Chrome desktop; for the first ~5–10s on iOS until the first
     session ends naturally).
  ─────────────────────────────────────────────────────────────────── */
  // (Live Web Speech recognizer + live-transcript helpers removed — the
  //  per-pause restart re-armed the mic every few seconds, firing a
  //  continuous OS beep. The canonical transcript is produced by the
  //  parent from the MediaRecorder audio via Whisper; see onComplete.)

  /* ── MediaRecorder lifecycle (CANONICAL audio) ──────────────────── */
  const pickRecorderMime = (): string => {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];
    for (const c of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(c)) return c;
    }
    return "";
  };

  /* ── Combined media lifecycle (camera + audio in ONE getUserMedia) ──
     iOS Safari often fails the second getUserMedia call when one is
     already active. Requesting audio+video in a single call gives us
     a stream we can use for both the camera <video> AND for
     MediaRecorder via the audio track. Web Speech then runs
     independently using the system mic. */
  const startCameraAndRecorder = useCallback(async () => {
    setCameraError(null);
    try {
      let stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Mute so we don't echo the mic back through the speaker.
        videoRef.current.muted = true;
        await videoRef.current.play().catch(() => {});
      }
      setCameraOn(true);
      // Torch lives on only one rear lens on multi-lens phones, usually not the
      // one facingMode picks. If ours can't drive the flash, hunt for a lens
      // that can and re-open it WITH audio (so the recorder below binds to the
      // final stream). Done before the MediaRecorder block on purpose; guarded
      // by stream identity so a Stop mid-probe doesn't clobber anything.
      let hasTorch = trackHasTorch(stream.getVideoTracks()[0]);
      if (!hasTorch) {
        const torchId = await findTorchDeviceId();
        if (torchId && streamRef.current === stream) {
          try {
            const better = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: torchId } },
              audio: true,
            });
            if (streamRef.current === stream) {
              stream.getTracks().forEach((t) => t.stop());
              stream = better;
              streamRef.current = stream;
              if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.muted = true;
                await videoRef.current.play().catch(() => {});
              }
              hasTorch = true;
            } else {
              better.getTracks().forEach((t) => t.stop());
            }
          } catch {
            /* keep the original stream */
          }
        }
      }
      setTorchAvailable(hasTorch);
      setTorchOn(false);

      // Start MediaRecorder on JUST the audio track from the same stream.
      if (typeof MediaRecorder !== "undefined" && stream.getAudioTracks().length > 0) {
        try {
          const audioOnly = new MediaStream(stream.getAudioTracks());
          const mime = pickRecorderMime();
          const opts = mime ? { mimeType: mime } : undefined;
          const rec = new MediaRecorder(audioOnly, opts);
          // Each MediaRecorder owns its OWN chunks via closure capture.
          // A previously shared ref was racy: a late-firing onstop from
          // a prior recorder could fold the *current* recorder's
          // in-progress chunks (and then wipe them).
          const myChunks: Blob[] = [];
          // Capture the room name at recording-start so onstop folds
          // into the right bucket even if currentRoomRef somehow drifts.
          const myRoom = currentRoomRef.current;
          rec.ondataavailable = (ev) => {
            if (ev.data && ev.data.size > 0) myChunks.push(ev.data);
          };
          rec.onstop = () => {
            if (myRoom) {
              const prior = roomAudioChunksRef.current[myRoom] || [];
              roomAudioChunksRef.current[myRoom] = [...prior, ...myChunks];
              const totalSize = roomAudioChunksRef.current[myRoom].reduce((s, b) => s + b.size, 0);
              console.log(`[VoiceWalk] Recorder stopped for "${myRoom}": ${myChunks.length} chunks, ${totalSize} bytes total`);
            }
            // Resolve anyone waiting for this stop event (Done / re-record).
            const waiters = recorderStopWaitersRef.current;
            recorderStopWaitersRef.current = [];
            waiters.forEach((w) => {
              try { w(); } catch { /* */ }
            });
          };
          rec.start(1000);
          recorderRef.current = rec;
        } catch (err) {
          console.warn("MediaRecorder start failed:", err);
        }
      }
    } catch (err) {
      console.warn("getUserMedia(audio+video) failed:", err);
      setCameraError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Camera/mic permission denied. Use the file picker."
          : "Camera/mic unavailable. Use the file picker."
      );
      setCameraOn(false);
      setTorchAvailable(false);
    }
  }, []);

  const stopCameraAndRecorder = useCallback(() => {
    // Stop MediaRecorder first so its onstop fires while tracks still live.
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec) {
      try { if (rec.state !== "inactive") rec.stop(); } catch { /* */ }
    }
    // Then tear down the stream.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    setTorchAvailable(true);
    setTorchOn(false);
  }, []);

  /** Stop the recorder and wait for its onstop to fold chunks into
   *  roomAudioChunksRef, so callers can immediately transcribe complete
   *  audio. Used by advanceRoom and finish to avoid the timing bug
   *  where Whisper got an empty chunk list because the recorder was
   *  still running when fireRoomAi ran. */
  const stopRecorderAndWait = useCallback((): Promise<void> => {
    return new Promise<void>((resolve) => {
      const rec = recorderRef.current;
      if (!rec || rec.state === "inactive") {
        resolve();
        return;
      }
      recorderStopWaitersRef.current.push(resolve);
      try { rec.stop(); } catch { resolve(); }
      // Hard timeout in case onstop never fires (some buggy iOS builds).
      setTimeout(() => {
        const waiters = recorderStopWaitersRef.current;
        if (waiters.includes(resolve)) {
          recorderStopWaitersRef.current = waiters.filter((w) => w !== resolve);
          console.warn("[VoiceWalk] Recorder onstop timed out after 3s — proceeding anyway");
          resolve();
        }
      }, 3000);
    });
  }, []);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await (track.applyConstraints as (c: MediaTrackConstraints & { advanced?: Array<{ torch?: boolean }> }) => Promise<void>)({
        advanced: [{ torch: next }],
      });
      setTorchOn(next);
    } catch (err) {
      console.warn("Torch toggle failed:", err);
      setTorchAvailable(false);
      setTorchOn(false);
      const name = err instanceof Error && err.name ? ` (${err.name})` : "";
      useStore.getState().showToast(`Flash not available on this camera${name}`, "info");
    }
  }, [torchOn]);

  /* ── Pause/resume bookkeeping for the current room recording ─────── */
  const beginSegment = useCallback(() => {
    const room = currentRoomRef.current;
    if (!room) return;
    setRoomRecordings((prev) => {
      const cur = prev[room] || emptyRecording();
      return {
        ...prev,
        [room]: {
          ...cur,
          recordingStartedAt: cur.recordingStartedAt ?? Date.now(),
          lastResumedAt: Date.now(),
        },
      };
    });
  }, []);

  const endSegment = useCallback(() => {
    const room = currentRoomRef.current;
    if (!room) return;
    setRoomRecordings((prev) => {
      const cur = prev[room];
      if (!cur || !cur.lastResumedAt) return prev;
      return {
        ...prev,
        [room]: {
          ...cur,
          totalRecordedMs: cur.totalRecordedMs + (Date.now() - cur.lastResumedAt),
          lastResumedAt: null,
        },
      };
    });
  }, []);

  /* ── Unified inspecting toggle ──────────────────────────────────────
     When on: open camera + recorder (single getUserMedia) + Web Speech
     preview. Web Speech feeds the live transcript that drives the
     auto-tick checklist matcher; MediaRecorder owns the canonical
     audio for Whisper at end-of-room. When off: tear all three down,
     fold this segment's audio into the room's accumulated chunks.
  ────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (inspecting) {
      beginSegment();
      startCameraAndRecorder();
    } else {
      stopCameraAndRecorder();
      endSegment();
    }
    return () => {
      stopCameraAndRecorder();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspecting]);

  // Force-pause when changing rooms; the new room starts cold.
  useEffect(() => {
    setInspecting(false);
    setPendingTyped("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx]);

  /* ── Auto-tick checklist items as they're mentioned ──────────────── */
  useEffect(() => {
    if (!currentRoom) return;
    const rec = roomRecordings[currentRoom];
    // Tick items off the room transcript (the typed-narration fallback, or
    // whatever the parent writes back) — the live mic preview was removed,
    // so there are no interim words to match.
    const speechText = (rec?.transcript || "").toLowerCase();
    const fallbackText = pendingTyped.toLowerCase();
    const text = `${speechText} ${fallbackText}`.trim();
    if (!text) return;
    const items = itemsFor(currentRoom);
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
  }, [currentRoom, transcriptTick, pendingTyped, mentioned, roomRecordings]);

  /* ── Keep Web Speech alive for the whole room ──────────────────────
     Android Chrome ends a recognition session after each pause (onend
     nulls recogRef). Without this, the live green ticks stop after the
     first sentence. While inspecting, restart recognition whenever it's
     dropped so it keeps listening for the entire take. */
  // (Web Speech restart loop removed — re-arming the recognizer on every
  //  pause is what fired the OS mic beep every few seconds.)

  const toggleItem = (room: string, item: string) => {
    setMentioned((prev) => {
      const set = new Set(prev[room] || []);
      if (set.has(item)) set.delete(item);
      else set.add(item);
      return { ...prev, [room]: set };
    });
  };

  /* ── Photo capture ───────────────────────────────────────────────── */
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

  const attachPhoto = useCallback(async (blob: Blob) => {
    const room = currentRoomRef.current;
    if (!room) return;
    setUploading((c) => c + 1);
    try {
      const compressed = await compressBlob(blob);
      const path = `inspections/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
      const { error } = await supabase.storage.from("receipts").upload(path, compressed);
      if (error) throw error;
      const { data } = supabase.storage.from("receipts").getPublicUrl(path);
      setRoomRecordings((prev) => {
        const cur = prev[room] || emptyRecording();
        const ts = cur.lastResumedAt
          ? cur.totalRecordedMs + (Date.now() - cur.lastResumedAt)
          : cur.totalRecordedMs;
        return {
          ...prev,
          [room]: {
            ...cur,
            // First photo before any recording: implicitly start the clock
            // from now so subsequent photos get sane offsets.
            recordingStartedAt: cur.recordingStartedAt ?? Date.now(),
            photos: [
              ...cur.photos,
              {
                id: crypto.randomUUID().slice(0, 8),
                url: data.publicUrl,
                tsRelativeMs: ts,
              },
            ],
          },
        };
      });
    } catch (err) {
      console.error("Voice walk photo upload failed:", err);
      useStore.getState().showToast("Photo upload failed", "error");
    }
    setUploading((c) => c - 1);
  }, []);

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
    await attachPhoto(blob);
  };

  const onFallbackFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    for (const f of Array.from(files)) await attachPhoto(f);
    if (fileFallbackRef.current) fileFallbackRef.current.value = "";
  };

  /* ── Re-record: discard prior audio/transcript/timing for the current
       room and start a fresh single take. Photos are preserved (the user
       may have framed good shots and only want to redo narration). */
  const reRecord = useCallback(async () => {
    const room = currentRoomRef.current;
    if (!room) return;
    // Defensive: ensure any prior recorder.onstop has fired (and folded
    // its chunks) before we wipe the bucket.
    await stopRecorderAndWait();
    delete roomAudioChunksRef.current[room];
    setRoomRecordings((prev) => {
      const cur = prev[room];
      return {
        ...prev,
        [room]: { ...emptyRecording(), photos: cur?.photos || [] },
      };
    });
    setMentioned((prev) => ({ ...prev, [room]: new Set<string>() }));
    setInspecting(true);
  }, [stopRecorderAndWait]);

  /* ── Finish: hand raw recording data to the parent for background
       processing. The parent (Inspector) runs Whisper + AI without
       blocking the user — they advance to the next room immediately.
       Status indicators in the strip light up via roomStatuses prop. */
  const finish = useCallback(async () => {
    if (!currentRoom) return;
    // CRITICAL: stop the recorder and wait for MediaRecorder.onstop
    // to fold the chunks. Otherwise the audioBlob below is incomplete.
    if (inspecting) {
      await stopRecorderAndWait();
      setInspecting(false);
    }
    const rec = roomRecordings[currentRoom];
    const chunks = roomAudioChunksRef.current[currentRoom] || [];
    const audioMime = chunks[0]?.type || "audio/webm";
    const audioBlob = chunks.length > 0 ? new Blob(chunks, { type: audioMime }) : null;
    const photos = rec?.photos.map((p) => ({ url: p.url, tsRelativeMs: p.tsRelativeMs })) || [];
    const partialTranscript = (rec?.transcript || "").trim();
    console.log(`[VoiceWalk] Finishing "${currentRoom}": audio ${audioBlob?.size || 0}B, ${photos.length} photos, partial transcript ${partialTranscript.length} chars`);
    onComplete({ audioBlob, audioMime, photos, partialTranscript });
  }, [currentRoom, inspecting, roomRecordings, stopRecorderAndWait, onComplete]);

  /* ── Render ────────────────────────────────────────────────────── */

  const items = itemsFor(currentRoom);
  const checkedSet = currentRoom ? mentioned[currentRoom] || new Set<string>() : new Set<string>();
  const currentRec = currentRoom ? roomRecordings[currentRoom] : undefined;
  const thisRoomPhotos = currentRec?.photos || [];
  const isLastRoom = currentIdx === rooms.length - 1;

  const elapsedDisplay = currentRec ? fmtMs(currentTsRelative(currentRec)) : "0:00";
  // Avoid unused warning on nowTick — it just forces re-render.
  void nowTick;

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
        <button
          className="bo"
          disabled={uploading > 0}
          onClick={() => { stopCameraAndRecorder(); onCancel(); }}
          title={uploading > 0 ? "Wait for photo upload to finish…" : "Cancel"}
          style={{ fontSize: 14, padding: "4px 8px", opacity: uploading > 0 ? 0.5 : 1 }}
        >← Cancel</button>
        <h2 style={{ fontSize: 20, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="mic" size={18} color="var(--color-primary)" strokeWidth={2} /> Voice Walk
        </h2>
        <span className="dim" style={{ fontSize: 13 }}>
          Room {currentIdx + 1}/{rooms.length}
        </span>
      </div>

      {/* Progress strip — every room with its status. Hidden in
          single-room mode (Inspector per-room mic integration). */}
      {!isSingleRoom && (
      <div className="cd mb" style={{ padding: 8 }}>
        <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 2 }}>
          {rooms.map((r, idx) => {
            const active = idx === currentIdx;
            // Status from parent's background processing — renders the
            // ⏳/✓/✕ indicator on each room's chip in the strip.
            const status = roomStatuses?.[r];
            const total = itemsFor(r).length;
            const checked = mentioned[r]?.size || 0;
            const photoCount = (roomRecordings[r]?.photos.length) || 0;
            const c = statusColor(status);
            return (
              <button
                key={r}
                onClick={() => {
                  if (idx !== currentIdx) setCurrentIdx(idx);
                }}
                style={{
                  padding: "5px 10px",
                  borderRadius: 14,
                  fontSize: 13,
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
                    fontSize: 12,
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
      )}

      {!supported && (
        <div
          className="cd mb statusstrip"
          style={{ ["--c" as any]: "var(--color-warning)", fontSize: 14 }}
        >
          <b style={{ color: "var(--color-warning)" }}>Voice not available</b>
          <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>
            This browser doesn&apos;t support speech recognition. Type your narration in the box below; AI will use it the same way.
          </div>
        </div>
      )}

      {/* Room title — split from the checklist body so the camera can
          slot between them when inspecting. */}
      {currentRoom && (
        <div className="cd mb" style={{ padding: "10px 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ fontSize: 19, color: "var(--color-primary)", margin: 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
              {currentRoom}
              {currentRoom && roomStatuses?.[currentRoom] === "analyzing" && (
                <span style={{ fontSize: 13, color: "var(--color-highlight)", fontFamily: "Oswald" }}>· analyzing…</span>
              )}
              {currentRoom && roomStatuses?.[currentRoom] === "done" && (
                <span style={{ fontSize: 13, color: "var(--color-success)", fontFamily: "Oswald" }}>· done ✓</span>
              )}
            </h3>
            {items.length > 0 && (
              <span className="dim" style={{ fontSize: 13, fontFamily: "Oswald" }}>
                {checkedSet.size}/{items.length} mentioned · {thisRoomPhotos.length} 📷
              </span>
            )}
          </div>
        </div>
      )}

      {/* CAMERA — when inspecting, sticky to the top of the viewport so
          the user can scroll the checklist below without losing the
          preview or the snap button. 4:3 landscape aspect keeps it
          short so the checklist stays visible right beneath. */}
      {inspecting && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "#000",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <style>{`@keyframes vw-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }`}</style>

          {/* Camera fills everything above the control bar */}
          <div style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
              <div style={{ color: "#bbb", fontSize: 14, padding: 16, textAlign: "center" }}>
                {cameraError || "Starting camera…"}
              </div>
            )}

            {/* TOP overlay: room · REC · counts · flash, then the checklist
                chips. Items live ON the camera so the preview fills the
                screen; each chip glows green the instant its keyword is
                heard (or it's tapped). */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                padding: "calc(10px + env(safe-area-inset-top)) 10px 26px",
                background: "linear-gradient(to bottom, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.35) 58%, rgba(0,0,0,0) 100%)",
              }}
            >
              {currentRoom && (
                <div style={{ textAlign: "center", marginBottom: 7 }}>
                  <span style={{ background: "rgba(0,0,0,0.5)", color: "#fff", fontFamily: "Oswald", fontSize: 13, letterSpacing: ".04em", padding: "3px 12px", borderRadius: 12 }}>
                    {currentRoom}
                  </span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 13, fontFamily: "Oswald", padding: "3px 8px", borderRadius: 12, letterSpacing: ".06em" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--color-accent-red)", animation: "vw-pulse 1.5s ease-in-out infinite" }} />
                    REC {elapsedDisplay}
                  </span>
                  {(uploading > 0 || thisRoomPhotos.length > 0) && (
                    <span style={{ background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 13, fontFamily: "Oswald", padding: "3px 8px", borderRadius: 12, whiteSpace: "nowrap" }}>
                      {uploading > 0 ? `↑ ${uploading}` : `📷 ${thisRoomPhotos.length}`}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {items.length > 0 && (
                    <span style={{ background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 13, fontFamily: "Oswald", padding: "3px 8px", borderRadius: 12 }}>
                      {checkedSet.size}/{items.length}
                    </span>
                  )}
                  {cameraOn && torchAvailable && (
                    <button
                      onClick={toggleTorch}
                      aria-label={torchOn ? "Turn flash off" : "Turn flash on"}
                      title={torchOn ? "Flash on" : "Flash off"}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        border: "none",
                        background: torchOn ? "rgba(255,204,0,0.95)" : "rgba(0,0,0,0.55)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        boxShadow: torchOn ? "0 0 14px rgba(255,204,0,0.7)" : "none",
                        flexShrink: 0,
                      }}
                    >
                      <Icon name="flash" size={18} color={torchOn ? "#1a1a1a" : "#fff"} />
                    </button>
                  )}
                </div>
              </div>

              {items.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: "34vh", overflowY: "auto" }}>
                  {items.map((item) => {
                    const isChecked = checkedSet.has(item);
                    return (
                      <button
                        key={item}
                        onClick={() => currentRoom && toggleItem(currentRoom, item)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "4px 10px",
                          borderRadius: 14,
                          fontSize: 13,
                          fontWeight: isChecked ? 700 : 500,
                          color: "#fff",
                          background: isChecked ? "rgba(38,166,91,0.6)" : "rgba(0,0,0,0.45)",
                          border: `1px solid ${isChecked ? "var(--color-success)" : "rgba(255,255,255,0.4)"}`,
                          boxShadow: isChecked ? "0 0 12px rgba(38,166,91,0.95)" : "none",
                          WebkitBackdropFilter: "blur(2px)",
                          backdropFilter: "blur(2px)",
                          transition: "background 0.2s, box-shadow 0.2s, border-color 0.2s",
                          cursor: "pointer",
                        }}
                      >
                        {isChecked && <span style={{ fontSize: 13, lineHeight: 1 }}>✓</span>}
                        {item}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", fontStyle: "italic", background: "rgba(0,0,0,0.4)", padding: "3px 8px", borderRadius: 10, display: "inline-block" }}>
                  No checklist — describe what you see.
                </div>
              )}
            </div>

            {/* (Live "HEARING" peek removed with the speech recognizer.) */}
          </div>

          {/* CONTROL BAR — gallery · shutter · stop. A real flex row below the
              camera, so nothing scrolls or overlaps. Done lives on the normal
              review screen that appears once you Stop. */}
          <div
            style={{
              flexShrink: 0,
              background: "#000",
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              alignItems: "center",
              padding: "14px 22px calc(16px + env(safe-area-inset-bottom))",
            }}
          >
            <button
              onClick={() => fileFallbackRef.current?.click()}
              aria-label="Pick from gallery"
              title="Pick from gallery instead"
              style={{ justifySelf: "start", width: 46, height: 46, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.16)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <Icon name="photo" size={21} color="#fff" />
            </button>
            <button
              onClick={snapFromVideo}
              disabled={!cameraOn || uploading > 0}
              aria-label="Snap photo"
              style={{
                justifySelf: "center",
                width: 72,
                height: 72,
                borderRadius: "50%",
                border: "5px solid rgba(255,255,255,0.85)",
                background: cameraOn && uploading === 0 ? "#fff" : "rgba(255,255,255,0.4)",
                cursor: cameraOn && uploading === 0 ? "pointer" : "default",
              }}
            />
            <button
              onClick={() => setInspecting(false)}
              aria-label="Stop recording"
              style={{
                justifySelf: "end",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "var(--color-accent-red)",
                color: "#fff",
                border: "none",
                borderRadius: 22,
                padding: "11px 16px",
                fontFamily: "Oswald",
                fontSize: 14,
                letterSpacing: ".04em",
                cursor: "pointer",
              }}
            >
              <Icon name="stop" size={15} color="#fff" /> Stop
            </button>
          </div>
        </div>
      )}

      {/* CHECKLIST BODY — beneath the (sticky) camera so the user can
          read every item while framing photos, no scroll-juggling.
          AI conditions/notes don't render here anymore — that's the
          parent's job (Inspector renders them once Whisper+AI complete
          in the background). VoiceWalk just shows the auto-tick state
          (mentioned-while-recording) so the user gets immediate
          visual feedback. */}
      {!inspecting && currentRoom && items.length > 0 && (
        <div className="cd mb" style={{ padding: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {items.map((item) => {
              const isChecked = checkedSet.has(item);
              // Highlight has to be obvious in daylight on a phone — Bernard
              // wants a glance to tell him what's already covered. Solid
              // green border + filled green background + bold green text on
              // the matched item; the prior version used a malformed
              // `var(--color-success)50` border (you can't suffix a var())
              // so nothing rendered.
              return (
                <div
                  key={item}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                    padding: inspecting ? "3px 7px" : "5px 7px",
                    borderRadius: 6,
                    background: isChecked
                      ? darkMode ? "rgba(38,166,91,0.28)" : "rgba(38,166,91,0.18)"
                      : "transparent",
                    border: `${isChecked ? 2 : 1}px solid ${
                      isChecked
                        ? "var(--color-success)"
                        : darkMode ? "#1e1e2e" : "#e8e8e8"
                    }`,
                    transition: "background 0.2s, border-color 0.2s",
                  }}
                >
                  <button
                    onClick={() => toggleItem(currentRoom, item)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: isChecked ? "var(--color-success)" : "#888",
                      cursor: "pointer",
                      fontSize: isChecked ? 16 : 14,
                      fontWeight: isChecked ? 700 : 400,
                      padding: 0,
                      lineHeight: 1,
                      marginTop: 1,
                    }}
                    aria-label={isChecked ? "Unmark" : "Mark"}
                  >
                    {isChecked ? "✓" : "○"}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: isChecked ? 600 : 400,
                        color: isChecked ? "var(--color-success)" : undefined,
                      }}
                    >
                      {item}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {!inspecting && currentRoom && items.length === 0 && (
        <div className="cd mb" style={{ padding: 10 }}>
          <div className="dim" style={{ fontSize: 14, fontStyle: "italic" }}>
            No standard checklist for this room — describe what you see.
          </div>
        </div>
      )}

      {/* This room's captured photos — small thumb strip */}
      {thisRoomPhotos.length > 0 && (
        <div className="cd mb" style={{ padding: 10 }}>
          <div className="dim" style={{ fontSize: 13, marginBottom: 6, fontFamily: "Oswald", letterSpacing: ".06em" }}>
            PHOTOS IN {currentRoom?.toUpperCase()} ({thisRoomPhotos.length})
          </div>
          <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
            {thisRoomPhotos.map((p) => (
              <div key={p.id} style={{ position: "relative", flexShrink: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt=""
                  title={`+${fmtMs(p.tsRelativeMs)}`}
                  style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6 }}
                />
                <div
                  style={{
                    position: "absolute",
                    bottom: 2,
                    left: 2,
                    fontSize: 11,
                    fontFamily: "Oswald",
                    background: "rgba(0,0,0,0.6)",
                    color: "#fff",
                    padding: "0 4px",
                    borderRadius: 3,
                  }}
                >
                  +{fmtMs(p.tsRelativeMs)}
                </div>
                <button
                  onClick={() => {
                    if (!currentRoom) return;
                    setRoomRecordings((prev) => {
                      const cur = prev[currentRoom];
                      if (!cur) return prev;
                      return {
                        ...prev,
                        [currentRoom]: { ...cur, photos: cur.photos.filter((x) => x.id !== p.id) },
                      };
                    });
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
                    fontSize: 13,
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

      {/* (Live transcript peek removed with the speech recognizer — checklist
          items tick by tap, and from the typed narration fallback below.) */}
      {!supported && (
        <div className="cd mb" style={{ padding: 10 }}>
          <div className="dim" style={{ fontSize: 13, marginBottom: 4, fontFamily: "Oswald", letterSpacing: ".06em" }}>
            TYPE YOUR NARRATION
          </div>
          <textarea
            value={pendingTyped}
            onChange={(e) => {
              setPendingTyped(e.target.value);
              // Mirror the typed text into the room's transcript so AI sees it.
              if (currentRoom) {
                setRoomRecordings((prev) => {
                  const cur = prev[currentRoom] || emptyRecording();
                  return {
                    ...prev,
                    [currentRoom]: { ...cur, transcript: e.target.value },
                  };
                });
                setTranscriptTick((t) => t + 1);
              }
            }}
            placeholder="The flooring is dirty, needs cleaning. The toilet runs after flushing. The sink leaks under the vanity..."
            style={{
              width: "100%",
              background: darkMode ? "#0d0d14" : "#f7f7fa",
              border: `1px dashed ${border}`,
              borderRadius: 8,
              padding: 8,
              minHeight: 70,
              fontSize: 14,
              color: "inherit",
              resize: "vertical",
            }}
          />
        </div>
      )}

      {/* PRIMARY ACTION: single-take Start/Stop, with Re-record after stop.
          Once the user stops, the recording is sealed — pause/resume is
          deliberately NOT supported because concatenating multiple
          MediaRecorder segments produces a malformed WebM/MP4 blob that
          Whisper can only decode the first segment of. To redo, the user
          taps Re-record (clears prior audio + transcript, keeps photos). */}
      <div className="cd mb" style={{ padding: 10, textAlign: "center" }}>
        {!inspecting && currentRec && currentRec.totalRecordedMs > 0 ? (
          <>
            <div style={{ fontSize: 16, fontFamily: "Oswald", color: "var(--color-success)", letterSpacing: ".04em" }}>
              ✓ Recorded {elapsedDisplay}
            </div>
            <button
              onClick={reRecord}
              className="bo"
              style={{ marginTop: 8, fontSize: 14, padding: "6px 14px" }}
            >
              ↻ Re-record (clears prior)
            </button>
            <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>
              Tap Done below to apply, or re-record to start over.
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => setInspecting((v) => !v)}
              style={{
                padding: "12px 28px",
                fontSize: 17,
                fontFamily: "Oswald",
                background: inspecting ? "var(--color-accent-red)" : "var(--color-success)",
                color: "#fff",
                borderRadius: 24,
                border: "none",
                animation: inspecting ? "vw-pulse 1.5s ease-in-out infinite" : "none",
                letterSpacing: ".04em",
                minWidth: 220,
              }}
            >
              {inspecting ? "■ Stop Recording" : "▶ Start Recording"}
            </button>
            <style>{`@keyframes vw-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }`}</style>
            <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>
              {inspecting
                ? "Mic + camera live. Talk through what you see, snap photos as you go."
                : "One continuous take per room — tap Stop when finished."}
            </div>
          </>
        )}
      </div>

      {/* Done — sticky above the bottom nav so the button is always
          visible regardless of how far the user has scrolled the
          checklist below the camera. Hands raw recording back to
          Inspector; Whisper + AI run there in the background while
          the user moves to the next room. */}
      <div className="sb">
        <button
          className="bb"
          onClick={finish}
          disabled={uploading > 0}
          style={{
            width: "100%",
            padding: 14,
            fontSize: 17,
            fontFamily: "Oswald",
            opacity: uploading > 0 ? 0.5 : 1,
          }}
        >
          ✓ Done — {isSingleRoom ? "Apply to Room" : "Process & Next Room"}
        </button>
        <p className="dim" style={{ fontSize: 13, textAlign: "center", marginTop: 4 }}>
          AI processes this room in the background. The next room opens immediately.
        </p>
      </div>
      {isSingleRoom && (
        <p className="dim" style={{ fontSize: 13, textAlign: "center", marginTop: 4 }}>
          Tap Done to transcribe and apply findings to this room.
        </p>
      )}
    </div>
  );
}
