"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
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
        <h2 style={{ fontSize: 22, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Icon name="mileage" size={22} color="var(--color-primary)" />
          Mileage
        </h2>
        <div className="row">
          {entries.length > 0 && (
            <button className="bo" onClick={exportMileagePdf} style={{ fontSize: 12, padding: "4px 10px" }}>
              🖨 Print Log
            </button>
          )}
          <button className="bo" onClick={() => setPage("dash")} style={{ fontSize: 12, padding: "4px 10px" }}>← Dashboard</button>
        </div>
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
          <button className="bg" onClick={addManual} style={{ fontSize: 13, padding: "7px 12px" }}>
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
                <span className="dim" style={{ fontSize: 12, marginRight: 6 }}>
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
