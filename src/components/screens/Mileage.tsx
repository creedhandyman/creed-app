"use client";
import { useState, useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { haversineMiles, getFix, ROAD_FACTOR } from "@/lib/geo";
import { Icon } from "../Icon";

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

  // GPS auto-trip: watches location while driving and computes miles itself.
  const [trackMode, setTrackMode] = useState<"gps" | "manual">("gps");
  const [gpsActive, setGpsActive] = useState(false);
  const [gpsStarting, setGpsStarting] = useState(false);
  const [gpsMiles, setGpsMiles] = useState(0);
  const [gpsJob, setGpsJob] = useState("");
  const [gpsErr, setGpsErr] = useState("");
  const [gpsAcc, setGpsAcc] = useState<number | null>(null);

  // Refs hold the live tracking state — watchPosition's callback is a closure,
  // so accumulating into refs avoids stale-state bugs; gpsMiles mirrors it for UI.
  const watchId = useRef<number | null>(null);
  const startFix = useRef<{ lat: number; lng: number } | null>(null);
  const lastFix = useRef<{ lat: number; lng: number } | null>(null);
  const milesRef = useRef(0);
  const wakeLock = useRef<{ release: () => void } | null>(null);

  // Stop watching + release the screen wake lock if we leave the screen mid-trip.
  useEffect(() => {
    return () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
      try { wakeLock.current?.release?.(); } catch { /* best effort */ }
    };
  }, []);

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
    if (!startMiles) { useStore.getState().showToast("Enter starting odometer", "warning"); return; }
    setTripActive(true);
  };

  const endTrip = async () => {
    if (!endMiles) { useStore.getState().showToast("Enter ending odometer", "warning"); return; }
    const start = parseFloat(startMiles);
    const end = parseFloat(endMiles);
    if (end <= start) { useStore.getState().showToast("End miles must be greater than start", "warning"); return; }
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

  // ── GPS auto-tracking ──
  // Keep the screen awake so the OS doesn't suspend GPS while driving.
  const acquireWakeLock = async () => {
    try {
      const nav = navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => void }> } };
      if (nav.wakeLock?.request) wakeLock.current = await nav.wakeLock.request("screen");
    } catch { /* best effort — not supported on all browsers */ }
  };
  const releaseWakeLock = () => {
    try { wakeLock.current?.release?.(); } catch { /* */ }
    wakeLock.current = null;
  };

  // Each position update extends the path by the segment since the last fix.
  const onFix = (pos: GeolocationPosition) => {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    setGpsAcc(accuracy ?? null);
    if (accuracy != null && accuracy > 100) return; // too noisy to trust
    if (!startFix.current) startFix.current = { lat, lng };
    const prev = lastFix.current;
    if (prev) {
      const seg = haversineMiles(prev.lat, prev.lng, lat, lng);
      // Drop sub-~15m jitter (parked GPS drift) and >3mi single-fix jumps (errors).
      if (seg >= 0.01 && seg < 3) {
        milesRef.current += seg;
        setGpsMiles(milesRef.current);
      }
    }
    lastFix.current = { lat, lng };
  };

  const startGpsTrip = async () => {
    if (gpsStarting || gpsActive) return;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGpsErr("This device can't share location."); return;
    }
    setGpsErr("");
    setGpsStarting(true);
    milesRef.current = 0;
    setGpsMiles(0);
    startFix.current = null;
    lastFix.current = null;
    const fix = await getFix();
    if (!fix) {
      setGpsStarting(false);
      setGpsErr("Couldn't get your location. Allow location access, or log miles manually below.");
      return;
    }
    startFix.current = { lat: fix.lat, lng: fix.lng };
    lastFix.current = { lat: fix.lat, lng: fix.lng };
    setGpsAcc(fix.accuracy ?? null);
    watchId.current = navigator.geolocation.watchPosition(
      onFix,
      (err) => setGpsErr(err.message || "Lost GPS signal"),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
    await acquireWakeLock();
    setGpsStarting(false);
    setGpsActive(true);
  };

  const endGpsTrip = async () => {
    if (watchId.current != null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null; }
    releaseWakeLock();
    let miles = milesRef.current;
    // Grab a fresh end point. If continuous tracking under-counted (screen
    // slept, sparse fixes), fall back to start→end straight line × road factor.
    const end = await getFix(8000);
    if (end) lastFix.current = { lat: end.lat, lng: end.lng };
    if (miles < 0.1 && startFix.current && lastFix.current) {
      miles = haversineMiles(
        startFix.current.lat, startFix.current.lng,
        lastFix.current.lat, lastFix.current.lng
      ) * ROAD_FACTOR;
    }
    setGpsActive(false);
    setGpsMiles(0);
    setGpsAcc(null);
    if (miles < 0.1) {
      useStore.getState().showToast("No movement detected — nothing logged", "warning");
      return;
    }
    miles = Math.round(miles * 10) / 10;
    await db.post("mileage", {
      user_id: user.id,
      user_name: user.name,
      job: gpsJob || "General",
      trip_date: new Date().toISOString().split("T")[0],
      start_miles: 0,
      end_miles: 0,
      total_miles: miles,
    });
    useStore.getState().showToast(`Logged ${miles.toFixed(1)} mi`, "success");
    setGpsJob("");
    setLoaded(false);
  };

  const addManual = async () => {
    const miles = parseFloat(mMiles);
    if (!miles || miles <= 0) { useStore.getState().showToast("Enter valid miles", "warning"); return; }
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

  const org = useStore((s) => s.org);
  const IRS_RATE = 0.70; // 2025 IRS standard mileage rate

  const exportMileagePdf = () => {
    const orgName = org?.name || "Service Provider";
    const orgPhone = org?.phone || "";
    const orgEmail = org?.email || "";
    const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    // Group by month
    const byMonth: Record<string, MileageEntry[]> = {};
    entries.forEach((e) => {
      const key = e.trip_date?.slice(0, 7) || "Unknown";
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(e);
    });

    const totalDeduction = (totalMiles * IRS_RATE).toFixed(2);

    const rows = entries
      .sort((a, b) => (a.trip_date || "").localeCompare(b.trip_date || ""))
      .map((e) =>
        `<tr><td>${e.trip_date}</td><td>${e.job}</td>${e.start_miles > 0 ? `<td style="text-align:right">${e.start_miles}</td><td style="text-align:right">${e.end_miles}</td>` : `<td style="text-align:right">—</td><td style="text-align:right">—</td>`}<td style="text-align:right;font-weight:600">${e.total_miles.toFixed(1)}</td></tr>`
      ).join("");

    const monthSummary = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, trips]) => {
        const mi = trips.reduce((s, t) => s + t.total_miles, 0);
        return `<tr><td>${month}</td><td style="text-align:right">${trips.length}</td><td style="text-align:right">${mi.toFixed(1)}</td><td style="text-align:right;color:#2E75B6;font-weight:600">$${(mi * IRS_RATE).toFixed(2)}</td></tr>`;
      }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Mileage Log — ${orgName}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Source+Sans+3:wght@400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Source Sans 3',sans-serif;color:#1a1a2a;font-size:13px;line-height:1.5}
.page{max-width:800px;margin:0 auto;padding:32px 40px}
h1{font-family:Oswald;font-size:22px;color:#2E75B6;text-transform:uppercase;letter-spacing:.05em}
h2{font-family:Oswald;font-size:15px;color:#2E75B6;text-transform:uppercase;letter-spacing:.04em;margin:20px 0 8px;border-bottom:2px solid #2E75B6;padding-bottom:4px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:3px solid #2E75B6}
.info{font-size:12px;color:#666;margin-top:4px;line-height:1.6}
table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px}
th{font-family:Oswald;text-transform:uppercase;font-size:11px;letter-spacing:.06em;color:#fff;background:#2E75B6;padding:6px 8px;text-align:left}
td{padding:5px 8px;border-bottom:1px solid #e8e8e8;vertical-align:top}
.totals{background:#f0f4f8;border-radius:8px;padding:16px;margin:16px 0;display:flex;justify-content:space-around;text-align:center}
.totals .num{font-family:Oswald;font-size:28px;font-weight:700;color:#2E75B6}
.totals .lbl{font-family:Oswald;font-size:11px;text-transform:uppercase;color:#888;letter-spacing:.08em}
.footer{border-top:1px solid #ddd;padding-top:8px;text-align:center;font-size:11px;color:#888;margin-top:24px}
.sig-row{display:flex;gap:40px;margin-top:30px}
.sig-line{flex:1;border-top:1px solid #999;padding-top:6px;text-align:center;font-size:12px;color:#666}
@media print{body{padding:0}.page{padding:16px 24px}}
</style></head><body><div class="page">
<div class="header">
  <div><h1>${orgName}</h1><div class="info">Mileage Log${orgPhone ? "<br/>" + orgPhone : ""}${orgEmail ? " · " + orgEmail : ""}</div></div>
  <div style="text-align:right"><div style="font-family:Oswald;font-size:14px;color:#2E75B6;text-transform:uppercase">Mileage Report</div><div style="font-size:12px;color:#666;margin-top:2px">${today}</div><div style="font-size:12px;color:#666">Employee: ${user.name}</div></div>
</div>

<div class="totals">
  <div><div class="num">${totalMiles.toFixed(1)}</div><div class="lbl">Total Miles</div></div>
  <div><div class="num">${entries.length}</div><div class="lbl">Total Trips</div></div>
  <div><div class="num" style="color:#00cc66">$${totalDeduction}</div><div class="lbl">Tax Deduction (@ $${IRS_RATE}/mi)</div></div>
</div>

<h2>Monthly Summary</h2>
<table><thead><tr><th>Month</th><th style="text-align:right">Trips</th><th style="text-align:right">Miles</th><th style="text-align:right">Deduction</th></tr></thead><tbody>${monthSummary}</tbody></table>

<h2>Trip Details</h2>
<table><thead><tr><th>Date</th><th>Job</th><th style="text-align:right">Start</th><th style="text-align:right">End</th><th style="text-align:right">Miles</th></tr></thead><tbody>${rows}</tbody></table>

<div style="font-size:12px;color:#666;margin-top:12px;padding:10px;background:#f5f7fa;border-radius:6px">
  <b>IRS Standard Mileage Rate:</b> $${IRS_RATE}/mile (2025). This report is for record-keeping purposes. Consult your tax professional for deduction eligibility.
</div>

<div class="sig-row">
  <div class="sig-line">Employee Signature / Date</div>
  <div class="sig-line">Manager Approval / Date</div>
</div>

<div class="footer">${orgName}${orgPhone ? " · " + orgPhone : ""}${orgEmail ? " · " + orgEmail : ""}</div>
</div></body></html>`;

    const win = window.open("", "_blank");
    if (!win) { useStore.getState().showToast("Allow popups to export mileage log", "error"); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 600);
  };

  return (
    <div className="fi">
      <div className="row mb" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(46,139,255,.14)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="mileage" size={19} color="var(--color-primary)" />
          </span>
          <span style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 21, letterSpacing: ".5px", textTransform: "uppercase" }}>Mileage</span>
        </div>
        <div className="row">
          {entries.length > 0 && (
            <button className="bo" onClick={exportMileagePdf} style={{ fontSize: 14, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="print" size={14} /> Print
            </button>
          )}
          <button className="bo" onClick={() => setPage("dash")} style={{ fontSize: 14, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="back" size={14} /> Dashboard
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="g2 mb">
        <div className="cd statusstrip" style={{ textAlign: "center", ["--c" as any]: "var(--color-primary)" }}>
          <div className="sl">This Week</div>
          <div className="sv" style={{ color: "var(--color-primary)" }}>{thisWeek.toFixed(1)}</div>
          <div className="dim" style={{ fontSize: 12 }}>miles</div>
        </div>
        <div className="cd statusstrip" style={{ textAlign: "center", ["--c" as any]: "var(--color-success)" }}>
          <div className="sl">All Time</div>
          <div className="sv" style={{ color: "var(--color-success)" }}>{totalMiles.toFixed(1)}</div>
          <div className="dim" style={{ fontSize: 12 }}>miles</div>
        </div>
      </div>

      {/* Trip Tracker */}
      <div className="cd mb">
        {/* Mode toggle — GPS auto-tracking vs manual odometer */}
        <div className="row" style={{ gap: 6, marginBottom: 10 }}>
          <button
            onClick={() => { if (!gpsActive) setTrackMode("gps"); }}
            disabled={gpsActive}
            className={trackMode === "gps" ? "bb" : "bo"}
            style={{ flex: 1, fontSize: 13, padding: "7px 0", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}
          >
            <Icon name="navigation" size={14} /> GPS Auto
          </button>
          <button
            onClick={() => { if (!gpsActive) setTrackMode("manual"); }}
            disabled={gpsActive}
            className={trackMode === "manual" ? "bb" : "bo"}
            style={{ flex: 1, fontSize: 13, padding: "7px 0", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, opacity: gpsActive ? 0.5 : 1 }}
          >
            <Icon name="mileage" size={14} /> Odometer
          </button>
        </div>

        {trackMode === "gps" ? (
          /* GPS auto-tracking: tap Start → drive → tap End. Miles computed from location. */
          !gpsActive ? (
            <>
              <div className="row" style={{ marginBottom: 8 }}>
                <select value={gpsJob} onChange={(e) => setGpsJob(e.target.value)} style={{ flex: 1 }}>
                  <option value="">Select job (optional)</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.property}>{j.property}</option>
                  ))}
                </select>
              </div>
              <div className="cta glow-green" onClick={startGpsTrip} style={{ opacity: gpsStarting ? 0.7 : 1 }}>
                <div className="ic"><Icon name={gpsStarting ? "refresh" : "start"} size={24} color="#fff" strokeWidth={2} /></div>
                <div className="tx">
                  <b>{gpsStarting ? "Getting location…" : "Start GPS Trip"}</b>
                  <small>Auto-tracks your miles while you drive</small>
                </div>
                {!gpsStarting && <Icon name="next" size={19} color="#fff" />}
              </div>
              {gpsErr && (
                <p style={{ fontSize: 12.5, marginTop: 8, color: "var(--color-accent-red)" }}>{gpsErr}</p>
              )}
              <p className="dim" style={{ fontSize: 12, marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>
                <Icon name="info" size={12} /> Keep this screen open while driving so GPS keeps tracking.
              </p>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "6px 0 4px" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--color-success)", boxShadow: "0 0 10px var(--color-success)", animation: "pulse 1.6s ease-in-out infinite" }} />
                <span style={{ fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".5px", fontSize: 14 }}>
                  Tracking{gpsJob ? ` · ${gpsJob}` : ""}
                </span>
              </div>
              <div style={{ fontFamily: "Oswald", fontSize: 52, lineHeight: 1, fontWeight: 700, color: "var(--color-success)" }}>
                {gpsMiles.toFixed(1)}
              </div>
              <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
                miles{gpsAcc != null ? ` · ±${Math.round(gpsAcc)}m` : ""}
              </div>
              <button className="br" onClick={endGpsTrip} style={{ fontSize: 15, padding: "10px 28px", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon name="stop" size={15} /> End Trip
              </button>
              {gpsErr && <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>{gpsErr}</p>}
            </div>
          )
        ) : (
          /* Manual odometer — original start/end-reading flow */
          <>
            <h4 style={{ fontSize: 15, marginBottom: 8 }}>
              {tripActive ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--color-success)", boxShadow: "0 0 8px var(--color-success)" }} /> Trip In Progress</span> : "Start a Trip"}
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
                  <button className="bb" onClick={startTrip} style={{ fontSize: 14, padding: "8px 16px", display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <Icon name="start" size={14} /> Start Trip
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ textAlign: "center", padding: 12 }}>
                  <div className="dim" style={{ fontSize: 13 }}>
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
                  <button className="br" onClick={endTrip} style={{ fontSize: 14, padding: "8px 16px", display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <Icon name="stop" size={14} /> End Trip
                  </button>
                </div>
                {endMiles && parseFloat(endMiles) > parseFloat(startMiles) && (
                  <div style={{ textAlign: "center", marginTop: 8 }}>
                    <span style={{ fontFamily: "Oswald", fontSize: 22, color: "var(--color-success)" }}>
                      {(parseFloat(endMiles) - parseFloat(startMiles)).toFixed(1)} miles
                    </span>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Manual Entry */}
      <div className="cd mb">
        <h4 style={{ fontSize: 15, marginBottom: 6 }}>Manual Entry</h4>
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
          <button className="bg" onClick={addManual} style={{ fontSize: 15, padding: "7px 12px" }}>
            Log
          </button>
        </div>
      </div>

      {/* Mileage Log */}
      <div className="cd">
        <h4 style={{ fontSize: 15, marginBottom: 6 }}>Trip Log ({entries.length})</h4>
        {!entries.length ? (
          <p className="dim" style={{ fontSize: 14 }}>No trips logged</p>
        ) : (
          entries.map((e) => (
            <div
              key={e.id}
              className="sep"
              style={{ display: "flex", justifyContent: "space-between", fontSize: 14, alignItems: "center" }}
            >
              <span style={{ minWidth: 70 }}>{e.trip_date}</span>
              <span style={{ color: "var(--color-primary)", flex: 1 }}>{e.job}</span>
              {e.start_miles > 0 && (
                <span className="dim" style={{ fontSize: 14, marginRight: 6 }}>
                  {e.start_miles}→{e.end_miles}
                </span>
              )}
              <span style={{ fontFamily: "Oswald", color: "var(--color-success)", minWidth: 50, textAlign: "right" }}>
                {e.total_miles.toFixed(1)} mi
              </span>
              <button
                onClick={async () => {
                  if (!await useStore.getState().showConfirm("Delete Trip", "Delete this trip?")) return;
                  await db.del("mileage", e.id);
                  setLoaded(false);
                }}
                style={{ background: "none", color: "var(--color-accent-red)", fontSize: 14, marginLeft: 6, display: "inline-flex", alignItems: "center" }}
                aria-label="Delete trip"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
