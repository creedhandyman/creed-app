"use client";
/**
 * Crew Map — one map with everything location-shaped the app knows today:
 *  - CREW dots: each teammate's LAST GPS STAMP TODAY (clock-in/out fixes;
 *    initials avatar, popup says which stamp + when). No live tracking —
 *    stamps only, matching the app's one-shot-on-the-clock GPS posture.
 *  - STOP pins: today's scheduled jobs (status-colored) + active jobs.
 *
 * Leaflet + OpenStreetMap tiles: free, no API key, real pinch/drag on
 * mobile. Leaflet is browser-only, so it's dynamically imported inside the
 * effect (never during SSR). Markers are L.divIcon HTML (no image assets —
 * Leaflet's default marker PNGs break under bundlers, and the dots match
 * the app's look anyway). Addresses geocode through the shared Nominatim
 * cache in lib/geo (one request per address ever, per device).
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Icon } from "../Icon";
import { statusColor } from "@/lib/status";
import { geocodeAddress, hasGeocodeCache } from "@/lib/geo";
import { parseEntryDate } from "@/lib/dates";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

interface Props {
  setPage: (p: string) => void;
}

/** "3:42 PM" → minutes since midnight (for picking the freshest stamp). */
function toMin(t?: string): number {
  const m = (t || "").match(/(\d+):(\d+)\s*([AP]M)?/i);
  if (!m) return 0;
  let h = parseInt(m[1]);
  const ap = m[3]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + parseInt(m[2]);
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export default function CrewMap({ setPage }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<LeafletMap | null>(null);
  const [note, setNote] = useState("Loading map…");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;
      // Rebuild from scratch on every (re)mount / refresh.
      if (mapObj.current) { mapObj.current.remove(); mapObj.current = null; }
      const map = L.map(mapRef.current).setView([37.6872, -97.3301], 11); // Wichita fallback
      mapObj.current = map;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      const { profiles, timeEntries, schedule, jobs } = useStore.getState();
      const bounds: [number, number][] = [];
      const todayKey = new Date().toDateString();
      const d = new Date();
      const ymdT = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      // ── Crew dots: freshest stamped entry today per teammate ──
      let crewCount = 0;
      for (const p of profiles) {
        const e = timeEntries
          .filter((x) => x.user_id === p.id && (x.start_lat != null || x.end_lat != null))
          .filter((x) => parseEntryDate(x.entry_date)?.toDateString() === todayKey)
          .sort((a, b) => toMin(b.end_time || b.start_time) - toMin(a.end_time || a.start_time))[0];
        if (!e) continue;
        const lat = e.end_lat ?? e.start_lat;
        const lng = e.end_lng ?? e.start_lng;
        if (lat == null || lng == null) continue;
        const initials = p.name.split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
        const isOut = e.end_lat != null;
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:34px;height:34px;border-radius:50%;background:#2E75B6;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px;font-family:Oswald,sans-serif">${esc(initials)}</div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });
        L.marker([lat, lng], { icon, zIndexOffset: 1000 })
          .addTo(map)
          .bindPopup(
            `<b>${esc(p.name)}</b><br/>` +
            `${isOut ? "Clocked out" : "Clocked in"} ${esc((isOut ? e.end_time : e.start_time) || "")} · ${esc(e.job || "")}<br/>` +
            `<a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener">Open in Google Maps</a>`,
          );
        bounds.push([lat, lng]);
        crewCount++;
      }

      // ── Stop pins: today's schedule + active jobs (deduped by address) ──
      const stops = new Map<string, { color: string; label: string }>();
      for (const s of schedule) {
        if (!s.job) continue;
        const spans = s.sched_date <= ymdT && (s.end_date || s.sched_date) >= ymdT;
        if (!spans) continue;
        const j = jobs.find((x) => x.property === s.job);
        stops.set(s.job, { color: j ? statusColor(j.status) : "#ffcc00", label: "Scheduled today" });
      }
      for (const j of jobs) {
        if (!j.archived && j.status === "active" && j.property && !stops.has(j.property)) {
          stops.set(j.property, { color: statusColor("active"), label: "Active job" });
        }
      }
      if (cancelled) return;
      if (stops.size > 0) setNote(`Locating ${stops.size} stop${stops.size === 1 ? "" : "s"}…`);
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
              `<a href="https://www.google.com/maps?q=${encodeURIComponent(addr)}" target="_blank" rel="noopener">Open in Google Maps</a>`,
            );
          bounds.push([c.lat, c.lng]);
        }
        // Nominatim policy: ~1 req/s for real (uncached) lookups only.
        if (!had) await new Promise((r) => setTimeout(r, 1100));
      }

      if (cancelled) return;
      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [45, 45], maxZoom: 14 });
        setNote("");
      } else {
        setNote("No crew stamps or stops yet today — dots appear as the crew clocks in.");
      }
      if (crewCount === 0 && bounds.length > 0) {
        setNote("No crew stamps yet today — showing today's stops.");
      }
    })();
    return () => {
      cancelled = true;
      if (mapObj.current) { mapObj.current.remove(); mapObj.current = null; }
    };
  }, [refreshKey]);

  return (
    <div className="fi">
      <div className="row mb" style={{ alignItems: "center" }}>
        <button className="bo" onClick={() => setPage("more")} style={{ fontSize: 14, padding: "4px 8px" }}>←</button>
        <h2 style={{ fontSize: 20, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 7, flex: 1 }}>
          <Icon name="map" size={18} color="var(--color-primary)" /> Crew Map
        </h2>
        <button className="bo" onClick={() => setRefreshKey((k) => k + 1)} style={{ fontSize: 13, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Icon name="refresh" size={13} /> Refresh
        </button>
      </div>

      {note && <div className="dim" style={{ fontSize: 13, marginBottom: 8 }}>{note}</div>}

      <div
        ref={mapRef}
        style={{ height: "calc(100dvh - 250px)", minHeight: 380, borderRadius: 14, overflow: "hidden", border: "1px solid var(--color-border-dark, #1e1e2e)" }}
      />

      <div className="dim" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
        <b style={{ color: "#7fb6ff" }}>Blue circles</b> = crew, at their last clock-in/out stamp today (no live tracking — one-shot stamps only).{" "}
        <b style={{ color: "#ffe07a" }}>Pins</b> = today&apos;s scheduled stops + active jobs, colored by status.
      </div>
    </div>
  );
}
