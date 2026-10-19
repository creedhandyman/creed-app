/**
 * One drive tracker for the whole app — Work Mode's "Start drive" and the
 * Mileage screen's GPS trip both run on it.
 *
 * Why it exists: the old Start Drive only counted miles from watchPosition
 * while the app was on screen, and never saved its start point. Tapping Start
 * then opening Maps put the PWA in the background (iOS stops GPS for a
 * backgrounded web app), so on return the first fix became the "start" and
 * Stop said "No movement detected".
 *
 * Now:
 *   - the START point is captured up front (a recent warm fix from when the
 *     screen opened, refined by a fresh fix) and persisted at once;
 *   - fixes keep coming from watchPosition AND a 20-second poll AND a fix on
 *     every return to the app, so a missed first check is retried;
 *   - a gap (app was in the background) adds the straight-line jump × the
 *     road factor;
 *   - Stop takes a final fix, and the logged miles are never less than the
 *     start→end straight line × road factor.
 * State lives in localStorage (`c_mileage_trip`) and in this module, so the
 * trip survives leaving the screen, locking the phone and closing the app.
 */
import { haversineMiles, ROAD_FACTOR, MAX_ACCURACY_M, MIN_SEGMENT_MI } from "./geo";

export const TRIP_KEY = "c_mileage_trip";

/** A fix worse than this is useless even as a start point. */
export const ANCHOR_MAX_ACC_M = 500;
/** Fixes this far apart in time mean the app was asleep in between. */
export const GAP_MS = 45_000;
/** After a gap, accept a rougher fix — it's all we'll get on return. */
const GAP_MAX_ACC_M = 250;
const M_PER_MI = 1609.344;
/** A warm fix older than this isn't trusted as the start point. */
const WARM_MAX_AGE_MS = 10 * 60_000;
const POLL_MS = 20_000;

export interface DriveFix { lat: number; lng: number; accuracy: number; at: number }

export interface DriveTrip {
  job: string;
  startedAt: string;
  /** optional starting odometer, as typed (Mileage screen) */
  startOdo?: string;
  accMiles: number;
  startLat: number | null;
  startLng: number | null;
  lastLat: number | null;
  lastLng: number | null;
  lastAcc?: number | null;
  lastAt?: number | null;
  /** fixes accepted so far — 0 = still looking for the start */
  fixes?: number;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Fold one GPS fix into the trip. Pure — returns the same object when the
 *  fix changes nothing. */
export function applyFix(trip: DriveTrip, fix: DriveFix): DriveTrip {
  if (!(fix.accuracy <= ANCHOR_MAX_ACC_M)) return trip;
  if (trip.lastLat == null || trip.lastLng == null) {
    return {
      ...trip,
      startLat: trip.startLat ?? fix.lat,
      startLng: trip.startLng ?? fix.lng,
      lastLat: fix.lat, lastLng: fix.lng, lastAcc: fix.accuracy, lastAt: fix.at,
      fixes: (trip.fixes || 0) + 1,
    };
  }
  const lastAcc = trip.lastAcc ?? MAX_ACCURACY_M;
  const d = haversineMiles(trip.lastLat, trip.lastLng, fix.lat, fix.lng);
  const dM = d * M_PER_MI;

  // A sharper fix inside the last one's error circle is the same spot, better
  // located — move the point (and the start, if nothing's been driven yet).
  if (fix.accuracy < lastAcc && dM <= lastAcc) {
    const moveStart = trip.accMiles === 0;
    return {
      ...trip,
      ...(moveStart ? { startLat: fix.lat, startLng: fix.lng } : {}),
      lastLat: fix.lat, lastLng: fix.lng, lastAcc: fix.accuracy, lastAt: fix.at,
      fixes: (trip.fixes || 0) + 1,
    };
  }

  const gap = trip.lastAt != null && fix.at - trip.lastAt > GAP_MS;
  if (fix.accuracy > (gap ? GAP_MAX_ACC_M : MAX_ACCURACY_M)) return trip;
  // GPS wander isn't driving: a step has to beat the noise of both fixes.
  const floor = Math.max(MIN_SEGMENT_MI, Math.min(fix.accuracy, lastAcc) / M_PER_MI);
  if (d < floor) return trip;
  return {
    ...trip,
    accMiles: round4(trip.accMiles + (gap ? d * ROAD_FACTOR : d)),
    lastLat: fix.lat, lastLng: fix.lng, lastAcc: fix.accuracy, lastAt: fix.at,
    fixes: (trip.fixes || 0) + 1,
  };
}

/** Final miles for a trip, given the fix taken at Stop (if any): the tracked
 *  path, but never less than start→end straight-line × road factor. */
export function finalMiles(trip: DriveTrip, end: DriveFix | null): { miles: number; hadStart: boolean } {
  let t = trip;
  // The stop fix is always "after a gap" in spirit — count it road-adjusted.
  if (end) t = applyFix(t, { ...end, at: Math.max(end.at, (t.lastAt ?? 0) + GAP_MS + 1) });
  const hadStart = t.startLat != null && t.startLng != null;
  const straight = hadStart && t.lastLat != null && t.lastLng != null
    ? haversineMiles(t.startLat!, t.startLng!, t.lastLat, t.lastLng) * ROAD_FACTOR
    : 0;
  return { miles: Math.round(Math.max(t.accMiles, straight) * 10) / 10, hadStart };
}

// ── Live tracker (browser singleton) ────────────────────────────────────────

export type DriveState = { trip: DriveTrip | null; error: string | null };

let state: DriveState = { trip: null, error: null };
let loaded = false;
let watchId: number | null = null;
let pollId: ReturnType<typeof setInterval> | null = null;
let warm: DriveFix | null = null;
const listeners = new Set<() => void>();

const hasGeo = () => typeof navigator !== "undefined" && "geolocation" in navigator;

function emit(next: DriveState) {
  state = next;
  listeners.forEach((l) => l());
}

function persist(trip: DriveTrip | null) {
  try {
    if (trip) localStorage.setItem(TRIP_KEY, JSON.stringify(trip));
    else localStorage.removeItem(TRIP_KEY);
  } catch { /* storage full / private mode */ }
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(TRIP_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as Partial<DriveTrip>;
    // Older shapes: the Mileage snapshot trip (start only) and the old quick
    // track (accMiles + last, no start).
    state = {
      error: null,
      trip: {
        job: s.job ?? "",
        startedAt: s.startedAt ?? new Date().toISOString(),
        startOdo: s.startOdo,
        accMiles: s.accMiles ?? 0,
        startLat: s.startLat ?? s.lastLat ?? null,
        startLng: s.startLng ?? s.lastLng ?? null,
        lastLat: s.lastLat ?? s.startLat ?? null,
        lastLng: s.lastLng ?? s.startLng ?? null,
        lastAcc: s.lastAcc ?? null,
        lastAt: s.lastAt ?? null,
        fixes: s.fixes ?? (s.startLat != null || s.lastLat != null ? 1 : 0),
      },
    };
  } catch { /* corrupt entry — ignore */ }
}

function onPosition(p: GeolocationPosition) {
  const fix: DriveFix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() };
  warm = fix;
  const cur = state.trip;
  if (!cur) return;
  const next = applyFix(cur, fix);
  if (next === cur && !state.error) return;
  persist(next);
  emit({ trip: next, error: null });
}

function onError(err: GeolocationPositionError) {
  // A timeout just means no fix yet — the poll keeps trying. Denied is real.
  if (err.code === 1) emit({ ...state, error: "Location access is off — turn it on to track miles" });
}

function checkNow() {
  if (!hasGeo() || !state.trip) return;
  navigator.geolocation.getCurrentPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 });
}

function onVisible() {
  if (document.visibilityState === "visible") checkNow();
}

function watch() {
  if (!hasGeo() || watchId !== null || !state.trip) return;
  watchId = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 });
  pollId = setInterval(checkNow, POLL_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pageshow", checkNow);
  window.addEventListener("focus", checkNow);
}

function unwatch() {
  if (watchId !== null && hasGeo()) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (pollId) clearInterval(pollId);
  pollId = null;
  if (typeof window !== "undefined") {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pageshow", checkNow);
    window.removeEventListener("focus", checkNow);
  }
}

export function subscribeDrive(fn: () => void): () => void {
  load();
  listeners.add(fn);
  watch(); // resume an in-progress trip after a reload / app restart
  return () => { listeners.delete(fn); };
}

export function getDriveState(): DriveState {
  load();
  return state;
}

const SERVER_STATE: DriveState = { trip: null, error: null };
export const getServerDriveState = () => SERVER_STATE;

/** Grab a position in the background so Start has a start point even if the
 *  app goes behind Maps before a fresh fix lands. Never prompts when the
 *  user has denied location. */
export function warmUpLocation() {
  if (!hasGeo()) return;
  if (warm && Date.now() - warm.at < 60_000) return;
  const go = () => navigator.geolocation.getCurrentPosition(
    (p) => { warm = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }; },
    () => { /* best effort */ },
    { enableHighAccuracy: true, maximumAge: 60_000, timeout: 15_000 },
  );
  const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
  if (perms?.query) {
    perms.query({ name: "geolocation" as PermissionName }).then((s) => { if (s.state !== "denied") go(); }).catch(go);
  } else go();
}

/** Start a drive. Synchronous on purpose: call it from the same tap that
 *  opens Maps, before the app is backgrounded. */
export function startDrive(job: string, opts: { startOdo?: string } = {}): boolean {
  load();
  if (state.trip) return true;
  if (!hasGeo()) { emit({ ...state, error: "This device can't share location" }); return false; }
  let trip: DriveTrip = {
    job, startedAt: new Date().toISOString(),
    ...(opts.startOdo ? { startOdo: opts.startOdo } : {}),
    accMiles: 0, startLat: null, startLng: null, lastLat: null, lastLng: null, lastAcc: null, lastAt: null, fixes: 0,
  };
  // Seed the start with a recent warm fix (stamped "now" so the fresh fix
  // that follows refines it instead of reading as a gap).
  if (warm && Date.now() - warm.at < WARM_MAX_AGE_MS) trip = applyFix(trip, { ...warm, at: Date.now() });
  persist(trip);
  emit({ trip, error: null });
  watch();
  checkNow();
  return true;
}

/** End the drive: one last fix (up to `timeoutMs`), stop watching, clear the
 *  saved trip, and return the miles. */
export async function finishDrive(timeoutMs = 10_000): Promise<{ trip: DriveTrip; miles: number; hadStart: boolean } | null> {
  load();
  const trip = state.trip;
  if (!trip) return null;
  const end = await new Promise<DriveFix | null>((resolve) => {
    if (!hasGeo()) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: timeoutMs },
    );
  });
  // Fixes may have landed while we waited.
  const latest = state.trip ?? trip;
  unwatch();
  persist(null);
  emit({ trip: null, error: null });
  return { trip: latest, ...finalMiles(latest, end) };
}

export function cancelDrive() {
  unwatch();
  persist(null);
  emit({ trip: null, error: null });
}

/** Directions to an address in Google Maps (opens the app on phones). */
export function directionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}
