/**
 * Camera torch / flash helpers, shared by the in-app camera (CameraModal) and
 * the Voice Walk camera.
 *
 * Web torch control is non-standard and very device-specific. The painful case
 * we hit in the field: multi-lens phones (e.g. Galaxy S23 Ultra) expose a
 * controllable `torch` capability on only ONE of their rear lenses, but the
 * lens `facingMode: "environment"` auto-selects is usually a different one — so
 * the flash button either doesn't appear or throws "not supported" on tap.
 * `findTorchDeviceId` works around that by probing each rear lens for one that
 * actually reports a torch, so the caller can switch to it.
 *
 * iOS Safari/WebKit has no web torch API at all, so everything here no-ops on
 * iOS and the flash button stays hidden there.
 */

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** True if the track reports a controllable torch capability. */
export function trackHasTorch(track: MediaStreamTrack | undefined): boolean {
  const caps = track?.getCapabilities?.() as
    | (MediaTrackCapabilities & { torch?: boolean })
    | undefined;
  return !!caps?.torch;
}

/**
 * Probe the device's rear cameras for one whose track exposes a torch and
 * return its deviceId (or null if none do / on iOS). Each probe stream is
 * opened briefly and stopped before returning. Requires camera permission to
 * already be granted (so device labels are populated) — call it only after a
 * stream is live.
 */
export async function findTorchDeviceId(): Promise<string | null> {
  if (isIOS()) return null;
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return null;
  }
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === "videoinput"
    );
    for (const cam of cams) {
      // Skip obvious front/selfie cameras — they never have a torch.
      if (/front|user|face|selfie/i.test(cam.label)) continue;
      let probe: MediaStream | null = null;
      try {
        probe = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: cam.deviceId } },
        });
        const has = trackHasTorch(probe.getVideoTracks()[0]);
        probe.getTracks().forEach((t) => t.stop());
        if (has) return cam.deviceId;
      } catch {
        probe?.getTracks().forEach((t) => t.stop());
      }
    }
  } catch {
    /* enumerate / permission issue — give up gracefully */
  }
  return null;
}
