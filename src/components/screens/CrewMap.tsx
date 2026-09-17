"use client";
/**
 * Crew Map — every location the app knows for a chosen day:
 *  - CREW PATHS: each tech's clock-in/out GPS stamps for the day, drawn in
 *    time order as a per-tech colored DASHED polyline (dashed on purpose:
 *    it's stop-to-stop, not a driving breadcrumb — the app has no background
 *    tracking). Numbered dots mark each stamp; the initials avatar sits on
 *    the tech's LAST stamp of the day.
 *  - STOP pins: jobs scheduled for that day (status-colored) + active jobs
 *    (today only — "active" is only meaningful in the present).
 *  - DATE PICKER: look back at any past day's paths — the whole map is
 *    date-driven, so "past work" is the same render with an older date.
 *
 * Leaflet + OpenStreetMap tiles: free, no API key, real pinch/drag on
 * mobile. Leaflet is browser-only, so it's dynamically imported inside the
 * effect (never during SSR). Markers are L.divIcon HTML (no image assets —
 * Leaflet's default marker PNGs break under bundlers, and the dots match
 * the app's look anyway). Addresses geocode through the shared Nominatim
 * cache in lib/geo (one request per address ever, per device).
 *
 * History depth note: paths come from the time entries in the store, which
 * loadAll fetches without a date cutoff — lookback reaches as far as the
 * org's time_entries do.
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Icon } from "../Icon";
import { statusColor } from "@/lib/status";
import { t } from "@/lib/i18n";
import { geocodeAddress, hasGeocodeCache } from "@/lib/geo";
import { parseEntryDate } from "@/lib/dates";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

interface Props {
  setPage: (p: string) => void;
}

/** Per-tech path colors — assigned by crew order, recycled if the roster
 *  outgrows the palette. Distinct from the ROYGBIV status hues on purpose. */
const TECH_COLORS = ["#2E75B6", "#00cc66", "#f5b400", "#9d4edd", "#ff5fa8", "#00bcd4", "#ff8800"];

/** "3:42 PM" → minutes since midnight (orders the day's stamps). */
function toMin(t?: string): number {
  const m = (t || "").match(/(\d+):(\d+)\s*([AP]M)?/i);
  if (!m) return 0;
  let h = parseInt(m[1]);
  const ap = m[3]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + parseInt(m[2]);
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type StampPt = { lat: number; lng: number; kind: "in" | "out"; time: string; job: string };

export default function CrewMap({ setPage }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<LeafletMap | null>(null);
  const [note, setNote] = useState(t("loc.loadingMap"));
  const [date, setDate] = useState(() => localYmd(new Date()));
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;
      // Rebuild from scratch on every date change / refresh.
      if (mapObj.current) { mapObj.current.remove(); mapObj.current = null; }
      const map = L.map(mapRef.current).setView([37.6872, -97.3301], 11); // Wichita fallback
      mapObj.current = map;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      setNote(t("loc.loadingMap"));

      const { profiles, timeEntries, schedule, jobs } = useStore.getState();
      const bounds: [number, number][] = [];
      const isToday = date === localYmd(new Date());

      // ── Crew paths: every stamp for the selected day, per tech, in order ──
      let crewCount = 0;
      profiles.forEach((p, pi) => {
        const dayEntries = timeEntries
          .filter((x) => x.user_id === p.id && (x.start_lat != null || x.end_lat != null))
          .filter((x) => {
            const d = parseEntryDate(x.entry_date);
            return d ? localYmd(d) === date : false;
          });
        if (!dayEntries.length) return;

        const pts: StampPt[] = [];
        for (const e of dayEntries) {
          if (e.start_lat != null && e.start_lng != null) {
            pts.push({ lat: e.start_lat, lng: e.start_lng, kind: "in", time: e.start_time || "", job: e.job || "" });
          }
          if (e.end_lat != null && e.end_lng != null) {
            pts.push({ lat: e.end_lat, lng: e.end_lng, kind: "out", time: e.end_time || "", job: e.job || "" });
          }
        }
        if (!pts.length) return;
        pts.sort((a, b) => toMin(a.time) - toMin(b.time));

        const color = TECH_COLORS[pi % TECH_COLORS.length];
        const initials = p.name.split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();

        // The day's path — dashed: stamps connected in order, NOT a road trail.
        if (pts.length >= 2) {
          L.polyline(pts.map((q) => [q.lat, q.lng] as [number, number]), {
            color, weight: 3, opacity: 0.75, dashArray: "6 8",
          }).addTo(map);
        }

        pts.forEach((q, qi) => {
          const isLast = qi === pts.length - 1;
          const popup =
            `<b>${esc(p.name)}</b><br/>` +
            `#${qi + 1} · ${q.kind === "out" ? t("loc.clockedOut") : t("loc.clockedIn")} ${esc(q.time)} · ${esc(q.job)}<br/>` +
            `<a href="https://www.google.com/maps?q=${q.lat},${q.lng}" target="_blank" rel="noopener">${t("loc.openInMaps")}</a>`;
          if (isLast) {
            // Initials avatar on the final stamp of the day.
            const icon = L.divIcon({
              className: "",
              html: `<div style="width:34px;height:34px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px;font-family:Oswald,sans-serif">${esc(initials)}</div>`,
              iconSize: [34, 34],
              iconAnchor: [17, 17],
            });
            L.marker([q.lat, q.lng], { icon, zIndexOffset: 1000 }).addTo(map).bindPopup(popup);
          } else {
            // Numbered waypoint dot for each earlier stamp.
            const icon = L.divIcon({
              className: "",
              html: `<div style="width:20px;height:20px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:10px;font-family:Oswald,sans-serif">${qi + 1}</div>`,
              iconSize: [20, 20],
              iconAnchor: [10, 10],
            });
            L.marker([q.lat, q.lng], { icon, zIndexOffset: 500 }).addTo(map).bindPopup(popup);
          }
          bounds.push([q.lat, q.lng]);
        });
        crewCount++;
      });

      // ── Stop pins: the selected day's schedule (+ active jobs, today only) ──
      const stops = new Map<string, { color: string; label: string }>();
      for (const s of schedule) {
        if (!s.job) continue;
        const spans = s.sched_date <= date && (s.end_date || s.sched_date) >= date;
        if (!spans) continue;
        const j = jobs.find((x) => x.property === s.job);
        stops.set(s.job, { color: j ? statusColor(j.status) : "#ffcc00", label: t("loc.scheduledToday") });
      }
      if (isToday) {
        for (const j of jobs) {
          if (!j.archived && j.status === "active" && j.property && !stops.has(j.property)) {
            stops.set(j.property, { color: statusColor("active"), label: t("loc.activeJob") });
          }
        }
      }
      if (cancelled) return;
      if (stops.size > 0) setNote(`${t("loc.locatingStops")} (${stops.size})…`);
      for (const [addr, meta] of stops) {
        const had = hasGeocodeCache(addr);
        const c = await geocodeAddress(addr);
        if (cancelled) return;
        if (c) {
          const icon = L.divIcon({
            className: "",
            html: `<div style="width:16px;height:16px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${meta.color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 14],
          });
          L.marker([c.lat, c.lng], { icon })
            .addTo(map)
            .bindPopup(
              `<b>${esc(addr)}</b><br/>${esc(meta.label)}<br/>` +
              `<a href="https://www.google.com/maps?q=${encodeURIComponent(addr)}" target="_blank" rel="noopener">${t("loc.openInMaps")}</a>`,
            );
          bounds.push([c.lat, c.lng]);
        }
        // Nominatim policy: ~1 req/s for real (uncached) lookups only.
        if (!had) await new Promise((r) => setTimeout(r, 1100));
      }

      if (cancelled) return;
      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [45, 45], maxZoom: 14 });
        setNote(crewCount === 0 ? t("loc.noCrewStamps") : "");
      } else {
        setNote(isToday ? t("loc.noStampsToday") : t("loc.noStampsDay"));
      }
    })();
    return () => {
      cancelled = true;
      if (mapObj.current) { mapObj.current.remove(); mapObj.current = null; }
    };
  }, [date, refreshKey]);

  return (
    <div className="fi">
      <div className="row mb" style={{ alignItems: "center" }}>
        <button className="bo" onClick={() => setPage("more")} style={{ fontSize: 14, padding: "4px 8px" }}>←</button>
        <h2 style={{ fontSize: 20, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 7, flex: 1 }}>
          <Icon name="map" size={18} color="var(--color-primary)" /> {t("loc.crewMap")}
        </h2>
        <button className="bo" onClick={() => setRefreshKey((k) => k + 1)} style={{ fontSize: 13, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Icon name="refresh" size={13} /> {t("loc.refresh")}
        </button>
      </div>

      {/* Date lookback — the whole map re-renders for the chosen day. */}
      <div className="row mb" style={{ alignItems: "center", gap: 6 }}>
        <button className="bo" onClick={() => { const d = new Date(date + "T12:00:00"); d.setDate(d.getDate() - 1); setDate(localYmd(d)); }} style={{ fontSize: 14, padding: "4px 10px" }}>←</button>
        <input
          type="date"
          value={date}
          max={localYmd(new Date())}
          onChange={(e) => { if (e.target.value) setDate(e.target.value); }}
          style={{ flex: 1, fontSize: 14, textAlign: "center" }}
        />
        <button
          className="bo"
          disabled={date >= localYmd(new Date())}
          onClick={() => { const d = new Date(date + "T12:00:00"); d.setDate(d.getDate() + 1); setDate(localYmd(d)); }}
          style={{ fontSize: 14, padding: "4px 10px", opacity: date >= localYmd(new Date()) ? 0.4 : 1 }}
        >
          →
        </button>
      </div>

      {note && <div className="dim" style={{ fontSize: 13, marginBottom: 8 }}>{note}</div>}

      <div
        ref={mapRef}
        style={{ height: "calc(100dvh - 300px)", minHeight: 360, borderRadius: 14, overflow: "hidden", border: "1px solid var(--color-border-dark, #1e1e2e)" }}
      />

      <div className="dim" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
        <b style={{ color: "#7fb6ff" }}>{t("loc.blueCircles")}</b> {t("loc.legendCrew")}{" "}
        {t("loc.legendPath")}{" "}
        <b style={{ color: "#ffe07a" }}>{t("loc.pins")}</b> {t("loc.legendPins")}
      </div>
    </div>
  );
}
