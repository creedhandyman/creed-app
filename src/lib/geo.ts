/**
 * Geolocation helpers for GPS-based mileage tracking.
 *
 * Browser-only — every function guards against a missing `navigator` so
 * importing this file during SSR is safe. Distances are in MILES (the app's
 * unit everywhere mileage shows up).
 */

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number; // meters (lower = better)
}

const EARTH_RADIUS_MI = 3958.7613;

/** Great-circle (haversine) distance between two lat/lng points, in miles. */
export function haversineMiles(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  // Math.min guards against tiny FP overshoot pushing asin's arg past 1.
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Straight-line distance underestimates real driving distance (roads curve,
 * one-ways, detours). The industry rule of thumb is ~1.3–1.4×. We apply this
 * ONLY to the start→end straight-line fallback — the live watchPosition path
 * is already a sum of road-following segments and needs no correction.
 */
export const ROAD_FACTOR = 1.3;

// ── Waypoint tracking ────────────────────────────────────────────────────────
// Ignore GPS fixes whose reported accuracy is worse than this (noisy urban fix).
export const MAX_ACCURACY_M = 80;
// Only add a new waypoint if the device moved at least this far from the last
// one. Filters stationary GPS jitter (~3–15m wander) without swallowing real
// driving segments (a car covers ~15m in under a second at 35 mph).
export const MIN_SEGMENT_MI = 0.020; // ≈ 32 m

/**
 * Continuous-tracking mileage accumulator using `watchPosition`. Fires on each
 * qualifying GPS fix and keeps a running sum of the actual path driven —
 * captures turns, detours, and real road geometry, no fudge factor needed.
 *
 * Usage:
 *   const t = new WaypointTracker((miles, fix) => persist(miles, fix), 0, null);
 *   t.start(onPermissionDenied);
 *   ...
 *   const finalMiles = t.stop();
 */
export class WaypointTracker {
  private watchId: number | null = null;
  private lastFix: { lat: number; lng: number } | null;
  private _miles: number;
  private _onUpdate: (miles: number, lastFix: { lat: number; lng: number }) => void;

  constructor(
    onUpdate: (miles: number, lastFix: { lat: number; lng: number }) => void,
    initialMiles = 0,
    initialFix: { lat: number; lng: number } | null = null,
  ) {
    this._miles = initialMiles;
    this.lastFix = initialFix;
    this._onUpdate = onUpdate;
  }

  get miles() { return this._miles; }

  start(onError?: (msg: string) => void): boolean {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return false;
    this.watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (coords.accuracy > MAX_ACCURACY_M) return;
        const fix = { lat: coords.latitude, lng: coords.longitude };
        if (this.lastFix) {
          const seg = haversineMiles(this.lastFix.lat, this.lastFix.lng, fix.lat, fix.lng);
          if (seg >= MIN_SEGMENT_MI) {
            this._miles = Math.round((this._miles + seg) * 10000) / 10000;
            this.lastFix = fix;
            this._onUpdate(this._miles, fix);
          }
        } else {
          this.lastFix = fix;
        }
      },
      (err) => {
        if (onError) onError(err.code === 1 ? "Location access denied" : "GPS unavailable");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );
    return true;
  }

  stop(): number {
    if (this.watchId !== null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    return this._miles;
  }
}

// ── One-shot fix ─────────────────────────────────────────────────────────────
/**
 * One-shot current position as a promise. Resolves `null` on denial / error /
 * timeout / unsupported (never rejects) so callers can branch with a simple
 * `if (!fix)` instead of try/catch.
 */
export function getFix(timeoutMs = 10000): Promise<Fix | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs }
    );
  });
}
