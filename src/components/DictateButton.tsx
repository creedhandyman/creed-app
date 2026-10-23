"use client";
/**
 * Talk-it-through button: records the mic (MediaRecorder), sends it to
 * /api/transcribe (Whisper) and hands back the text — Quick Quote's voice
 * input. One tap starts, the next stops + transcribes. Stops on its own after
 * MAX_SECONDS. `stopRef` lets the parent stop it (e.g. before the camera
 * opens — iOS often refuses a second getUserMedia while the mic is live).
 */
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { apiFetch } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Icon } from "./Icon";

const MAX_SECONDS = 300;

function pickMime(): string {
  for (const c of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return "";
}

export default function DictateButton({
  onText,
  stopRef,
  label = "Talk it through",
}: {
  onText: (text: string) => void;
  stopRef?: MutableRefObject<(() => Promise<void>) | null>;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "rec" | "busy">("idle");
  const [secs, setSecs] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef<((v: void) => void) | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const release = () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const transcribe = async (blob: Blob) => {
    if (blob.size < 2000) { setState("idle"); return; } // a tap, not words
    setState("busy");
    try {
      const fd = new FormData();
      const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
      fd.append("audio", blob, `quick-quote.${ext}`);
      const res = await apiFetch("/api/transcribe", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      const text = String((data as { text?: string }).text || "").trim();
      if (!res.ok) useStore.getState().showToast(res.status === 503 ? "Voice typing isn't set up yet — type it instead." : "Couldn't hear that — try again or type it.", "warning");
      else if (!text) useStore.getState().showToast("Didn't catch any words — try again closer to the mic.", "warning");
      else onTextRef.current(text);
    } catch {
      useStore.getState().showToast("No connection — your recording wasn't sent. Type it instead.", "warning");
    } finally {
      setState("idle");
    }
  };

  const stop = (): Promise<void> => {
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") return Promise.resolve();
    return new Promise<void>((resolve) => {
      doneRef.current = resolve;
      rec.stop();
    });
  };

  const start = async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      useStore.getState().showToast("This phone can't record here — type it instead.", "warning");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        release();
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || mime || "audio/webm" });
        recRef.current = null;
        const done = doneRef.current; doneRef.current = null;
        await transcribe(blob);
        done?.();
      };
      rec.start(1000);
      recRef.current = rec;
      setSecs(0);
      setState("rec");
      tickRef.current = setInterval(() => {
        setSecs((s) => {
          if (s + 1 >= MAX_SECONDS) void stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      release();
      useStore.getState().showToast("Microphone blocked — allow it in your phone settings, or type it.", "warning");
    }
  };

  useEffect(() => {
    if (stopRef) stopRef.current = stop;
    return () => {
      if (stopRef) stopRef.current = null;
      const rec = recRef.current;
      if (rec && rec.state !== "inactive") { rec.onstop = null; rec.stop(); }
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mm = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <button
      type="button"
      className={state === "rec" ? "br" : "bo"}
      disabled={state === "busy"}
      onClick={() => (state === "rec" ? void stop() : state === "idle" ? void start() : undefined)}
      style={{ width: "100%", padding: "10px 12px", fontSize: 15, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}
      aria-label={state === "rec" ? "Stop recording" : label}
    >
      {state === "rec" ? (
        <>
          <style>{`@keyframes dict-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#fff", animation: "dict-pulse 1.5s ease-in-out infinite" }} />
          Recording {mm} — tap to stop
        </>
      ) : state === "busy" ? (
        <>Writing it down…</>
      ) : (
        <><Icon name="mic" size={16} /> {label}</>
      )}
    </button>
  );
}
