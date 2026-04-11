"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";

interface MileageEntry {
  id: string;
  job: string;
  trip_date: string;
  start_miles: number;
  end_miles: number;
  total_miles: number;
  user_name: string;
}

interface Props {
  setPage: (p: string) => void;
}

export default function Mileage({ setPage }: Props) {
  const user = useStore((s) => s.user)!;
  const jobs = useStore((s) => s.jobs);
  const darkMode = useStore((s) => s.darkMode);

  const [entries, setEntries] = useState<MileageEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Trip tracking state
  const [tripActive, setTripActive] = useState(false);
  const [tripJob, setTripJob] = useState("");
  const [startMiles, setStartMiles] = useState("");
  const [endMiles, setEndMiles] = useState("");

  // Manual entry
  const [mJob, setMJob] = useState("");
  const [mDate, setMDate] = useState(new Date().toISOString().split("T")[0]);
  const [mMiles, setMMiles] = useState("");

  // Load entries
  if (!loaded) {
    db.get<MileageEntry>("mileage", { user_id: user.id }).then((data) => {
      setEntries(data);
      setLoaded(true);
    });
  }

  const totalMiles = entries.reduce((s, e) => s + (e.total_miles || 0), 0);
  const thisWeek = (() => {
    const now = new Date();
    const ws = new Date(now);
    ws.setDate(now.getDate() - now.getDay());
    ws.setHours(0, 0, 0, 0);
    return entries
      .filter((e) => {
        try { return new Date(e.trip_date) >= ws; } catch { return false; }
      })
      .reduce((s, e) => s + (e.total_miles || 0), 0);
  })();

  const startTrip = () => {
    if (!startMiles) { alert("Enter starting odometer"); return; }
    setTripActive(true);
  };

  const endTrip = async () => {
    if (!endMiles) { alert("Enter ending odometer"); return; }
    const start = parseFloat(startMiles);
    const end = parseFloat(endMiles);
    if (end <= start) { alert("End miles must be greater than start"); return; }
    const total = end - start;

    await db.post("mileage", {
      user_id: user.id,
      user_name: user.name,
      job: tripJob || "General",
      trip_date: new Date().toISOString().split("T")[0],
      start_miles: start,
      end_miles: end,
      total_miles: total,
    });

    setTripActive(false);
    setStartMiles("");
    setEndMiles("");
    setTripJob("");
    setLoaded(false);
  };

  const addManual = async () => {
    const miles = parseFloat(mMiles);
    if (!miles || miles <= 0) { alert("Enter valid miles"); return; }
    await db.post("mileage", {
      user_id: user.id,
      user_name: user.name,
      job: mJob || "General",
      trip_date: mDate,
      start_miles: 0,
      end_miles: 0,
      total_miles: miles,
    });
    setMMiles("");
    setMJob("");
    setLoaded(false);
  };

  const border = darkMode ? "#1e1e2e" : "#eee";

  return (
    <div className="fi">
      <div className="row mb" style={{ justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 22, color: "var(--color-primary)" }}>🚗 Mileage</h2>
        <button className="bo" onClick={() => setPage("dash")} style={{ fontSize: 10, padding: "4px 10px" }}>← Dashboard</button>
      </div>

      {/* Stats */}
      <div className="g2 mb">
        <div className="cd" style={{ textAlign: "center", borderLeft: "3px solid var(--color-primary)" }}>
          <div className="sl">This Week</div>
          <div className="sv" style={{ color: "var(--color-primary)" }}>{thisWeek.toFixed(1)}</div>
          <div className="dim" style={{ fontSize: 10 }}>miles</div>
        </div>
        <div className="cd" style={{ textAlign: "center", borderLeft: "3px solid var(--color-success)" }}>
          <div className="sl">All Time</div>
          <div className="sv" style={{ color: "var(--color-success)" }}>{totalMiles.toFixed(1)}</div>
          <div className="dim" style={{ fontSize: 10 }}>miles</div>
        </div>
      </div>

      {/* Trip Tracker */}
      <div className="cd mb">
        <h4 style={{ fontSize: 13, marginBottom: 8 }}>
          {tripActive ? "🟢 Trip In Progress" : "Start a Trip"}
        </h4>

        {!tripActive ? (
          <>
            <div className="row" style={{ marginBottom: 6 }}>
              <select value={tripJob} onChange={(e) => setTripJob(e.target.value)} style={{ flex: 1 }}>
                <option value="">Select job</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.property}>{j.property}</option>
                ))}
              </select>
            </div>
            <div className="row">
              <input
                type="number"
                value={startMiles}
                onChange={(e) => setStartMiles(e.target.value)}
                placeholder="Starting odometer"
                style={{ flex: 1 }}
              />
              <button className="bb" onClick={startTrip} style={{ fontSize: 12, padding: "8px 16px" }}>
                ▶ Start Trip
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ textAlign: "center", padding: 12 }}>
              <div className="dim" style={{ fontSize: 11 }}>
                {tripJob || "General"} · Started at {startMiles} mi
              </div>
            </div>
            <div className="row">
              <input
                type="number"
                value={endMiles}
                onChange={(e) => setEndMiles(e.target.value)}
                placeholder="Ending odometer"
                style={{ flex: 1 }}
              />
              <button className="br" onClick={endTrip} style={{ fontSize: 12, padding: "8px 16px" }}>
                ⏹ End Trip
              </button>
            </div>
            {endMiles && parseFloat(endMiles) > parseFloat(startMiles) && (
              <div style={{ textAlign: "center", marginTop: 8 }}>
                <span style={{ fontFamily: "Oswald", fontSize: 20, color: "var(--color-success)" }}>
                  {(parseFloat(endMiles) - parseFloat(startMiles)).toFixed(1)} miles
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Manual Entry */}
      <div className="cd mb">
        <h4 style={{ fontSize: 13, marginBottom: 6 }}>Manual Entry</h4>
        <div className="row" style={{ marginBottom: 6 }}>
          <input
            type="date"
            value={mDate}
            onChange={(e) => setMDate(e.target.value)}
            style={{ width: 130, color: "var(--color-accent-red)", fontWeight: 600 }}
          />
          <select value={mJob} onChange={(e) => setMJob(e.target.value)} style={{ flex: 1 }}>
            <option value="">Select job</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.property}>{j.property}</option>
            ))}
          </select>
        </div>
        <div className="row">
          <input
            type="number"
            value={mMiles}
            onChange={(e) => setMMiles(e.target.value)}
            placeholder="Miles"
            style={{ width: 80 }}
          />
          <button className="bg" onClick={addManual} style={{ fontSize: 11, padding: "7px 12px" }}>
            Log
          </button>
        </div>
      </div>

      {/* Mileage Log */}
      <div className="cd">
        <h4 style={{ fontSize: 13, marginBottom: 6 }}>Trip Log ({entries.length})</h4>
        {!entries.length ? (
          <p className="dim" style={{ fontSize: 12 }}>No trips logged</p>
        ) : (
          entries.map((e) => (
            <div
              key={e.id}
              className="sep"
              style={{ display: "flex", justifyContent: "space-between", fontSize: 12, alignItems: "center" }}
            >
              <span style={{ minWidth: 70 }}>{e.trip_date}</span>
              <span style={{ color: "var(--color-primary)", flex: 1 }}>{e.job}</span>
              {e.start_miles > 0 && (
                <span className="dim" style={{ fontSize: 10, marginRight: 6 }}>
                  {e.start_miles}→{e.end_miles}
                </span>
              )}
              <span style={{ fontFamily: "Oswald", color: "var(--color-success)", minWidth: 50, textAlign: "right" }}>
                {e.total_miles.toFixed(1)} mi
              </span>
              <button
                onClick={async () => {
                  if (!confirm("Delete this trip?")) return;
                  await db.del("mileage", e.id);
                  setLoaded(false);
                }}
                style={{ background: "none", color: "var(--color-accent-red)", fontSize: 12, marginLeft: 6 }}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
