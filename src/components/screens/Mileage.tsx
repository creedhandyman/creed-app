"use client";
import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { haversineMiles, getFix, ROAD_FACTOR } from "@/lib/geo";
import { Icon } from "../Icon";
import CountUp from "@/components/CountUp";

interface MileageEntry {
  id: string;
  job: string;
  trip_date: string;
  start_miles: number;
  end_miles: number;
  total_miles: number;
  user_name: string;
}

// localStorage key for an in-progress GPS snapshot trip — persisted so the trip
// survives locking the phone / switching to Maps / closing the app.
const TRIP_KEY = "c_mileage_trip";

interface GpsTrip {
  startLat: number;
  startLng: number;
  startOdo: string; // optional starting odometer, as typed
  job: string;
  startedAt: string; // ISO
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

  // GPS snapshot trip: capture a start fix (+ optional starting odometer), then
  // an end fix when you arrive — no continuous tracking, so the screen can lock
  // and you can use Maps. Distance = start→end straight-line × road factor.
  const [trackMode, setTrackMode] = useState<"gps" | "manual">("gps");
  const [gpsJob, setGpsJob] = useState("");
  const [gpsStartOdo, setGpsStartOdo] = useState("");
  const [gpsErr, setGpsErr] = useState("");
  const [gpsBusy, setGpsBusy] = useState(false);
  // In-progress trip — persisted to localStorage so it survives closing the app.
  const [gpsTrip, setGpsTrip] = useState<GpsTrip | null>(null);
  // After End: review/adjust the ending odometer before saving.
  const [gpsReview, setGpsReview] = useState<{ miles: number; endOdo: string } | null>(null);
  const gpsInProgress = !!gpsTrip || !!gpsReview;

  // Restore an in-progress trip on mount — the whole point: start, leave, return.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TRIP_KEY);
      if (raw) setGpsTrip(JSON.parse(raw) as GpsTrip);
    } catch { /* ignore a corrupt entry */ }
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

  // ── GPS snapshot trip ──
  // Start: stamp the current location + optional starting odometer, persist it,
  // and let the user drive freely (phone locked, Maps open, app closed).
  const startGpsTrip = async () => {
    if (gpsBusy || gpsTrip) return;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGpsErr("This device can't share location."); return;
    }
    setGpsErr("");
    setGpsBusy(true);
    const fix = await getFix();
    setGpsBusy(false);
    if (!fix) {
      setGpsErr("Couldn't get your location. Allow location access, or log miles manually below.");
      return;
    }
    const trip: GpsTrip = {
      startLat: fix.lat,
      startLng: fix.lng,
      startOdo: gpsStartOdo.trim(),
      job: gpsJob,
      startedAt: new Date().toISOString(),
    };
    try { localStorage.setItem(TRIP_KEY, JSON.stringify(trip)); } catch { /* */ }
    setGpsTrip(trip);
  };

  // End: stamp the arrival location, estimate miles (start→end × road factor),
  // and auto-fill the ending odometer = start + miles for the user to confirm.
  const endGpsTrip = async () => {
    if (!gpsTrip || gpsBusy) return;
    setGpsErr("");
    setGpsBusy(true);
    const fix = await getFix(12000);
    setGpsBusy(false);
    if (!fix) {
      setGpsErr("Couldn't get your location to finish the trip. Try again, or cancel and use Odometer mode.");
      return;
    }
    const miles = Math.round(
      haversineMiles(gpsTrip.startLat, gpsTrip.startLng, fix.lat, fix.lng) * ROAD_FACTOR * 10
    ) / 10;
    const startNum = parseFloat(gpsTrip.startOdo);
    const endOdo = !isNaN(startNum) ? String(Math.round(startNum + miles)) : "";
    setGpsReview({ miles, endOdo });
  };

  // Save: prefer the (possibly corrected) odometer delta; fall back to the GPS
  // estimate when no starting odometer was entered.
  const saveGpsTrip = async () => {
    if (!gpsTrip || !gpsReview) return;
    const startNum = parseFloat(gpsTrip.startOdo);
    const endNum = parseFloat(gpsReview.endOdo);
    let start_miles = 0, end_miles = 0, total_miles = gpsReview.miles;
    if (!isNaN(startNum) && !isNaN(endNum) && endNum > startNum) {
      start_miles = startNum;
      end_miles = endNum;
      total_miles = Math.round((endNum - startNum) * 10) / 10;
    } else if (!isNaN(startNum)) {
      start_miles = startNum; // ending odo cleared — keep start, log GPS miles
    }
    if (total_miles < 0.1) {
      useStore.getState().showToast("No movement detected — nothing logged", "warning");
      return;
    }
    await db.post("mileage", {
      user_id: user.id,
      user_name: user.name,
      job: gpsTrip.job || "General",
      trip_date: new Date().toISOString().split("T")[0],
      start_miles,
      end_miles,
      total_miles,
    });
    try { localStorage.removeItem(TRIP_KEY); } catch { /* */ }
    setGpsTrip(null);
    setGpsReview(null);
    setGpsStartOdo("");
    setGpsJob("");
    useStore.getState().showToast(`Logged ${total_miles.toFixed(1)} mi`, "success");
    setLoaded(false);
  };

  // Cancel an in-progress / to-be-reviewed trip without logging anything.
  const discardGpsTrip = () => {
    try { localStorage.removeItem(TRIP_KEY); } catch { /* */ }
    setGpsTrip(null);
    setGpsReview(null);
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
          <div className="sv" style={{ color: "var(--color-primary)" }}><CountUp value={thisWeek} decimals={1} /></div>
          <div className="dim" style={{ fontSize: 12 }}>miles</div>
        </div>
        <div className="cd statusstrip" style={{ textAlign: "center", ["--c" as any]: "var(--color-success)" }}>
          <div className="sl">All Time</div>
          <div className="sv" style={{ color: "var(--color-success)" }}><CountUp value={totalMiles} decimals={1} /></div>
          <div className="dim" style={{ fontSize: 12 }}>miles</div>
        </div>
      </div>

      {/* Trip Tracker */}
      <div className="cd mb">
        {/* Mode toggle — GPS auto-tracking vs manual odometer */}
        <div className="row" style={{ gap: 6, marginBottom: 10 }}>
          <button
            onClick={() => { if (!gpsInProgress) setTrackMode("gps"); }}
            disabled={gpsInProgress}
            className={trackMode === "gps" ? "bb" : "bo"}
            style={{ flex: 1, fontSize: 13, padding: "7px 0", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}
          >
            <Icon name="navigation" size={14} /> GPS Trip
          </button>
          <button
            onClick={() => { if (!gpsInProgress) setTrackMode("manual"); }}
            disabled={gpsInProgress}
            className={trackMode === "manual" ? "bb" : "bo"}
            style={{ flex: 1, fontSize: 13, padding: "7px 0", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, opacity: gpsInProgress ? 0.5 : 1 }}
          >
            <Icon name="mileage" size={14} /> Odometer
          </button>
        </div>

        {trackMode === "gps" ? (
          /* GPS snapshot trip: tap Start → drive freely → tap End → confirm. */
          !gpsTrip && !gpsReview ? (
            <>
              <div className="row" style={{ marginBottom: 8 }}>
                <select value={gpsJob} onChange={(e) => setGpsJob(e.target.value)} style={{ flex: 1 }}>
                  <option value="">Select job (optional)</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.property}>{j.property}</option>
                  ))}
                </select>
              </div>
              <div className="row" style={{ marginBottom: 8 }}>
                <input
                  type="number"
                  inputMode="numeric"
                  value={gpsStartOdo}
                  onChange={(e) => setGpsStartOdo(e.target.value)}
                  placeholder="Starting odometer (optional)"
                  style={{ flex: 1 }}
                />
              </div>
              <div className="cta glow-green" onClick={startGpsTrip} style={{ opacity: gpsBusy ? 0.7 : 1 }}>
                <div className="ic"><Icon name={gpsBusy ? "refresh" : "start"} size={24} color="#fff" strokeWidth={2} /></div>
                <div className="tx">
                  <b>{gpsBusy ? "Getting location…" : "Start Trip"}</b>
                  <small>Marks your start — then drive freely</small>
                </div>
                {!gpsBusy && <Icon name="next" size={19} color="#fff" />}
              </div>
              {gpsErr && (
                <p style={{ fontSize: 12.5, marginTop: 8, color: "var(--color-accent-red)" }}>{gpsErr}</p>
              )}
              <p className="dim" style={{ fontSize: 12, marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>
                <Icon name="info" size={12} /> No need to keep this open — lock your phone or open Maps, then tap End when you arrive.
              </p>
            </>
          ) : gpsTrip && !gpsReview ? (
            <div style={{ textAlign: "center", padding: "6px 0 4px" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--color-success)", boxShadow: "0 0 10px var(--color-success)" }} />
                <span style={{ fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".5px", fontSize: 14 }}>
                  Trip started{gpsTrip.job ? ` · ${gpsTrip.job}` : ""}
                </span>
              </div>
              <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
                {gpsTrip.startOdo ? `Started at ${gpsTrip.startOdo} mi · ` : ""}phone can stay locked
              </div>
              <button className="br" onClick={endGpsTrip} disabled={gpsBusy} style={{ fontSize: 15, padding: "10px 28px", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon name={gpsBusy ? "refresh" : "stop"} size={15} /> {gpsBusy ? "Getting location…" : "End Trip"}
              </button>
              <div style={{ marginTop: 10 }}>
                <span onClick={discardGpsTrip} className="dim" style={{ fontSize: 12.5, cursor: "pointer", textDecoration: "underline" }}>Cancel trip</span>
              </div>
              {gpsErr && <p style={{ fontSize: 12.5, marginTop: 8, color: "var(--color-accent-red)" }}>{gpsErr}</p>}
            </div>
          ) : (
            <div style={{ padding: "4px 0" }}>
              <div style={{ textAlign: "center", marginBottom: 12 }}>
                <div className="dim" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".5px" }}>GPS estimate</div>
                <div style={{ fontFamily: "Oswald", fontSize: 40, fontWeight: 700, color: "var(--color-success)", lineHeight: 1.1 }}>
                  {gpsReview!.miles.toFixed(1)} <span style={{ fontSize: 16 }}>mi</span>
                </div>
              </div>
              {gpsTrip!.startOdo ? (
                <>
                  <div className="dim" style={{ fontSize: 13, marginBottom: 6 }}>
                    Started at {gpsTrip!.startOdo} mi. Confirm the ending odometer (auto-filled from the estimate — adjust to your real reading):
                  </div>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={gpsReview!.endOdo}
                    onChange={(e) => setGpsReview((r) => (r ? { ...r, endOdo: e.target.value } : r))}
                    placeholder="Ending odometer"
                    style={{ width: "100%", marginBottom: 8 }}
                  />
                  {(() => {
                    const s = parseFloat(gpsTrip!.startOdo);
                    const en = parseFloat(gpsReview!.endOdo);
                    const tot = !isNaN(s) && !isNaN(en) && en > s ? en - s : gpsReview!.miles;
                    return (
                      <div style={{ textAlign: "center", marginBottom: 10 }}>
                        <span style={{ fontFamily: "Oswald", fontSize: 22, color: "var(--color-success)" }}>{tot.toFixed(1)} miles</span>
                      </div>
                    );
                  })()}
                </>
              ) : (
                <div className="dim" style={{ fontSize: 13, marginBottom: 10, textAlign: "center" }}>
                  No starting odometer entered — we&apos;ll log the GPS estimate.
                </div>
              )}
              <div className="row" style={{ gap: 6 }}>
                <button className="bo" onClick={discardGpsTrip} style={{ flex: 1, fontSize: 14, padding: "9px 0" }}>Discard</button>
                <button className="bb" onClick={saveGpsTrip} style={{ flex: 1, fontSize: 14, padding: "9px 0" }}>Save trip</button>
              </div>
              {gpsErr && <p style={{ fontSize: 12.5, marginTop: 8, color: "var(--color-accent-red)" }}>{gpsErr}</p>}
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
