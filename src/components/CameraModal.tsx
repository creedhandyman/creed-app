"use client";
/**
 * CameraModal — the app's single, shared in-app camera.
 *
 * Full-screen live-preview camera (rear-facing by default) with a shutter,
 * flash toggle, front/back flip, and a "choose from library" fallback for
 * desktop or when camera permission is denied. It does NOT upload anything —
 * it hands the captured/selected image(s) back as JPEG `File`s via
 * `onCapture`, so each screen keeps its own upload + AI logic.
 *
 * The getUserMedia handling (single audio-less video call, iOS playsInline,
 * torch via applyConstraints) mirrors the proven VoiceWalk camera so the
 * known iOS Safari quirks stay handled in one place.
 *
 * Usage:
 *   const [camOpen, setCamOpen] = useState(false);
 *   <CameraModal open={camOpen} onClose={() => setCamOpen(false)}
 *     onCapture={(files) => files.forEach(handleFile)} title="Receipt" />
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useStore } from "@/lib/store";

export interface CameraModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Fired with the freshly captured / picked image File(s). In single mode
   * the modal closes itself right after each fire; in `multiple` mode it stays
   * open so the user can keep shooting (uploads can stream in per shot).
   */
  onCapture: (files: File[]) => void;
  /** Keep the camera open after each shot + show a count + Done bar. */
  multiple?: boolean;
  /** Offer a "Choose from library" fallback (also the desktop / denied path). */
  allowLibrary?: boolean;
  /** Header label, e.g. "Receipt" or "Quick Quote photo". */
  title?: string;
  /** Longest-edge cap for the saved JPEG. Default 1600. */
  maxSize?: number;
  /** JPEG quality 0–1. Default 0.8. */
  quality?: number;
}

type Facing = "environment" | "user";

export function CameraModal({
  open,
  onClose,
  onCapture,
  multiple = false,
  allowLibrary = true,
  title = "Take a photo",
  maxSize = 1600,
  quality = 0.8,
}: CameraModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<Facing>("environment");
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [busy, setBusy] = useState(false); // mid-capture (encoding)
  const [shotCount, setShotCount] = useState(0);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
    setTorchOn(false);
    setTorchAvailable(false);
  }, []);

  const startStream = useCallback(async (mode: Facing) => {
    setError(null);
    setReady(false);
    // Tear down any prior stream first (e.g. when flipping cameras).
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        await videoRef.current.play().catch(() => {});
      }
      // Torch only exists on some rear cameras (mostly Android). Probe caps
      // so we hide the button when it would do nothing.
      const track = stream.getVideoTracks()[0];
      const caps = track?.getCapabilities?.() as
        | (MediaTrackCapabilities & { torch?: boolean })
        | undefined;
      setTorchAvailable(!!caps?.torch);
      setReady(true);
    } catch (err) {
      console.warn("Camera unavailable:", err);
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Camera permission denied."
          : "Camera unavailable on this device."
      );
    }
  }, []);

  // Open / close lifecycle. We key only off `open` so the stream isn't torn
  // down and rebuilt on unrelated re-renders; `facing` restarts go through
  // flipCamera() explicitly.
  useEffect(() => {
    if (open) {
      setShotCount(0);
      setFacing("environment");
      startStream("environment");
    } else {
      stopStream();
    }
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const flipCamera = useCallback(() => {
    const next: Facing = facing === "environment" ? "user" : "environment";
    setFacing(next);
    startStream(next);
  }, [facing, startStream]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await (
        track.applyConstraints as (
          c: MediaTrackConstraints & { advanced?: Array<{ torch?: boolean }> }
        ) => Promise<void>
      )({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
      setTorchOn(false);
      useStore.getState().showToast("Flash not supported on this device", "info");
    }
  }, [torchOn]);

  // Downscale + re-encode any image blob/File to a bounded JPEG File.
  const toFile = useCallback(
    (blob: Blob): Promise<File> =>
      new Promise((resolve) => {
        const name = `photo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          let w = img.width;
          let h = img.height;
          if (w > maxSize || h > maxSize) {
            if (w > h) {
              h = Math.round((h * maxSize) / w);
              w = maxSize;
            } else {
              w = Math.round((w * maxSize) / h);
              h = maxSize;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
          canvas.toBlob(
            (b) => resolve(new File([b || blob], name, { type: "image/jpeg" })),
            "image/jpeg",
            quality
          );
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(new File([blob], name, { type: "image/jpeg" }));
        };
        img.src = url;
      }),
    [maxSize, quality]
  );

  const snap = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      useStore.getState().showToast("Camera not ready yet", "warning");
      return;
    }
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      const raw = await new Promise<Blob | null>((res) =>
        canvas.toBlob((b) => res(b), "image/jpeg", 0.92)
      );
      if (raw) {
        const file = await toFile(raw);
        onCapture([file]);
        setShotCount((c) => c + 1);
      }
    } finally {
      setBusy(false);
    }
    if (!multiple) onClose();
  }, [multiple, onCapture, onClose, toFile]);

  const onLibraryPick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (e.target) e.target.value = "";
      if (!files.length) return;
      setBusy(true);
      try {
        const out = await Promise.all(files.map((f) => toFile(f)));
        onCapture(out);
        setShotCount((c) => c + out.length);
      } finally {
        setBusy(false);
      }
      if (!multiple) onClose();
    },
    [multiple, onCapture, onClose, toFile]
  );

  if (!open) return null;

  const circleBtn: React.CSSProperties = {
    width: 44,
    height: 44,
    borderRadius: "50%",
    border: "none",
    background: "rgba(0,0,0,0.55)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  };

  return (
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
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px",
          color: "#fff",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close camera"
          style={{ ...circleBtn, width: 38, height: 38, background: "rgba(255,255,255,0.12)" }}
        >
          <Icon name="close" size={20} color="#fff" />
        </button>
        <div style={{ fontFamily: "Oswald", fontSize: 15, letterSpacing: ".04em" }}>{title}</div>
        {torchAvailable ? (
          <button
            onClick={toggleTorch}
            aria-label={torchOn ? "Turn flash off" : "Turn flash on"}
            style={{
              ...circleBtn,
              width: 38,
              height: 38,
              background: torchOn ? "rgba(255,204,0,0.95)" : "rgba(255,255,255,0.12)",
            }}
          >
            <Icon name="flash" size={18} color={torchOn ? "#1a1a1a" : "#fff"} />
          </button>
        ) : (
          <div style={{ width: 38 }} />
        )}
      </div>

      {/* Preview / error */}
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          background: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
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
            display: error ? "none" : "block",
          }}
        />
        {error && (
          <div style={{ textAlign: "center", color: "#ddd", padding: 28, maxWidth: 320 }}>
            <Icon name="camera" size={34} color="#666" />
            <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.5 }}>{error}</div>
            {allowLibrary && (
              <button
                className="bb"
                onClick={() => libraryRef.current?.click()}
                style={{ marginTop: 16 }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Icon name="photo" size={16} /> Choose from library
                </span>
              </button>
            )}
          </div>
        )}
        {!error && !ready && (
          <div style={{ position: "absolute", color: "#bbb", fontSize: 13 }}>Starting camera…</div>
        )}
      </div>

      {/* Controls */}
      {!error && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 28px calc(22px + env(safe-area-inset-bottom, 0px))",
            flexShrink: 0,
          }}
        >
          {/* Left: library */}
          <div style={{ width: 56, display: "flex", justifyContent: "flex-start" }}>
            {allowLibrary && (
              <button onClick={() => libraryRef.current?.click()} aria-label="Choose from library" style={circleBtn}>
                <Icon name="photo" size={20} color="#fff" />
              </button>
            )}
          </div>

          {/* Center: shutter */}
          <button
            onClick={snap}
            disabled={!ready || busy}
            aria-label="Take photo"
            style={{
              width: 74,
              height: 74,
              borderRadius: "50%",
              border: "4px solid rgba(255,255,255,0.85)",
              background: busy ? "rgba(255,255,255,0.4)" : "#fff",
              cursor: ready && !busy ? "pointer" : "default",
              opacity: ready ? 1 : 0.5,
              boxShadow: "0 0 0 2px rgba(0,0,0,0.4)",
            }}
          />

          {/* Right: flip + (multiple) done */}
          <div style={{ width: 56, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <button onClick={flipCamera} aria-label="Switch camera" style={circleBtn}>
              <Icon name="flipCamera" size={20} color="#fff" />
            </button>
            {multiple && shotCount > 0 && (
              <button
                onClick={onClose}
                className="bg"
                style={{ fontSize: 12, padding: "6px 12px", whiteSpace: "nowrap" }}
              >
                Done ({shotCount})
              </button>
            )}
          </div>
        </div>
      )}

      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        style={{ display: "none" }}
        onChange={onLibraryPick}
      />
    </div>
  );
}

export default CameraModal;
