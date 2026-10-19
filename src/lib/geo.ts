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
 * one-ways, detours). The industry rule of thumb is ~1.3–1.4×. Applied to
 * straight-line estimates only — suggested trips, and the drive tracker's
 * jumps across a gap (app in the background) and its start→end floor. Its
 * continuous fixes already follow the road and need no correction.
 */
export const ROAD_FACTOR = 1.3;

// ── Drive tracking thresholds (lib/drive-tracker.ts) ─────────────────────────
// Ignore GPS fixes whose reported accuracy is worse than this (noisy urban fix).
export const MAX_ACCURACY_M = 80;
// Only add a new waypoint if the device moved at least this far from the last
// one. Filters stationary GPS jitter (~3–15m wander) without swallowing real
// driving segments (a car covers ~15m in under a second at 35 mph).
export const MIN_SEGMENT_MI = 0.020; // ≈ 32 m

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

// ── Address geocoding (OpenStreetMap Nominatim, no API key) ────────────────
// Cached FOREVER per address in localStorage, so each address costs one
// request per device, ever. Callers looping over multiple UNCACHED addresses
// must throttle to ~1 req/s (Nominatim usage policy) — see hasGeocodeCache.

// "c_geo2_": v1 entries were built from BARE street-address queries against
// global Nominatim ("1912 N Chautauqua Ave" with no city), which can resolve
// to a same-named street in another state — and the forever-cache then keeps
// serving the wrong coordinates. The prefix bump orphans those; addresses
// re-geocode once (throttled) with city context and cache cleanly.
const geocodeCacheKey = (addr: string) =>
  "c_geo2_" + addr.toLowerCase().replace(/[^\w]/g, "").slice(0, 60);

export function hasGeocodeCache(addr: string): boolean {
  try { return !!localStorage.getItem(geocodeCacheKey(addr)); } catch { return false; }
}

/** City/state tail of a full address ("440 N Main St, Wichita, KS 67202" →
 *  "Wichita, KS 67202"). Callers pass this as geocodeAddress's context so
 *  bare job addresses search anchored to the org's own city. */
export function cityContext(fullAddr?: string | null): string {
  const s = (fullAddr || "").trim();
  const i = s.indexOf(",");
  return i > 0 ? s.slice(i + 1).trim() : "";
}

export async function geocodeAddress(addr: string, context?: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const cached = localStorage.getItem(geocodeCacheKey(addr));
    if (cached) return JSON.parse(cached);
  } catch { /* cache miss */ }
  // Bare street addresses search terribly on global Nominatim — either
  // nothing comes back, or a same-named street in another city does (and a
  // wrong hit would poison the forever-cache). When the caller supplies a
  // city/state context and the address doesn't already carry one, query
  // WITH the context first and fall back to the raw string.
  const queries = context && !addr.includes(",") ? [`${addr}, ${context}`, addr] : [addr];
  for (const q of queries) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) continue;
      const rows = (await res.json()) as { lat?: string; lon?: string }[];
      const hit = rows?.[0];
      if (!hit?.lat || !hit?.lon) continue;
      const out = { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) };
      try { localStorage.setItem(geocodeCacheKey(addr), JSON.stringify(out)); } catch { /* */ }
      return out;
    } catch { /* try next query form */ }
  }
  return null;
}

/** Rough city-driving ETA from an estimated road distance (~28 mph avg). */
export function driveMinutes(miles: number): number {
  return Math.max(1, Math.round((miles / 28) * 60));
}
