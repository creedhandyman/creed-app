"use client";
import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { haversineMiles, getFix, ROAD_FACTOR } from "@/lib/geo";
import { Icon } from "./Icon";

/**
 * Simple start/stop drive-mileage tracker for Work Mode. Reuses the GPS
 * snapshot approach + data model of the full Mileage screen: tap Start to
 * stamp your location (persisted to localStorage so the phone can lock and
 * Maps can open), tap Stop on arrival to log start→end straight-line ×
 * ROAD_FACTOR miles to the `mileage` table, attributed to the current job.
 * Shares the `c_mileage_trip` key so there's ONE in-progress trip across the
 * whole app (start here, or finish on the Mileage screen — same trip).
 */
const TRIP_KEY = "c_mileage_trip";
interface GpsTrip {
  startLat: number;
  startLng: number;
  startOdo: string;
  job: string;
  startedAt: string;
}

export default function MileageQuickTrack({ job }: { job?: string }) {
  const user = useStore((s) => s.user)!;
  const [trip, setTrip] = useState<GpsTrip | null>(null);
  const [busy, setBusy] = useState(false);

  // Restore an in-progress trip (started here or on the Mileage screen).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TRIP_KEY);
      if (raw) setTrip(JSON.parse(raw) as GpsTrip);
    } catch { /* ignore a corrupt entry */ }
  }, []);

  const start = async () => {
    if (busy || trip) return;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      useStore.getState().showToast("This device can't share location", "error");
      return;
    }
    setBusy(true);
    const fix = await getFix();
    setBusy(false);
    if (!fix) {
      useStore.getState().showToast("Couldn't get your location — allow location access", "error");
      return;
    }
    const t: GpsTrip = {
      startLat: fix.lat, startLng: fix.lng, startOdo: "",
      job: job || "", startedAt: new Date().toISOString(),
    };
    try { localStorage.setItem(TRIP_KEY, JSON.stringify(t)); } catch { /* */ }
    setTrip(t);
  };

  const stop = async () => {
    if (!trip || busy) return;
    setBusy(true);
    const fix = await getFix(12000);
    setBusy(false);
    if (!fix) {
      useStore.getState().showToast("Couldn't get your location — try again", "error");
      return;
    }
    const miles = Math.round(
      haversineMiles(trip.startLat, trip.startLng, fix.lat, fix.lng) * ROAD_FACTOR * 10
    ) / 10;
    try { localStorage.removeItem(TRIP_KEY); } catch { /* */ }
    setTrip(null);
    if (miles < 0.1) {
      useStore.getState().showToast("No movement detected — nothing logged", "warning");
      return;
    }
    await db.post("mileage", {
      user_id: user.id,
      user_name: user.name,
      job: trip.job || job || "General",
      trip_date: new Date().toISOString().split("T")[0],
      start_miles: 0,
      end_miles: 0,
      total_miles: miles,
    });
    useStore.getState().showToast(`Logged ${miles.toFixed(1)} mi`, "success");
  };

  const cancel = () => {
    try { localStorage.removeItem(TRIP_KEY); } catch { /* */ }
    setTrip(null);
  };

  if (!trip) {
    return (
      <button
        onClick={start}
        disabled={busy}
        style={{
          width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
          fontSize: 13.5, fontWeight: 600, fontFamily: "Oswald", letterSpacing: ".04em",
          padding: 9, borderRadius: 11, cursor: busy ? "wait" : "pointer",
          color: "#3ee08f", background: "rgba(0,204,102,.1)", border: "1px solid rgba(0,204,102,.45)",
        }}
      >
        <Icon name={busy ? "refresh" : "mileage"} size={15} color="#3ee08f" />
        {busy ? "Getting location…" : "Start drive"}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", borderRadius: 11, background: "rgba(0,204,102,.08)", border: "1px solid rgba(0,204,102,.4)" }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--color-success)", boxShadow: "0 0 8px var(--color-success)", animation: "dotLive 1.8s ease-in-out infinite", flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        Tracking drive{trip.job ? ` · ${trip.job}` : ""}
      </span>
      <button
        onClick={stop}
        disabled={busy}
        style={{ fontSize: 12.5, fontWeight: 600, color: "#ff9d9d", background: "rgba(255,91,91,.12)", border: "1px solid rgba(255,91,91,.45)", borderRadius: 99, padding: "5px 11px", cursor: busy ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0 }}
      >
        <Icon name={busy ? "refresh" : "stop"} size={12} color="#ff9d9d" /> {busy ? "…" : "Stop"}
      </button>
      <button onClick={cancel} aria-label="Cancel drive" style={{ background: "none", border: "none", color: "var(--color-dim)", cursor: "pointer", display: "inline-flex", padding: 2, flexShrink: 0 }}>
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}
