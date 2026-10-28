/**
 * Foreground location heartbeat — where the crew is NOW, not only where they
 * last clocked in/out.
 *
 * While this phone is ON THE CLOCK (the shared Timer/WorkVision clock state:
 * lib/clock readLocalClock: on + an active row id) AND the app is on screen, take a
 * one-shot fix (geo.getFix) every ~4 minutes and on each return to the app,
 * and upsert it into `crew_locations` (one row per user; the server stamps the
 * time). Owners/managers read those rows for Dispatch's "Crew right now",
 * Crew Map and the Jobs closest-tech hint.
 *
 * Never tracks off the clock, in the background (iOS can't anyway) or after
 * sign-out: every send re-checks the clock + the user after the fix lands, and
 * RLS refuses a row from anyone without an open shift. Fixes worse than
 * ~100 m are dropped. Only a location permission the user ALREADY granted
 * (at clock-in) is used — the heartbeat never pops a permission prompt.
 *
 * Best-effort and silent: Supabase is called directly (no db.* toasts), and
 * until the crew_locations migration runs the table is probed, marked missing
 * for an hour (remembered across launches) and nothing is sent. Rules + timing
 * knobs are in lib/crew-location (tested).
 *
 * Started by AppShell (useCrewHeartbeat); `useLocationSharing` drives the
 * "Sharing location while on the clock" line in Time and Work mode.
 */
import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "./supabase";
import { getFix } from "./geo";
import { readLocalClock } from "./clock";
import { heartbeatDue, usableFix, isMissingTableError, CHECK_MS, TABLE_RETRY_MS } from "./crew-location";

const MISSING_KEY = "c_crewloc_missing_until";

type Perm = "granted" | "denied" | "prompt" | "unknown";

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;
let lastAt = 0;
let perm: Perm = "unknown";
let permStatus: PermissionStatus | null = null;
let table: "unknown" | "ok" | "missing" = "unknown";
let missingUntil = 0;
let available = false;
const listeners = new Set<() => void>();

function ld<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem("c_" + key) || "null") as T | null; } catch { return null; }
}

/** The shared clock state Timer + WorkVision write. */
function clockState(): { on: boolean; clockInAt: number | null } {
  const c = readLocalClock();
  return { on: c.on && !!c.activeId, clockInAt: c.st };
}

function me(): { id: string; org_id: string } | null {
  const u = ld<{ id?: string; org_id?: string }>("user");
  return u?.id && u.org_id ? { id: u.id, org_id: u.org_id } : null;
}

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

function publish() {
  if (table === "missing" && Date.now() >= missingUntil) table = "unknown";
  const next = perm !== "denied" && perm !== "prompt" && table !== "missing";
  if (next === available) return;
  available = next;
  listeners.forEach((fn) => fn());
}

function markMissing() {
  table = "missing";
  missingUntil = Date.now() + TABLE_RETRY_MS;
  try { localStorage.setItem(MISSING_KEY, String(missingUntil)); } catch { /* */ }
  publish();
}

/** Is crew_locations there? (One tiny read; no GPS.) */
async function probe(): Promise<typeof table> {
  try {
    const { error } = await supabase.from("crew_locations").select("user_id").limit(0);
    if (!error) {
      table = "ok";
      try { localStorage.removeItem(MISSING_KEY); } catch { /* */ }
    } else if (isMissingTableError(error)) {
      markMissing();
    }
  } catch { /* offline — ask again next check */ }
  return table;
}

async function beat(trigger: "tick" | "return") {
  publish();
  if (!running || busy || table === "missing" || perm === "denied" || perm === "prompt") return;
  const who = me();
  const c = clockState();
  if (!who || !c.on || !visible()) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  busy = true;
  try {
    if (table === "unknown" && (await probe()) !== "ok") return;
    const now = Date.now();
    if (!heartbeatDue({ clockedIn: c.on, visible: visible(), now, lastAt, clockInAt: c.clockInAt, trigger })) return;
    lastAt = now;
    const fix = await getFix(10000);
    if (!usableFix(fix)) return;
    // Clocked out, signed out or switched away while the fix came in → drop it.
    const who2 = me();
    if (!running || !clockState().on || !who2 || who2.id !== who.id || !visible()) return;
    const { error } = await supabase.from("crew_locations").upsert(
      { user_id: who.id, org_id: who.org_id, lat: fix.lat, lng: fix.lng, acc: Math.round(fix.accuracy) },
      { onConflict: "user_id" },
    );
    if (error && isMissingTableError(error)) markMissing();
  } catch { /* best-effort — the next check tries again */ } finally {
    busy = false;
  }
}

async function watchPermission() {
  try {
    const st = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (!st || !running) return;
    permStatus = st;
    perm = st.state as Perm;
    publish();
    st.onchange = () => {
      perm = st.state as Perm;
      publish();
      if (perm === "granted") void beat("return");
    };
  } catch { /* no Permissions API (older browsers) — getFix just fails if denied */ }
}

const onReturn = () => { if (visible()) void beat("return"); };

export function startHeartbeat() {
  if (running || typeof window === "undefined") return;
  running = true;
  lastAt = 0;
  try {
    const until = Number(localStorage.getItem(MISSING_KEY) || 0);
    if (until > Date.now()) { table = "missing"; missingUntil = until; }
  } catch { /* */ }
  publish();
  void watchPermission();
  timer = setInterval(() => void beat("tick"), CHECK_MS);
  document.addEventListener("visibilitychange", onReturn);
  window.addEventListener("pageshow", onReturn);
  void beat("return"); // opening the app counts as a return
}

export function stopHeartbeat() {
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
  if (typeof window !== "undefined") {
    document.removeEventListener("visibilitychange", onReturn);
    window.removeEventListener("pageshow", onReturn);
  }
  if (permStatus) permStatus.onchange = null;
  permStatus = null;
}

/** Run the heartbeat while signed in to an org (AppShell). */
export function useCrewHeartbeat(active: boolean) {
  useEffect(() => {
    if (!active) return;
    startHeartbeat();
    return stopHeartbeat;
  }, [active]);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** True when this phone shares its location while on the clock (permission
 *  granted or not yet known, table there). Combine with the screen's own
 *  clocked-in state. */
export function useLocationSharing(): boolean {
  return useSyncExternalStore(subscribe, () => available, () => false);
}
