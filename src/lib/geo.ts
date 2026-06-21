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
