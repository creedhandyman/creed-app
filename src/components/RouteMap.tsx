"use client";
/**
 * Map of planned routes (Dispatch Assistant): one colored line per tech
 * (shop → stops → shop, straight segments — there's no routing API, same as
 * the distance estimates), numbered stop pins (new jobs hollow, booked ones
 * solid), the shop, and the crew's last known spots as initials.
 *
 * Leaflet + OpenStreetMap tiles, dynamically imported (browser-only), divIcon
 * markers — the same setup as CrewMap. The map is created once; data changes
 * redraw one layer group and refit the view.
 */
import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapPt { lat: number; lng: number }
export interface MapRoute {
  color: string;
  stops: (MapPt & { n: number; title: string; sub?: string; isNew?: boolean })[];
}
export interface MapCrew extends MapPt { initials: string; color: string; title: string }

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export default function RouteMap({ base, routes, crew = [], height = 300 }: {
  base: MapPt | null;
  routes: MapRoute[];
  crew?: MapCrew[];
  height?: number | string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const lib = useRef<typeof import("leaflet") | null>(null);
  const fit = useRef<[number, number][]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current) return;
      lib.current = L;
      const m = L.map(el.current).setView([37.6872, -97.3301], 11); // Wichita fallback
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(m);
      map.current = m;
      layer.current = L.layerGroup().addTo(m);
      // Refit when the box changes size (rotation, or Leaflet's CSS landing
      // after the map measured itself — it then fits to the wrong size).
      ro = new ResizeObserver(() => {
        m.invalidateSize();
        if (fit.current.length) m.fitBounds(fit.current, { padding: [30, 30], maxZoom: 14, animate: false });
      });
      ro.observe(el.current);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      map.current?.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  const dataKey = JSON.stringify({ base, routes, crew });
  useEffect(() => {
    const L = lib.current, m = map.current, g = layer.current;
    if (!ready || !L || !m || !g) return;
    g.clearLayers();
    const bounds: [number, number][] = [];

    for (const r of routes) {
      const line: [number, number][] = [
        ...(base ? [[base.lat, base.lng] as [number, number]] : []),
        ...r.stops.map((s) => [s.lat, s.lng] as [number, number]),
        ...(base && r.stops.length ? [[base.lat, base.lng] as [number, number]] : []),
      ];
      if (line.length >= 2) L.polyline(line, { color: r.color, weight: 4, opacity: 0.8 }).addTo(g);
      for (const s of r.stops) {
        const fill = s.isNew ? "#fff" : r.color;
        const ink = s.isNew ? r.color : "#fff";
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:26px;height:26px;border-radius:50%;background:${fill};border:2.5px solid ${s.isNew ? r.color : "#fff"};box-shadow:0 2px 7px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;color:${ink};font-weight:700;font-size:12px;font-family:Oswald,sans-serif">${s.n}</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        L.marker([s.lat, s.lng], { icon, zIndexOffset: 500 })
          .addTo(g)
          .bindPopup(`<b>${esc(s.title)}</b>${s.sub ? `<br/>${esc(s.sub)}` : ""}`);
        bounds.push([s.lat, s.lng]);
      }
    }

    if (base) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:30px;height:30px;border-radius:9px;background:#14141c;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      L.marker([base.lat, base.lng], { icon, zIndexOffset: 800 }).addTo(g);
      bounds.push([base.lat, base.lng]);
    }

    for (const c of crew) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:32px;height:32px;border-radius:50%;background:${c.color};border:2.5px solid #fff;box-shadow:0 0 0 4px ${c.color}55,0 2px 8px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:12.5px;font-family:Oswald,sans-serif">${esc(c.initials)}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      L.marker([c.lat, c.lng], { icon, zIndexOffset: 1000 }).addTo(g).bindPopup(esc(c.title));
      bounds.push([c.lat, c.lng]);
    }

    // The container may have been laid out after the map was made.
    m.invalidateSize();
    fit.current = bounds;
    if (bounds.length) m.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, dataKey]);

  return (
    <div
      ref={el}
      style={{ height, minHeight: 220, borderRadius: 14, overflow: "hidden", border: "1px solid var(--color-border-dark, #1e1e2e)" }}
    />
  );
}
