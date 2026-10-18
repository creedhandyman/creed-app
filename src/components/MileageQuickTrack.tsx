"use client";
import { useState, useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { WaypointTracker } from "@/lib/geo";
import { clockOf } from "@/lib/mileage-days";
import { Icon } from "./Icon";
// Aliased: start()/restore below use a local `t` for the trip object.
import { t as tr } from "@/lib/i18n";

/**
 * Continuous-tracking start/stop mileage widget for Work Mode.
 * Uses watchPosition to accumulate real driven distance instead of a
 * straight-line start→end snapshot. Live mileage counter updates while
 * the screen is open; accumulated miles + last GPS fix are persisted to
 * localStorage so the total is preserved if the user switches screens and
 * back. Shares the `c_mileage_trip` key with the full Mileage screen.
 */
const TRIP_KEY = "c_mileage_trip";

interface GpsTrip {
  // Accumulated waypoint miles — the authoritative value written here.
  accMiles: number;
  lastLat: number | null;
  lastLng: number | null;
  job: string;
  startedAt: string;
  // Legacy compat — kept so the full Mileage screen can read startLat/startLng
  // when finishing a trip that was started here.
  startLat: number | null;
  startLng: number | null;
  /** Stop was tapped but the save failed (offline): the miles are held here,
   *  NOT tracking — a remount must not resume GPS from the old fix. */
  stopped?: boolean;
}

export default function MileageQuickTrack({ job }: { job?: string }) {
  const user = useStore((s) => s.user)!;
  const [trip, setTrip] = useState<GpsTrip | null>(null);
  const [liveMiles, setLiveMiles] = useState(0);
  const trackerRef = useRef<WaypointTracker | null>(null);

  // ── helpers ──────────────────────────────────────────────────────────────

  const persist = (t: GpsTrip, miles: number, lastFix: { lat: number; lng: number }) => {
    const updated: GpsTrip = { ...t, accMiles: miles, lastLat: lastFix.lat, lastLng: lastFix.lng };
    try { localStorage.setItem(TRIP_KEY, JSON.stringify(updated)); } catch { /* */ }
  };

  const makeTracker = (t: GpsTrip): WaypointTracker => {
    const initialFix = t.lastLat != null && t.lastLng != null
      ? { lat: t.lastLat, lng: t.lastLng }
      : null;
    return new WaypointTracker(
      (miles, lastFix) => {
        setLiveMiles(miles);
        persist(t, miles, lastFix);
      },
      t.accMiles,
      initialFix,
    );
  };

  // ── restore in-progress trip on mount ─────────────────────────────────────

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TRIP_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<GpsTrip> & {
        startLat?: number; startLng?: number; startOdo?: string;
      };
      // Migrate legacy format (no accMiles) to new shape.
      const t: GpsTrip = {
        accMiles: saved.accMiles ?? 0,
        lastLat: saved.lastLat ?? saved.startLat ?? null,
        lastLng: saved.lastLng ?? saved.startLng ?? null,
        startLat: saved.startLat ?? saved.lastLat ?? null,
        startLng: saved.startLng ?? saved.lastLng ?? null,
        job: saved.job ?? "",
        startedAt: saved.startedAt ?? new Date().toISOString(),
        stopped: saved.stopped,
      };
      setTrip(t);
      setLiveMiles(t.accMiles);
      if (t.stopped) return; // held for a retry save — don't track
      const tracker = makeTracker(t);
      tracker.start((msg) => useStore.getState().showToast(msg, "error"));
      trackerRef.current = tracker;
    } catch { /* corrupt entry — ignore */ }

    return () => { trackerRef.current?.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── actions ───────────────────────────────────────────────────────────────

  const start = () => {
    if (trip) return;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      useStore.getState().showToast("This device can't share location", "error");
      return;
    }
    const t: GpsTrip = {
      accMiles: 0, lastLat: null, lastLng: null,
      startLat: null, startLng: null,
      job: job || "", startedAt: new Date().toISOString(),
    };
    try { localStorage.setItem(TRIP_KEY, JSON.stringify(t)); } catch { /* */ }
    setTrip(t);
    setLiveMiles(0);

    const tracker = makeTracker(t);
    const ok = tracker.start((msg) => {
      useStore.getState().showToast(msg + " — allow location access", "error");
      // Clear the trip card so the user can retry.
      try { localStorage.removeItem(TRIP_KEY); } catch { /* */ }
      setTrip(null);
      setLiveMiles(0);
      trackerRef.current = null;
    });
    if (!ok) {
      useStore.getState().showToast("Location not supported on this device", "error");
      try { localStorage.removeItem(TRIP_KEY); } catch { /* */ }
      setTrip(null);
    } else {
      trackerRef.current = tracker;
    }
  };

  const stop = async () => {
    if (!trip) return;
    const miles = Math.round((trackerRef.current?.stop() ?? liveMiles) * 10) / 10;
    trackerRef.current = null;
    // What's stored carries the latest fix — kept so a failed save can put
    // the trip back instead of losing the miles.
    let stored: GpsTrip = trip;
    try {
      const raw = localStorage.getItem(TRIP_KEY);
      if (raw) stored = { ...trip, ...(JSON.parse(raw) as Partial<GpsTrip>) };
    } catch { /* corrupt entry — fall back to the in-memory trip */ }
    try { localStorage.removeItem(TRIP_KEY); } catch { /* */ }
    setTrip(null);
    setLiveMiles(0);

    if (miles < 0.1) {
      useStore.getState().showToast(tr("loc.noMovement"), "warning");
      return;
    }
    // LOCAL YYYY-MM-DD (toISOString is UTC — an evening trip landed on tomorrow).
    const now = new Date();
    const saved = await db.post("mileage", {
      user_id: user.id,
      user_name: user.name,
      job: trip.job || job || "General",
      trip_date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
      start_time: trip.startedAt ? clockOf(new Date(trip.startedAt)) : null,
      start_miles: 0,
      end_miles: 0,
      total_miles: miles,
    });
    if (!saved) {
      // Offline (common while driving) or failed — db.post already toasted.
      // Put the trip back, stopped at these miles, so Stop saves it again
      // (unless a new drive was started meanwhile).
      let free = true;
      try { free = !localStorage.getItem(TRIP_KEY); } catch { /* */ }
      if (free) {
        const kept: GpsTrip = { ...stored, accMiles: miles, stopped: true };
        try { localStorage.setItem(TRIP_KEY, JSON.stringify(kept)); } catch { /* */ }
        setTrip(kept);
        setLiveMiles(miles);
      }
      return;
    }
    useStore.getState().showToast(`Logged ${miles.toFixed(1)} mi`, "success");
  };

  const cancel = () => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    try { localStorage.removeItem(TRIP_KEY); } catch { /* */ }
    setTrip(null);
    setLiveMiles(0);
  };

  // ── render ────────────────────────────────────────────────────────────────

  if (!trip) {
    return (
      <button
        onClick={start}
        style={{
          width: "100%", display: "inline-flex", alignItems: "center",
          justifyContent: "center", gap: 7,
          fontSize: 13.5, fontWeight: 600, fontFamily: "Oswald", letterSpacing: ".04em",
          padding: 9, borderRadius: 11, cursor: "pointer",
          color: "#3ee08f", background: "rgba(0,204,102,.1)", border: "1px solid rgba(0,204,102,.45)",
        }}
      >
        <Icon name="mileage" size={15} color="#3ee08f" />
        Start drive
      </button>
    );
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "8px 11px",
      borderRadius: 11, background: "rgba(0,204,102,.08)", border: "1px solid rgba(0,204,102,.4)",
    }}>
      {/* live pulse dot */}
      <span style={{
        width: 9, height: 9, borderRadius: "50%",
        background: "var(--color-success)", boxShadow: "0 0 8px var(--color-success)",
        animation: trip.stopped ? "none" : "dotLive 1.8s ease-in-out infinite", flexShrink: 0,
        opacity: trip.stopped ? 0.5 : 1,
      }} />
      {/* live counter */}
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>
        {liveMiles >= 0.1
          ? <>{liveMiles.toFixed(1)} <span style={{ fontWeight: 400, opacity: .7 }}>mi</span></>
          : <span style={{ opacity: .7 }}>Acquiring GPS…</span>
        }
        {trip.job
          ? <span style={{ fontWeight: 400, color: "var(--color-dim)", marginLeft: 5 }}>· {trip.job}</span>
          : null}
      </span>
      {/* stop */}
      <button
        onClick={stop}
        style={{
          fontSize: 12.5, fontWeight: 600, color: "#ff9d9d",
          background: "rgba(255,91,91,.12)", border: "1px solid rgba(255,91,91,.45)",
          borderRadius: 99, padding: "5px 11px", cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
        }}
      >
        {/* A held trip (save failed) isn't tracking — the button just retries the save. */}
        <Icon name={trip.stopped ? "check" : "stop"} size={12} color="#ff9d9d" /> {trip.stopped ? "Save" : "Stop"}
      </button>
      {/* cancel */}
      <button
        onClick={cancel}
        aria-label="Cancel drive"
        style={{
          background: "none", border: "none", color: "var(--color-dim)",
          cursor: "pointer", display: "inline-flex", padding: 2, flexShrink: 0,
        }}
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}
