"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/lib/store";
import { ROOM_PRESETS } from "./screens/Inspector";
import { Icon } from "./Icon";

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
function dedupOverlap(prev: string, next: string): string {
  const p = prev.trim();
  const n = next.trim();
  if (!p) return n;
  if (!n) return "";
  const maxLen = Math.min(p.length, n.length);
  for (let len = maxLen; len > 0; len--) {
    if (p.endsWith(n.slice(0, len))) {
      return n.slice(len).trim();
    }
  }
  return n;
}

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
}

export default function VoiceWalk({ property, client: _client, rooms, onComplete, onCancel, darkMode, singleRoom, roomStatuses }: Props) {
  void property; void _client; // (used only by the parent's processRoomVoice now)
  const isSingleRoom = singleRoom || rooms.length === 1;

  // Refs that survive renders
  const fileFallbackRef = useRef<HTMLInputElement>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  // (Web Speech dedup refs removed — Whisper now owns the canonical
  // transcript and handles its own correctness. Web Speech only sets
  // liveInterim for the visual peek.)
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
  const [liveInterim, setLiveInterim] = useState(""); // interim words, replaced each event
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
  const finalsProcessedThroughRef = useRef(-1);
  const lastFinalTextRef = useRef("");

  const killRecognizer = (rec: SpeechRecognitionLike | null) => {
    if (!rec) return;
    try { (rec as unknown as { onstart: unknown }).onstart = null; } catch { /* */ }
    try { rec.onend = null; rec.onresult = null; rec.onerror = null; } catch { /* */ }
    try { rec.abort(); } catch { /* */ }
    try { rec.stop(); } catch { /* */ }
  };

  /** Append a final fragment from Web Speech onto the room's transcript
   *  so the auto-tick effect can read it during recording. Whisper
   *  overwrites this wholesale at end-of-room with the canonical text.
   */
  const appendLiveTranscript = useCallback((finalText: string) => {
    const room = currentRoomRef.current;
    if (!room || !finalText.trim()) return;
    setRoomRecordings((prev) => {
      const cur = prev[room] || emptyRecording();
      const sep = cur.transcript && !cur.transcript.endsWith(" ") ? " " : "";
      return {
        ...prev,
        [room]: { ...cur, transcript: cur.transcript + sep + finalText.trim() },
      };
    });
    setTranscriptTick((t) => t + 1);
  }, []);

  const startPreviewRecognition = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    killRecognizer(recogRef.current);
    recogRef.current = null;
    finalsProcessedThroughRef.current = -1;
    lastFinalTextRef.current = "";

    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e) => {
      if (recogRef.current !== r) return;
      // Walk every results entry, dedupe progressive supersets
      // (iOS quirk — see dedupOverlap), and append only NEW final
      // text past our watermark.
      let interim = "";
      let newFinalText = "";
      let highestFinalIdx = finalsProcessedThroughRef.current;
      let lastFinal = lastFinalTextRef.current;
      for (let i = 0; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0]?.transcript || "";
        if (result.isFinal) {
          if (i > finalsProcessedThroughRef.current) {
            const trimmed = text.trim();
            const toAdd = dedupOverlap(lastFinal, trimmed);
            if (toAdd) newFinalText += (newFinalText ? " " : "") + toAdd;
            if (
              trimmed.length > lastFinal.length ||
              !trimmed.startsWith(lastFinal.slice(0, Math.min(lastFinal.length, trimmed.length)))
            ) {
              lastFinal = trimmed;
            }
            if (i > highestFinalIdx) highestFinalIdx = i;
          }
        } else {
          interim += text;
        }
      }
      finalsProcessedThroughRef.current = highestFinalIdx;
      lastFinalTextRef.current = lastFinal;
      if (newFinalText) appendLiveTranscript(newFinalText);
      setLiveInterim(interim);
    };
    r.onend = () => {
      // No auto-restart. iOS will end the session after each utterance;
      // when that happens, the user just stops seeing live ticks. The
      // recording itself continues via MediaRecorder, and Whisper at
      // end-of-room fills in everything that was missed.
      if (recogRef.current === r) recogRef.current = null;
      setLiveInterim("");
    };
    r.onerror = (ev) => {
      if (ev.error && ev.error !== "no-speech" && ev.error !== "aborted") {
        console.warn("SpeechRecognition preview error:", ev.error);
      }
    };
    recogRef.current = r;
    try { r.start(); } catch { /* */ }
  }, [appendLiveTranscript]);

  const stopPreviewRecognition = useCallback(() => {
    const prev = recogRef.current;
    recogRef.current = null;
    killRecognizer(prev);
    setLiveInterim("");
  }, []);

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
      const stream = await navigator.mediaDevices.getUserMedia({
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
      setTorchAvailable(true);
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
      const settings = track.getSettings?.() as undefined | MediaTrackSettings & { torch?: boolean };
      if (settings && "torch" in settings && settings.torch !== next) {
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
      if (supported) startPreviewRecognition();
    } else {
      stopPreviewRecognition();
      stopCameraAndRecorder();
      endSegment();
    }
    return () => {
      stopPreviewRecognition();
      stopCameraAndRecorder();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspecting, supported]);

  // Force-pause when changing rooms; the new room starts cold.
  useEffect(() => {
    setInspecting(false);
    setLiveInterim("");
    setPendingTyped("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx]);

  /* ── Auto-tick checklist items as they're mentioned ──────────────── */
  useEffect(() => {
    if (!currentRoom) return;
    const rec = roomRecordings[currentRoom];
    const speechText = (rec?.transcript || "").toLowerCase();
    const fallbackText = supported ? "" : pendingTyped.toLowerCase();
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
  }, [currentRoom, transcriptTick, pendingTyped, supported, mentioned, roomRecordings]);

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
    setLiveInterim("");
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

  const items = currentRoom ? presetItemsFor(currentRoom) : [];
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
          onClick={() => { stopPreviewRecognition(); stopCameraAndRecorder(); onCancel(); }}
          title={uploading > 0 ? "Wait for photo upload to finish…" : "Cancel"}
          style={{ fontSize: 12, padding: "4px 8px", opacity: uploading > 0 ? 0.5 : 1 }}
        >← Cancel</button>
        <h2 style={{ fontSize: 18, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="mic" size={18} color="var(--color-primary)" strokeWidth={2} /> Voice Walk
        </h2>
        <span className="dim" style={{ fontSize: 11 }}>
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
            const total = presetItemsFor(r).length;
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
      )}

      {!supported && (
        <div
          className="cd mb"
          style={{ borderLeft: "3px solid var(--color-warning)", fontSize: 12 }}
        >
          <b style={{ color: "var(--color-warning)" }}>Voice not available</b>
          <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
            This browser doesn&apos;t support speech recognition. Type your narration in the box below; AI will use it the same way.
          </div>
        </div>
      )}

      {/* Room title — split from the checklist body so the camera can
          slot between them when inspecting. */}
      {currentRoom && (
        <div className="cd mb" style={{ padding: "10px 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ fontSize: 17, color: "var(--color-primary)", margin: 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
              {currentRoom}
              {currentRoom && roomStatuses?.[currentRoom] === "analyzing" && (
                <span style={{ fontSize: 11, color: "var(--color-highlight)", fontFamily: "Oswald" }}>· analyzing…</span>
              )}
              {currentRoom && roomStatuses?.[currentRoom] === "done" && (
                <span style={{ fontSize: 11, color: "var(--color-success)", fontFamily: "Oswald" }}>· done ✓</span>
              )}
            </h3>
            {items.length > 0 && (
              <span className="dim" style={{ fontSize: 11, fontFamily: "Oswald" }}>
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
          className="cd mb"
          style={{
            padding: 8,
            position: "sticky",
            top: 4,
            zIndex: 10,
            // Solid background so checklist rows can't show through.
            background: darkMode ? "#0a0a12" : "#fff",
            boxShadow: darkMode ? "0 2px 6px rgba(0,0,0,0.4)" : "0 2px 6px rgba(0,0,0,0.08)",
          }}
        >
          <div
            style={{
              position: "relative",
              background: "#000",
              borderRadius: 8,
              overflow: "hidden",
              aspectRatio: "4 / 3",
              marginBottom: 6,
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
            {/* Live recording indicator overlay */}
            <div
              style={{
                position: "absolute",
                top: 10,
                left: 10,
                background: "rgba(0,0,0,0.6)",
                color: "#fff",
                fontSize: 11,
                fontFamily: "Oswald",
                padding: "3px 8px",
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                gap: 5,
                letterSpacing: ".06em",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--color-accent-red)",
                  animation: "vw-pulse 1.5s ease-in-out infinite",
                }}
              />
              REC {elapsedDisplay}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={snapFromVideo}
              disabled={!cameraOn || uploading > 0}
              style={{
                flex: 1,
                padding: "12px",
                fontSize: 15,
                fontFamily: "Oswald",
                background: cameraOn ? "var(--color-primary)" : "#888",
                color: "#fff",
                borderRadius: 8,
                border: "none",
                opacity: cameraOn ? 1 : 0.5,
                letterSpacing: ".04em",
              }}
            >
              📸 Snap Photo
            </button>
            <button
              onClick={() => fileFallbackRef.current?.click()}
              className="bo"
              style={{ fontSize: 12, padding: "10px 12px" }}
              title="Pick from gallery instead"
            >
              📁
            </button>
          </div>
          {uploading > 0 && (
            <div style={{ fontSize: 11, color: "var(--color-primary)", marginTop: 6, textAlign: "center" }}>
              Uploading {uploading} photo{uploading === 1 ? "" : "s"}…
            </div>
          )}
        </div>
      )}

      {/* CHECKLIST BODY — beneath the (sticky) camera so the user can
          read every item while framing photos, no scroll-juggling.
          AI conditions/notes don't render here anymore — that's the
          parent's job (Inspector renders them once Whisper+AI complete
          in the background). VoiceWalk just shows the auto-tick state
          (mentioned-while-recording) so the user gets immediate
          visual feedback. */}
      {currentRoom && items.length > 0 && (
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
                        fontSize: 12,
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
      {currentRoom && items.length === 0 && (
        <div className="cd mb" style={{ padding: 10 }}>
          <div className="dim" style={{ fontSize: 12, fontStyle: "italic" }}>
            No standard checklist for this room — describe what you see.
          </div>
        </div>
      )}

      {/* This room's captured photos — small thumb strip */}
      {thisRoomPhotos.length > 0 && (
        <div className="cd mb" style={{ padding: 10 }}>
          <div className="dim" style={{ fontSize: 11, marginBottom: 6, fontFamily: "Oswald", letterSpacing: ".06em" }}>
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
                    fontSize: 9,
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

      {/* Live transcript — compact peek strip while inspecting (so it doesn't
          dominate the screen). Below this is the typed-fallback for browsers
          without speech support. */}
      {inspecting && supported && (
        <div
          className="cd mb"
          style={{
            padding: "6px 10px",
            background: darkMode ? "#0d0d14" : "#f7f7fa",
            border: `1px dashed ${border}`,
            fontSize: 11,
            color: "#888",
            display: "flex",
            alignItems: "center",
            gap: 6,
            minHeight: 28,
          }}
        >
          <span style={{ fontFamily: "Oswald", letterSpacing: ".06em", flexShrink: 0 }}>HEARING</span>
          <span style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: liveInterim || (currentRec?.transcript) ? "inherit" : "#888",
            fontStyle: liveInterim ? "italic" : "normal",
          }}>
            {liveInterim || currentRec?.transcript?.split(/\s+/).slice(-12).join(" ") || "Listening…"}
          </span>
        </div>
      )}
      {!supported && (
        <div className="cd mb" style={{ padding: 10 }}>
          <div className="dim" style={{ fontSize: 11, marginBottom: 4, fontFamily: "Oswald", letterSpacing: ".06em" }}>
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
              fontSize: 12,
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
            <div style={{ fontSize: 14, fontFamily: "Oswald", color: "var(--color-success)", letterSpacing: ".04em" }}>
              ✓ Recorded {elapsedDisplay}
            </div>
            <button
              onClick={reRecord}
              className="bo"
              style={{ marginTop: 8, fontSize: 12, padding: "6px 14px" }}
            >
              ↻ Re-record (clears prior)
            </button>
            <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
              Tap Done below to apply, or re-record to start over.
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => setInspecting((v) => !v)}
              style={{
                padding: "12px 28px",
                fontSize: 15,
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
            <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
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
            fontSize: 15,
            fontFamily: "Oswald",
            opacity: uploading > 0 ? 0.5 : 1,
          }}
        >
          ✓ Done — {isSingleRoom ? "Apply to Room" : "Process & Next Room"}
        </button>
        <p className="dim" style={{ fontSize: 11, textAlign: "center", marginTop: 4 }}>
          AI processes this room in the background. The next room opens immediately.
        </p>
      </div>
      {isSingleRoom && (
        <p className="dim" style={{ fontSize: 11, textAlign: "center", marginTop: 4 }}>
          Tap Done to transcribe and apply findings to this room.
        </p>
      )}
    </div>
  );
}
