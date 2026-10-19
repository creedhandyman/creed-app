"use client";
import { useState, useEffect, useSyncExternalStore } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import {
  subscribeDrive, getDriveState, getServerDriveState, startDrive, finishDrive,
  cancelDrive, holdDrive, warmUpLocation, directionsUrl, type DriveTrip,
} from "@/lib/drive-tracker";
import { clockOf } from "@/lib/mileage-days";
import { Icon } from "./Icon";

/**
 * Work Mode's "Start drive": one tap starts mileage tracking AND opens
 * directions to the job in Maps. Tracking runs on the shared drive tracker
 * (lib/drive-tracker.ts), so it keeps its start point while Maps is in front
 * and picks the trip back up when you return. If GPS still couldn't measure
 * the drive, Stop asks for the miles (or odometer readings) instead of
 * silently logging nothing. A save that fails (no signal on the road) holds
 * the trip at its miles so the next tap saves it.
 */
export default function MileageQuickTrack({ job, address, hideIdle }: { job?: string; address?: string; hideIdle?: boolean }) {
  const user = useStore((s) => s.user)!;
  const { trip, error } = useSyncExternalStore(subscribeDrive, getDriveState, getServerDriveState);
  const [busy, setBusy] = useState(false);
  // Shown when Stop couldn't measure anything: log it by hand.
  const [manual, setManual] = useState<{ trip: DriveTrip; miles: string; startOdo: string; endOdo: string } | null>(null);

  // Have a fresh position ready, so Start has a start point even if Maps
  // takes over the screen before the next fix arrives.
  useEffect(() => { warmUpLocation(); }, []);

  const start = () => {
    if (trip) return;
    if (!startDrive(job || address || "")) {
      useStore.getState().showToast("This device can't share location", "error");
    }
  };

  /** true when the trip landed; a failed write was toasted by db.post. */
  const log = async (t: DriveTrip, miles: number, startOdo = 0, endOdo = 0): Promise<boolean> => {
    // LOCAL YYYY-MM-DD (toISOString is UTC — an evening trip landed on tomorrow).
    const now = new Date();
    const saved = await db.post("mileage", {
      user_id: user.id,
      user_name: user.name,
      job: t.job || job || "General",
      trip_date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
      start_time: t.startedAt ? clockOf(new Date(t.startedAt)) : null,
      start_miles: startOdo,
      end_miles: endOdo,
      total_miles: miles,
    });
    if (!saved) return false;
    useStore.getState().showToast(`Logged ${miles.toFixed(1)} mi`, "success");
    return true;
  };

  const stop = async () => {
    if (!trip || busy) return;
    setBusy(true);
    const res = await finishDrive();
    setBusy(false);
    if (!res) return;
    if (res.miles < 0.1) {
      setManual({ trip: res.trip, miles: "", startOdo: "", endOdo: "" });
      return;
    }
    // Offline / failed: hold the trip at these miles so Save can retry.
    if (!(await log(res.trip, res.miles))) holdDrive(res.trip, res.miles);
  };

  const saveManual = async () => {
    if (!manual) return;
    const s = parseFloat(manual.startOdo), e = parseFloat(manual.endOdo);
    const odo = !isNaN(s) && !isNaN(e) && e > s;
    const miles = odo ? Math.round((e - s) * 10) / 10 : parseFloat(manual.miles);
    if (!miles || miles <= 0) { useStore.getState().showToast("Enter the miles, or both odometer readings", "warning"); return; }
    if (await log(manual.trip, miles, odo ? s : 0, odo ? e : 0)) setManual(null);
  };

  const mapLink = (children: React.ReactNode, style: React.CSSProperties, onClick?: () => void) =>
    address ? (
      <a href={directionsUrl(address)} target="_blank" rel="noopener noreferrer" onClick={onClick} style={{ ...style, textDecoration: "none" }}>{children}</a>
    ) : (
      <button type="button" onClick={onClick} style={style}>{children}</button>
    );

  // ── render ────────────────────────────────────────────────────────────────

  if (manual) {
    return (
      <div style={{ padding: "10px 11px", borderRadius: 11, background: "rgba(255,170,0,.07)", border: "1px solid rgba(255,170,0,.4)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>GPS couldn&apos;t measure that drive</div>
        <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>Enter the miles, or your odometer readings.</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input type="number" inputMode="decimal" value={manual.miles} onChange={(e) => setManual({ ...manual, miles: e.target.value })} placeholder="Miles" style={{ flex: 1, minWidth: 0 }} />
          <span className="dim" style={{ fontSize: 12, alignSelf: "center" }}>or</span>
          <input type="number" inputMode="numeric" value={manual.startOdo} onChange={(e) => setManual({ ...manual, startOdo: e.target.value })} placeholder="Odo start" style={{ flex: 1, minWidth: 0 }} />
          <input type="number" inputMode="numeric" value={manual.endOdo} onChange={(e) => setManual({ ...manual, endOdo: e.target.value })} placeholder="Odo end" style={{ flex: 1, minWidth: 0 }} />
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="bo" onClick={() => setManual(null)} style={{ flex: 1, fontSize: 13, padding: "6px 0" }}>Skip</button>
          <button className="bg" onClick={saveManual} style={{ flex: 1, fontSize: 13, padding: "6px 0" }}>Log trip</button>
        </div>
      </div>
    );
  }

  if (!trip) {
    if (hideIdle) return null;
    return mapLink(
      <>
        <Icon name="navigation" size={15} color="#3ee08f" />
        Start drive{address ? " + map" : ""}
      </>,
      {
        width: "100%", display: "inline-flex", alignItems: "center",
        justifyContent: "center", gap: 7, boxSizing: "border-box",
        fontSize: 13.5, fontWeight: 600, fontFamily: "Oswald", letterSpacing: ".04em",
        padding: 9, borderRadius: 11, cursor: "pointer",
        color: "#3ee08f", background: "rgba(0,204,102,.1)", border: "1px solid rgba(0,204,102,.45)",
      },
      start,
    );
  }

  const located = (trip.fixes || 0) > 0;
  const held = !!trip.stopped;
  return (
    <div style={{
      padding: "8px 11px", borderRadius: 11,
      background: "rgba(0,204,102,.08)", border: "1px solid rgba(0,204,102,.4)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* live pulse dot */}
        <span style={{
          width: 9, height: 9, borderRadius: "50%",
          background: "var(--color-success)", boxShadow: "0 0 8px var(--color-success)",
          animation: held ? "none" : "dotLive 1.8s ease-in-out infinite", flexShrink: 0,
          opacity: held ? 0.5 : 1,
        }} />
        {/* live counter */}
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {held || trip.accMiles >= 0.1
            ? <>{trip.accMiles.toFixed(1)} <span style={{ fontWeight: 400, opacity: .7 }}>mi{held ? " · not saved yet" : ""}</span></>
            : <span style={{ opacity: .7 }}>{located ? "Tracking…" : "Finding your location…"}</span>}
          {trip.job
            ? <span style={{ fontWeight: 400, color: "var(--color-dim)", marginLeft: 5 }}>· {trip.job}</span>
            : null}
        </span>
        {address && !held && mapLink(
          <><Icon name="mapPin" size={12} color="#7fb6ff" /> Map</>,
          {
            fontSize: 12.5, fontWeight: 600, color: "#7fb6ff",
            background: "rgba(46,139,255,.12)", border: "1px solid rgba(46,139,255,.38)",
            borderRadius: 99, padding: "5px 10px", cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
          },
        )}
        {/* stop */}
        <button
          onClick={stop}
          disabled={busy}
          style={{
            fontSize: 12.5, fontWeight: 600, color: "#ff9d9d",
            background: "rgba(255,91,91,.12)", border: "1px solid rgba(255,91,91,.45)",
            borderRadius: 99, padding: "5px 11px", cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
          }}
        >
          {/* A held trip (save failed) isn't tracking — the button retries the save. */}
          <Icon name={busy ? "refresh" : held ? "check" : "stop"} size={12} color="#ff9d9d" /> {busy ? "Saving…" : held ? "Save" : "Stop"}
        </button>
        {/* cancel */}
        <button
          onClick={() => cancelDrive()}
          aria-label="Cancel drive"
          style={{
            background: "none", border: "none", color: "var(--color-dim)",
            cursor: "pointer", display: "inline-flex", padding: 2, flexShrink: 0,
          }}
        >
          <Icon name="close" size={13} />
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: "#ff9d9d", marginTop: 5 }}>{error}</div>}
    </div>
  );
}
