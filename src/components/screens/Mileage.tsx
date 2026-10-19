"use client";
import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { haversineMiles, ROAD_FACTOR, geocodeAddress, hasGeocodeCache, cityContext } from "@/lib/geo";
import { subscribeDrive, getDriveState, getServerDriveState, startDrive, finishDrive, cancelDrive, holdDrive, type DriveTrip } from "@/lib/drive-tracker";
import { parseEntryDate } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { Icon } from "../Icon";
import TopBar from "@/components/TopBar";
import CountUp from "@/components/CountUp";
import { groupTripsByDay, dayLabel, legStartTimes, clockOf, formatClock, clockMinutes, type LegStart, type TripDay } from "@/lib/mileage-days";

interface MileageEntry {
  id: string;
  job: string;
  trip_date: string;
  start_miles: number;
  end_miles: number;
  total_miles: number;
  user_name: string;
  created_at?: string;
  start_time?: string | null;
}

/** Odometer readings → miles, or null unless both are numbers and end > start. */
function odoMiles(start: string, end: string): number | null {
  const s = parseFloat(start), e = parseFloat(end);
  return !isNaN(s) && !isNaN(e) && e > s ? Math.round((e - s) * 10) / 10 : null;
}

/* ── Suggested trips from the day's clock-ins ──────────────────────
   The app already knows where the user went: time entries carry the job
   address. Build the day's driving chain (shop → job A → job B → shop),
   estimate each leg (straight-line × ROAD_FACTOR — same estimate the GPS
   snapshot trip uses), and offer one-tap logging. No background GPS, no
   battery cost; a consistent date+purpose+miles log is IRS-defensible.
   Addresses are located via OpenStreetMap's Nominatim (free, no key) —
   sequential requests with a polite delay, cached per address in
   localStorage so each address is geocoded ONCE ever per device. */

/** "3:42 PM" → minutes since midnight, for ordering the day's stops. */
function timeToMinutes(t?: string): number {
  const m = (t || "").match(/(\d+):(\d+)\s*([AP]M)?/i);
  if (!m) return 0;
  let h = parseInt(m[1]);
  const mm = parseInt(m[2]);
  const ap = m[3]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + mm;
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type SuggestedLeg = {
  from: string; to: string; miles: number; added: boolean;
  /** odometer readings typed for this leg — replace the estimate when set */
  odo?: { start: string; end: string };
};

function SuggestedTrips({ entries, loaded, onAdded }: { entries: MileageEntry[]; loaded: boolean; onAdded: () => void }) {
  const user = useStore((s) => s.user)!;
  const org = useStore((s) => s.org);
  const timeEntries = useStore((s) => s.timeEntries);
  const [date, setDate] = useState(() => localYmd(new Date()));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [legs, setLegs] = useState<SuggestedLeg[] | null>(null);
  const jobs = useStore((s) => s.jobs);
  // A trip the suggestions missed (or a day with no clocked jobs).
  const [extra, setExtra] = useState<{ from: string; to: string; miles: string; startOdo: string; endOdo: string; time: string } | null>(null);
  // The log as of NOW, not as of the Find tap — geocoding can take seconds
  // while the log loads or reloads underneath it.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  // Legs saved from this card this session. A reload racing the post can
  // briefly hand back a log without the new row; this keeps re-finding from
  // offering it again.
  const postedRef = useRef<{ id?: string; date: string; to: string; miles: number }[]>([]);
  // One add at a time — a double-tap on Add all used to run two loops over
  // the same legs and post every trip twice.
  const addingRef = useRef(false);
  const [adding, setAdding] = useState(false);
  // Once the log carries a saved row, the log speaks for it — so deleting
  // that trip later frees the leg again.
  useEffect(() => {
    const ids = new Set(entries.map((e) => e.id));
    postedRef.current = postedRef.current.filter((p) => !p.id || !ids.has(p.id));
  }, [entries]);

  const normAddr = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

  const findTrips = async () => {
    setBusy(true);
    setNote("");
    setLegs(null);
    try {
      // The day's job stops for THIS user, in clock-in order — carrying the
      // entry's own GPS stamp when one was captured. The stamp is where the
      // tech actually parked, so it beats geocoding the address text (which
      // is usually a bare street address with no city and used to fail or,
      // worse, resolve to a same-named street in another town — the main
      // reason suggested trips came back empty or with absurd mileage).
      type Stop = { addr: string; lat?: number | null; lng?: number | null };
      const stops: Stop[] = timeEntries
        .filter((e) => e.user_id === user.id && e.job && e.job !== "General")
        .filter((e) => {
          const d = parseEntryDate(e.entry_date);
          return d ? localYmd(d) === date : false;
        })
        .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time))
        .map((e) => ({ addr: e.job, lat: e.start_lat ?? e.end_lat, lng: e.start_lng ?? e.end_lng }));

      // Chain: home base (org address, when set) → jobs in order → back to base.
      const chain: Stop[] = [];
      const base = (org?.address || "").trim();
      if (base) chain.push({ addr: base });
      for (const s of stops) chain.push(s);
      if (base && stops.length > 0) chain.push({ addr: base });
      // Drop consecutive repeats (two entries at the same property ≠ a drive).
      const deduped = chain.filter((a, i) => i === 0 || normAddr(a.addr) !== normAddr(chain[i - 1].addr));

      if (deduped.length < 2) {
        setNote(stops.length === 0 ? t("loc.noClockedJobs") : t("loc.oneAddress"));
        return;
      }

      // Resolve coordinates per unique address: GPS stamp first (free,
      // exact), geocode as fallback — anchored to the org's city so bare
      // street addresses stop resolving out of town.
      const coords = new Map<string, { lat: number; lng: number } | null>();
      for (const s of deduped) {
        const k = normAddr(s.addr);
        if (!coords.get(k) && s.lat != null && s.lng != null) coords.set(k, { lat: s.lat, lng: s.lng });
      }
      const ctx = cityContext(org?.address);
      for (const s of deduped) {
        const k = normAddr(s.addr);
        if (coords.get(k)) continue;
        const hadCache = hasGeocodeCache(s.addr);
        coords.set(k, await geocodeAddress(s.addr, ctx));
        // Nominatim usage policy: max ~1 req/s. Only throttle real requests.
        if (!hadCache) await new Promise((r) => setTimeout(r, 1100));
      }

      // A leg already in the log (same day, same destination, ~same miles —
      // e.g. from an earlier "Add all") shows as logged so re-finding the
      // day can't double-post it. Each logged trip covers ONE leg. Rows this
      // card just saved count too, unless the log already has them (by id).
      const logNow = entriesRef.current;
      const logIds = new Set(logNow.map((e) => e.id));
      const candidates = [
        ...logNow.map((e) => ({ key: e.id, date: e.trip_date, to: e.job, miles: Number(e.total_miles || 0) })),
        ...postedRef.current
          .filter((p) => !p.id || !logIds.has(p.id))
          .map((p, i) => ({ key: `posted:${i}`, date: p.date, to: p.to, miles: p.miles })),
      ];
      const usedEntries = new Set<string>();
      const alreadyLogged = (to: string, miles: number) => {
        const hit = candidates.find((e) => !usedEntries.has(e.key) && e.date === date && e.to === to
          && Math.abs(e.miles - miles) < 0.2);
        if (hit) usedEntries.add(hit.key);
        return !!hit;
      };

      const out: SuggestedLeg[] = [];
      let unlocated = 0;
      for (let i = 1; i < deduped.length; i++) {
        const a = coords.get(normAddr(deduped[i - 1].addr));
        const b = coords.get(normAddr(deduped[i].addr));
        if (!a || !b) { unlocated++; continue; }
        const miles = Math.round(haversineMiles(a.lat, a.lng, b.lat, b.lng) * ROAD_FACTOR * 10) / 10;
        if (miles < 0.2) continue; // same block — not a loggable drive
        out.push({ from: deduped[i - 1].addr, to: deduped[i].addr, miles, added: alreadyLogged(deduped[i].addr, miles) });
      }
      setLegs(out);
      if (unlocated > 0) setNote(`${unlocated} ${t("loc.legsSkipped")}`);
      if (out.length === 0 && unlocated === 0) setNote(t("loc.allClose"));
    } finally {
      setBusy(false);
    }
  };

  // Resolves true when the trip landed (a failed write is already toasted by
  // db.post and stays un-logged so it can be retried).
  const postLeg = async (idx: number): Promise<boolean> => {
    if (!legs || legs[idx].added) return false;
    const leg = legs[idx];
    const odo = leg.odo ? odoMiles(leg.odo.start, leg.odo.end) : null;
    if (leg.odo && (leg.odo.start || leg.odo.end) && odo == null) {
      useStore.getState().showToast("Ending odometer must be more than the starting one", "warning");
      return false;
    }
    const saved = await db.post<{ id?: string }>("mileage", {
      user_id: user.id,
      user_name: user.name,
      job: leg.to,
      trip_date: date,
      start_miles: odo != null ? parseFloat(leg.odo!.start) : 0,
      end_miles: odo != null ? parseFloat(leg.odo!.end) : 0,
      total_miles: odo ?? leg.miles,
    });
    if (!saved) return false;
    postedRef.current.push({ id: saved[0]?.id, date, to: leg.to, miles: leg.miles });
    setLegs((prev) => prev ? prev.map((l, i) => (i === idx ? { ...l, added: true } : l)) : prev);
    onAdded();
    return true;
  };

  const addLeg = async (idx: number) => {
    if (addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    try {
      await postLeg(idx);
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  const addAll = async () => {
    if (!legs || addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    try {
      let mi = 0;
      let failed = false;
      for (let i = 0; i < legs.length; i++) {
        if (legs[i].added) continue;
        // Offline / failed — stop, don't toast-spam. db.post's error toast
        // stays up (no success toast over it) and the leg keeps its Add button.
        if (!(await postLeg(i))) { failed = true; break; }
        const o = legs[i].odo ? odoMiles(legs[i].odo!.start, legs[i].odo!.end) : null;
        mi += o ?? legs[i].miles;
      }
      if (mi > 0 && !failed) {
        const day = new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
        useStore.getState().showToast(t("loc.loggedToday").replace("{mi}", mi.toFixed(1)).replace("{date}", day), "success");
      }
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  const setLegOdo = (idx: number, odo: SuggestedLeg["odo"]) =>
    setLegs((prev) => prev ? prev.map((l, i) => (i === idx ? { ...l, odo } : l)) : prev);

  const addExtra = async () => {
    if (!extra || addingRef.current) return;
    const odo = odoMiles(extra.startOdo, extra.endOdo);
    const miles = odo ?? parseFloat(extra.miles);
    if (!miles || miles <= 0) {
      useStore.getState().showToast("Enter the miles, or both odometer readings (end more than start)", "warning");
      return;
    }
    const to = extra.to.trim(), from = extra.from.trim();
    addingRef.current = true;
    setAdding(true);
    try {
      const saved = await db.post("mileage", {
        user_id: user.id,
        user_name: user.name,
        job: (from && to ? `${from} → ${to}` : to || from) || "General",
        trip_date: date,
        start_time: extra.time ? formatClock(clockMinutes(extra.time)!) : null,
        start_miles: odo != null ? parseFloat(extra.startOdo) : 0,
        end_miles: odo != null ? parseFloat(extra.endOdo) : 0,
        total_miles: Math.round(miles * 10) / 10,
      });
      if (!saved) return; // db.post toasted — keep what was typed
      useStore.getState().showToast(`Logged ${miles.toFixed(1)} mi`, "success");
      setExtra(null);
      onAdded();
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  const pending = (legs || []).filter((l) => !l.added);
  const short = (s: string) => (s.length > 26 ? s.slice(0, 26) + "…" : s);

  return (
    <div className="cd mb">
      <h4 style={{ fontSize: 16, marginBottom: 4, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="navigation" size={15} color="var(--color-primary)" /> {t("loc.suggestedTrips")}
      </h4>
      <div className="dim" style={{ fontSize: 13, marginBottom: 8 }}>
        {t("loc.suggestedTripsSub")}
      </div>
      <div className="row mb" style={{ alignItems: "center" }}>
        <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setLegs(null); setNote(""); }} style={{ fontSize: 14, flex: 1 }} />
        {/* Find waits for the trip log — matching against an empty log would
            offer every already-logged leg again. */}
        <button className="bb" onClick={findTrips} disabled={busy || !loaded} style={{ fontSize: 14, padding: "6px 14px" }}>
          {busy ? t("loc.locating") : t("loc.findTrips")}
        </button>
      </div>
      {note && <div className="dim" style={{ fontSize: 13, marginBottom: 6 }}>{note}</div>}
      {legs && legs.map((leg, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: i === 0 ? "none" : "1px solid var(--color-border-dark, #1e1e2e)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {short(leg.from)} → {short(leg.to)}
            </div>
            {(() => {
              const odo = leg.odo ? odoMiles(leg.odo.start, leg.odo.end) : null;
              return odo != null
                ? <div style={{ fontSize: 12, color: "var(--color-success)" }}>{odo.toFixed(1)} mi (odometer)</div>
                : <div className="dim" style={{ fontSize: 12 }}>~{leg.miles.toFixed(1)} mi ({t("loc.estimated")})</div>;
            })()}
            {leg.odo && !leg.added && (
              <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
                <input type="number" inputMode="numeric" value={leg.odo.start} onChange={(e) => setLegOdo(i, { ...leg.odo!, start: e.target.value })} placeholder="Odometer start" style={{ flex: 1, minWidth: 0, fontSize: 13 }} />
                <input type="number" inputMode="numeric" value={leg.odo.end} onChange={(e) => setLegOdo(i, { ...leg.odo!, end: e.target.value })} placeholder="Odometer end" style={{ flex: 1, minWidth: 0, fontSize: 13 }} />
              </div>
            )}
          </div>
          {leg.added ? (
            <span style={{ fontSize: 13, color: "var(--color-success)", flexShrink: 0 }}>✓ {t("loc.logged")}</span>
          ) : (
            <>
              <button
                className="bo"
                onClick={() => setLegOdo(i, leg.odo ? undefined : { start: "", end: "" })}
                title="Use odometer readings"
                aria-label="Use odometer readings"
                style={{ fontSize: 12, padding: "4px 8px", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, alignSelf: "flex-start" }}
              >
                <Icon name="mileage" size={13} /> {leg.odo ? "Est." : "Odo"}
              </button>
              <button className="bo" onClick={() => addLeg(i)} disabled={adding} style={{ fontSize: 13, padding: "4px 12px", flexShrink: 0, alignSelf: "flex-start" }}>{t("sched.add")}</button>
            </>
          )}
        </div>
      ))}
      {legs && pending.length > 1 && (
        <button className="bg" onClick={addAll} disabled={adding} style={{ fontSize: 14, padding: "6px 14px", marginTop: 8 }}>
          {t("loc.addAll")} {pending.length} ({pending.reduce((s, l) => s + l.miles, 0).toFixed(1)} mi)
        </button>
      )}

      {/* Trips the suggestions don't know about — another stop, a supply
          run, a day without clock-ins. Miles or odometer readings. */}
      {!extra ? (
        <button className="bo" onClick={() => setExtra({ from: "", to: "", miles: "", startOdo: "", endOdo: "", time: "" })} style={{ width: "100%", fontSize: 13.5, padding: "7px 0", marginTop: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Icon name="add" size={14} /> Add a trip that&apos;s not listed
        </button>
      ) : (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--color-border-dark, #1e1e2e)" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>Add a trip · {date}</div>
          <input value={extra.from} onChange={(e) => setExtra({ ...extra, from: e.target.value })} placeholder="From (optional) — shop, supply house…" style={{ width: "100%", marginBottom: 6 }} />
          <input list="mileage-trip-jobs" value={extra.to} onChange={(e) => setExtra({ ...extra, to: e.target.value })} placeholder="To — job address or place" style={{ width: "100%", marginBottom: 6 }} />
          <input type="time" value={extra.time} onChange={(e) => setExtra({ ...extra, time: e.target.value })} aria-label="Start time (optional)" title="Start time (optional)" style={{ width: "100%", marginBottom: 6 }} />
          <datalist id="mileage-trip-jobs">
            {jobs.filter((j) => !j.archived).map((j) => <option key={j.id} value={j.property} />)}
          </datalist>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
            <input type="number" inputMode="decimal" value={extra.miles} onChange={(e) => setExtra({ ...extra, miles: e.target.value })} placeholder="Miles" disabled={odoMiles(extra.startOdo, extra.endOdo) != null} style={{ flex: 1, minWidth: 0 }} />
            <span className="dim" style={{ fontSize: 12 }}>or</span>
            <input type="number" inputMode="numeric" value={extra.startOdo} onChange={(e) => setExtra({ ...extra, startOdo: e.target.value })} placeholder="Odo start" style={{ flex: 1, minWidth: 0 }} />
            <input type="number" inputMode="numeric" value={extra.endOdo} onChange={(e) => setExtra({ ...extra, endOdo: e.target.value })} placeholder="Odo end" style={{ flex: 1, minWidth: 0 }} />
          </div>
          {odoMiles(extra.startOdo, extra.endOdo) != null && (
            <div style={{ fontSize: 12.5, color: "var(--color-success)", marginBottom: 6 }}>{odoMiles(extra.startOdo, extra.endOdo)!.toFixed(1)} mi from the odometer</div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button className="bo" onClick={() => setExtra(null)} style={{ flex: 1, fontSize: 13.5, padding: "7px 0" }}>Cancel</button>
            <button className="bg" onClick={addExtra} disabled={adding} style={{ flex: 1, fontSize: 13.5, padding: "7px 0" }}>Log trip</button>
          </div>
        </div>
      )}
      <div className="dim" style={{ fontSize: 10.5, marginTop: 8 }}>
        {t("loc.distanceNote")}
      </div>
    </div>
  );
}

interface Props {
  setPage: (p: string) => void;
}

// setPage stays in Props for AppShell's uniform call; Back walks history.
export default function Mileage(_props: Props) {
  const user = useStore((s) => s.user)!;
  const jobs = useStore((s) => s.jobs);
  const darkMode = useStore((s) => s.darkMode);

  const [entries, setEntries] = useState<MileageEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Bumped after every write; each bump refetches the log and only the newest
  // fetch may land. (The old render-time fetch fired on every render while
  // unloaded, and an older response arriving last dropped the newest row.)
  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => { setLoaded(false); setReloadTick((n) => n + 1); };

  // Trip tracking state
  const [tripActive, setTripActive] = useState(false);
  const [tripStartedAt, setTripStartedAt] = useState("");
  const [tripJob, setTripJob] = useState("");
  const [startMiles, setStartMiles] = useState("");
  const [endMiles, setEndMiles] = useState("");


  // Log-entry edit (add odometer readings / fix the miles after the fact)
  const [editing, setEditing] = useState<{ id: string; startOdo: string; endOdo: string; miles: string } | null>(null);

  // GPS trip — the shared drive tracker (same one as Work Mode's Start
  // drive): a saved start point + fixes while open + a fix on every return,
  // so the screen can lock and Maps can take over. Survives closing the app.
  const [trackMode, setTrackMode] = useState<"gps" | "manual">("gps");
  const [gpsJob, setGpsJob] = useState("");
  const [gpsStartOdo, setGpsStartOdo] = useState("");
  const [gpsErr, setGpsErr] = useState("");
  const [gpsBusy, setGpsBusy] = useState(false);
  const { trip: gpsTrip, error: driveErr } = useSyncExternalStore(subscribeDrive, getDriveState, getServerDriveState);
  // After End: the finished trip + its GPS miles, to confirm (or correct with
  // the odometer / by hand) before saving.
  const [gpsReview, setGpsReview] = useState<{ trip: DriveTrip; miles: string; endOdo: string } | null>(null);
  const gpsInProgress = !!gpsTrip || !!gpsReview;
  const savingTripRef = useRef(false);

  // Load entries
  useEffect(() => {
    let live = true;
    // strict: a failed fetch must NOT blank the log and mark it loaded —
    // Suggested trips' "already logged" check would then re-post every leg.
    db.get<MileageEntry>("mileage", { user_id: user.id }, { strict: true }).then((data) => {
      if (!live) return;
      setEntries(data);
      setLoaded(true);
    }).catch(() => { /* keep what we had; Find stays off until the log loads */ });
    return () => { live = false; };
  }, [user.id, reloadTick]);

  // Signal back → reload the log (a failed load leaves Find disabled until then).
  useEffect(() => {
    const on = () => setReloadTick((n) => n + 1);
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, []);

  const totalMiles = entries.reduce((s, e) => s + (e.total_miles || 0), 0);
  const thisWeek = (() => {
    const now = new Date();
    const ws = new Date(now);
    ws.setDate(now.getDate() - now.getDay());
    ws.setHours(0, 0, 0, 0);
    return entries
      .filter((e) => {
        // parseEntryDate reads "YYYY-MM-DD" as a LOCAL day (new Date() took it
        // as UTC midnight, sliding Sunday trips into last week).
        const d = parseEntryDate(e.trip_date);
        return d ? d >= ws : false;
      })
      .reduce((s, e) => s + (e.total_miles || 0), 0);
  })();

  const startTrip = () => {
    if (!startMiles) { useStore.getState().showToast("Enter starting odometer", "warning"); return; }
    setTripStartedAt(clockOf(new Date()));
    setTripActive(true);
  };

  const endTrip = async () => {
    if (!endMiles) { useStore.getState().showToast("Enter ending odometer", "warning"); return; }
    const start = parseFloat(startMiles);
    const end = parseFloat(endMiles);
    if (end <= start) { useStore.getState().showToast("End miles must be greater than start", "warning"); return; }
    const total = end - start;

    const saved = await db.post("mileage", {
      user_id: user.id,
      user_name: user.name,
      job: tripJob || "General",
      trip_date: localYmd(new Date()),
      start_time: tripStartedAt || null,
      start_miles: start,
      end_miles: end,
      total_miles: total,
    });
    if (!saved) return; // db.post toasted — keep the readings so End can retry

    setTripActive(false);
    setStartMiles("");
    setEndMiles("");
    setTripJob("");
    reload();
  };

  // ── GPS trip ──
  const startGpsTrip = () => {
    if (gpsBusy || gpsTrip) return;
    setGpsErr("");
    if (!startDrive(gpsJob, { startOdo: gpsStartOdo.trim() })) {
      setGpsErr("This device can't share location. Use Odometer mode instead.");
    }
  };

  // End: last fix, then review. The ending odometer is pre-filled from the
  // start reading + GPS miles for the user to correct.
  const endGpsTrip = async () => {
    if (!gpsTrip || gpsBusy) return;
    setGpsErr("");
    setGpsBusy(true);
    const res = await finishDrive(12000);
    setGpsBusy(false);
    if (!res) return;
    const startNum = parseFloat(res.trip.startOdo || "");
    setGpsReview({
      trip: res.trip,
      miles: res.miles >= 0.1 ? res.miles.toFixed(1) : "",
      endOdo: !isNaN(startNum) && res.miles >= 0.1 ? String(Math.round(startNum + res.miles)) : "",
    });
  };

  // Save: the odometer delta when both readings are there, else the miles.
  const saveGpsTrip = async () => {
    if (!gpsReview || savingTripRef.current) return;
    const r = gpsReview;
    const startOdo = r.trip.startOdo || "";
    const odo = odoMiles(startOdo, r.endOdo);
    const total_miles = odo ?? (Math.round((parseFloat(r.miles) || 0) * 10) / 10);
    if (total_miles < 0.1) {
      useStore.getState().showToast("Enter the miles (or the ending odometer) to log this trip", "warning");
      return;
    }
    savingTripRef.current = true;
    setGpsBusy(true);
    try {
      const saved = await db.post("mileage", {
        user_id: user.id,
        user_name: user.name,
        job: r.trip.job || "General",
        trip_date: localYmd(new Date()),
        start_time: clockOf(new Date(r.trip.startedAt)),
        start_miles: odo != null ? parseFloat(startOdo) : 0,
        end_miles: odo != null ? parseFloat(r.endOdo) : 0,
        total_miles,
      });
      // Failed (offline is common on the road) — db.post toasted. Keep the
      // review up for another Save, and hold the trip so closing the app
      // doesn't lose it.
      if (!saved) { holdDrive(r.trip, total_miles); return; }
      cancelDrive(); // drop a hold left by an earlier failed save
      setGpsReview(null);
      setGpsStartOdo("");
      setGpsJob("");
      useStore.getState().showToast(`Logged ${total_miles.toFixed(1)} mi`, "success");
      reload();
    } finally {
      savingTripRef.current = false;
      setGpsBusy(false);
    }
  };

  // Cancel an in-progress / to-be-reviewed trip without logging anything.
  const discardGpsTrip = () => {
    cancelDrive();
    setGpsReview(null);
  };

  // Save edits to a logged trip (odometer readings added later, or a fix).
  const saveEdit = async () => {
    if (!editing) return;
    const odo = odoMiles(editing.startOdo, editing.endOdo);
    const miles = odo ?? parseFloat(editing.miles);
    if (!miles || miles <= 0) {
      useStore.getState().showToast("Enter the miles, or both odometer readings (end more than start)", "warning");
      return;
    }
    await db.patch("mileage", editing.id, {
      start_miles: odo != null ? parseFloat(editing.startOdo) : 0,
      end_miles: odo != null ? parseFloat(editing.endOdo) : 0,
      total_miles: Math.round(miles * 10) / 10,
    });
    setEditing(null);
    reload();
  };

  const org = useStore((s) => s.org);
  const timeEntries = useStore((s) => s.timeEntries);
  // Each leg's start: its own stored time, else estimated from that day's clock-ins.
  const startsFor = (day: TripDay<MileageEntry>): (LegStart | null)[] =>
    legStartTimes(day, timeEntries.filter((e) => {
      if (e.user_id !== user.id) return false;
      const d = parseEntryDate(e.entry_date);
      return d ? localYmd(d) === day.date : false;
    }), org?.address);
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

    const esc = (v: string) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const tripDays = groupTripsByDay(entries, org?.address, true);
    let anyEstimate = false;
    const rows = tripDays.map((day) => {
      const multi = day.legs.length > 1;
      const starts = startsFor(day);
      if (starts.some((st) => st?.estimated)) anyEstimate = true;
      const legRows = day.legs.map((leg, i) => {
        const e = leg.trip;
        const odo = e.start_miles > 0 ? `${e.start_miles} → ${e.end_miles}` : "—";
        return `<tr${multi && i > 0 ? ' class="leg"' : ""}><td>${i === 0 ? dayLabel(day.date, true) : ""}</td><td style="white-space:nowrap">${starts[i] ? `${starts[i]!.estimated ? "~" : ""}${starts[i]!.time}` : "—"}</td><td>${multi ? `${i + 1}. ` : ""}${esc(leg.from || "—")}</td><td>${leg.toBase ? "Back to shop — " : ""}${esc(e.job)}</td><td style="text-align:right">${odo}</td><td style="text-align:right;font-weight:600">${Number(e.total_miles || 0).toFixed(1)}</td></tr>`;
      }).join("");
      const subtotal = multi
        ? `<tr class="daytot"><td></td><td></td><td colspan="3">${dayLabel(day.date)} — ${day.legs.length} trips · $${(day.miles * IRS_RATE).toFixed(2)}</td><td style="text-align:right">${day.miles.toFixed(1)}</td></tr>`
        : "";
      return legRows + subtotal;
    }).join("");

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
tr.leg td{border-top:none}
tr.daytot td{background:#f0f4f8;font-weight:600;color:#2E75B6;border-bottom:2px solid #d6e2ee}
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
  <div><div class="num">${tripDays.length}</div><div class="lbl">Days Driven</div></div>
  <div><div class="num" style="color:#00cc66">$${totalDeduction}</div><div class="lbl">Tax Deduction (@ $${IRS_RATE}/mi)</div></div>
</div>

<h2>Monthly Summary</h2>
<table><thead><tr><th>Month</th><th style="text-align:right">Trips</th><th style="text-align:right">Miles</th><th style="text-align:right">Deduction</th></tr></thead><tbody>${monthSummary}</tbody></table>

<h2>Trip Details</h2>
<table><thead><tr><th>Date</th><th>Start</th><th>From</th><th>To</th><th style="text-align:right">Odometer</th><th style="text-align:right">Miles</th></tr></thead><tbody>${rows}</tbody></table>

<div style="font-size:12px;color:#666;margin-top:12px;padding:10px;background:#f5f7fa;border-radius:6px">
  ${anyEstimate ? "Times marked ~ are estimated from that day's clock-ins and clock-outs. " : ""}"From" is the previous stop that day (the first trip starts at the business address when one is set).<br/>
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
      {/* Back to wherever Mileage was opened from (More) — going to the
          dashboard pushed a new entry and made system back loop here. */}
      <TopBar title={t("nav.mileage")} icon="mileage" color="#14b8a6" onBack={() => window.history.back()} right={
        <div className="row">
          {entries.length > 0 && (
            <button className="bo" onClick={exportMileagePdf} style={{ fontSize: 14, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="print" size={14} /> Print
            </button>
          )}
        </div>
      } />

      {/* Suggested trips first — end of day, one tap logs the day's
          drives (auto-built from the day's clocked jobs). */}
      <SuggestedTrips entries={entries} loaded={loaded} onAdded={reload} />

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
          /* GPS trip: tap Start → drive freely → tap End → confirm. */
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
              <div className="cta glow-green" onClick={startGpsTrip}>
                <div className="ic"><Icon name="start" size={24} color="#fff" strokeWidth={2} /></div>
                <div className="tx">
                  <b>Start Trip</b>
                  <small>Marks your start — then drive freely</small>
                </div>
                <Icon name="next" size={19} color="#fff" />
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
              <div style={{ fontFamily: "Oswald", fontSize: 30, fontWeight: 700, color: "var(--color-success)", lineHeight: 1.1, marginBottom: 4 }}>
                {gpsTrip.accMiles.toFixed(1)} <span style={{ fontSize: 14 }}>{gpsTrip.stopped ? "mi · not saved yet" : "mi so far"}</span>
              </div>
              <div className="dim" style={{ fontSize: 13, marginBottom: 14 }}>
                {gpsTrip.startOdo ? `Started at ${gpsTrip.startOdo} mi · ` : ""}
                {gpsTrip.stopped ? "tap End to save it" : (gpsTrip.fixes || 0) > 0 ? "start point saved · phone can stay locked" : "finding your start point…"}
              </div>
              {driveErr && <p style={{ fontSize: 12.5, margin: "-6px 0 10px", color: "var(--color-accent-red)" }}>{driveErr}</p>}
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
              {(() => {
                const r = gpsReview!;
                const startOdo = r.trip.startOdo || "";
                const odo = odoMiles(startOdo, r.endOdo);
                const total = odo ?? (parseFloat(r.miles) || 0);
                return (
                  <>
                    <div style={{ textAlign: "center", marginBottom: 10 }}>
                      <div className="dim" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".5px" }}>
                        {odo != null ? "From your odometer" : r.miles ? "GPS estimate" : "GPS couldn't measure this drive"}
                      </div>
                      <div style={{ fontFamily: "Oswald", fontSize: 40, fontWeight: 700, color: total > 0 ? "var(--color-success)" : "var(--color-dim)", lineHeight: 1.1 }}>
                        {total.toFixed(1)} <span style={{ fontSize: 16 }}>mi</span>
                      </div>
                    </div>
                    <div className="dim" style={{ fontSize: 12.5, marginBottom: 4 }}>Miles (adjust if needed)</div>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={r.miles}
                      onChange={(e) => setGpsReview((x) => (x ? { ...x, miles: e.target.value } : x))}
                      placeholder="Miles driven"
                      disabled={odo != null}
                      style={{ width: "100%", marginBottom: 8, opacity: odo != null ? 0.5 : 1 }}
                    />
                    <div className="dim" style={{ fontSize: 12.5, marginBottom: 4 }}>Odometer (optional)</div>
                    <div className="row" style={{ gap: 6, marginBottom: 10 }}>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={startOdo}
                        onChange={(e) => setGpsReview((x) => (x ? { ...x, trip: { ...x.trip, startOdo: e.target.value } } : x))}
                        placeholder="Start"
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <input
                        type="number"
                        inputMode="numeric"
                        value={r.endOdo}
                        onChange={(e) => setGpsReview((x) => (x ? { ...x, endOdo: e.target.value } : x))}
                        placeholder="End"
                        style={{ flex: 1, minWidth: 0 }}
                      />
                    </div>
                  </>
                );
              })()}
              <div className="row" style={{ gap: 6 }}>
                <button className="bo" onClick={discardGpsTrip} style={{ flex: 1, fontSize: 14, padding: "9px 0" }}>Discard</button>
                <button className="bb" onClick={saveGpsTrip} disabled={gpsBusy} style={{ flex: 1, fontSize: 14, padding: "9px 0" }}>Save trip</button>
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

      {/* Mileage Log — grouped by day so a multi-stop day reads as a route:
          numbered legs, where each one started, and the day's total. */}
      <div className="cd">
        <h4 style={{ fontSize: 15, marginBottom: 6 }}>Trip Log ({entries.length})</h4>
        {!entries.length ? (
          <p className="dim" style={{ fontSize: 14 }}>No trips logged</p>
        ) : (
          groupTripsByDay(entries, org?.address).map((day) => {
            const multi = day.legs.length > 1;
            const starts = startsFor(day);
            return (
              <div key={day.date} className="sep" style={{ paddingTop: 8, paddingBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                  <b style={{ fontSize: 14.5, flex: 1 }}>{dayLabel(day.date)}</b>
                  {multi && <span className="dim" style={{ fontSize: 12.5 }}>{day.legs.length} trips</span>}
                  <span style={{ fontFamily: "Oswald", color: "var(--color-success)", fontSize: 15 }}>{day.miles.toFixed(1)} mi</span>
                  <span className="dim" style={{ fontSize: 12.5, minWidth: 48, textAlign: "right" }}>${(day.miles * IRS_RATE).toFixed(2)}</span>
                </div>
                {day.legs.map((leg, i) => {
                  const e = leg.trip;
                  const st = starts[i];
                  if (editing?.id === e.id) {
                    const odo = odoMiles(editing.startOdo, editing.endOdo);
                    return (
                      <div key={e.id} style={{ padding: "6px 0", borderTop: i === 0 ? "none" : "1px dashed var(--color-border-dark, #1e1e2e)" }}>
                        <div style={{ fontSize: 14, color: "var(--color-primary)", marginBottom: 6 }}>{e.job}</div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                          <input type="number" inputMode="numeric" value={editing.startOdo} onChange={(ev) => setEditing({ ...editing, startOdo: ev.target.value })} placeholder="Odo start" style={{ flex: 1, minWidth: 0 }} />
                          <input type="number" inputMode="numeric" value={editing.endOdo} onChange={(ev) => setEditing({ ...editing, endOdo: ev.target.value })} placeholder="Odo end" style={{ flex: 1, minWidth: 0 }} />
                          <span className="dim" style={{ fontSize: 12 }}>or</span>
                          <input type="number" inputMode="decimal" value={editing.miles} onChange={(ev) => setEditing({ ...editing, miles: ev.target.value })} placeholder="Miles" disabled={odo != null} style={{ width: 70 }} />
                        </div>
                        {odo != null && <div style={{ fontSize: 12.5, color: "var(--color-success)", marginBottom: 6 }}>{odo.toFixed(1)} mi from the odometer</div>}
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="bo" onClick={() => setEditing(null)} style={{ flex: 1, fontSize: 13, padding: "5px 0" }}>Cancel</button>
                          <button className="bg" onClick={saveEdit} style={{ flex: 1, fontSize: 13, padding: "5px 0" }}>Save</button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: i === 0 ? "none" : "1px dashed var(--color-border-dark, #1e1e2e)" }}>
                      {multi && (
                        <span style={{ width: 20, height: 20, borderRadius: 10, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 700, background: "rgba(20,184,166,.16)", color: "#14b8a6" }}>{i + 1}</span>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, color: "var(--color-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {leg.toBase ? <>Back to shop <span className="dim">· {e.job}</span></> : e.job}
                        </div>
                        {(st || leg.from || e.start_miles > 0) && (
                          <div className="dim" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {st && (
                              <b style={{ color: "#14b8a6", fontWeight: 600 }} title={st.estimated ? "Estimated from your clock-ins" : undefined}>
                                {st.estimated ? "~" : ""}{st.time}
                              </b>
                            )}
                            {st && (leg.from || e.start_miles > 0) && " · "}
                            {leg.from && <>from {leg.from}</>}
                            {leg.from && e.start_miles > 0 && " · "}
                            {e.start_miles > 0 && <>odometer {e.start_miles}→{e.end_miles}</>}
                          </div>
                        )}
                      </div>
                      {multi && (
                        <span style={{ fontFamily: "Oswald", fontSize: 14, minWidth: 50, textAlign: "right", flexShrink: 0 }}>
                          {Number(e.total_miles || 0).toFixed(1)} mi
                        </span>
                      )}
                      <button
                        onClick={() => setEditing({
                          id: e.id,
                          startOdo: e.start_miles > 0 ? String(e.start_miles) : "",
                          endOdo: e.end_miles > 0 ? String(e.end_miles) : "",
                          miles: String(e.total_miles ?? ""),
                        })}
                        style={{ background: "none", color: "var(--color-dim)", fontSize: 14, display: "inline-flex", alignItems: "center", flexShrink: 0 }}
                        aria-label="Edit trip — miles or odometer"
                        title="Add odometer readings / fix miles"
                      >
                        <Icon name="edit" size={14} />
                      </button>
                      <button
                        onClick={async () => {
                          if (!await useStore.getState().showConfirm("Delete Trip", `Delete the ${Number(e.total_miles || 0).toFixed(1)} mi trip to ${e.job} on ${dayLabel(day.date)}?`)) return;
                          await db.del("mileage", e.id);
                          reload();
                        }}
                        style={{ background: "none", color: "var(--color-accent-red)", fontSize: 14, display: "inline-flex", alignItems: "center", flexShrink: 0 }}
                        aria-label="Delete trip"
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
        {entries.length > 0 && (
          <div className="dim" style={{ fontSize: 11.5, marginTop: 6 }}>
            Times with ~ are estimated from your clock-ins and clock-outs.
          </div>
        )}
      </div>
    </div>
  );
}
