"use client";
import { useCallback, useRef, useState, type ReactElement } from "react";
import { LONG_SHIFT_MS } from "@/lib/shift";

// "What time did you finish?" — asked instead of booking a forgotten
// clock-out's full 14h / 26h / flat 12h. Promise-based like showConfirm:
//   const [askFinish, finishModal] = useFinishTime();
//   const endAt = await askFinish(startMs, "Jake");  // ms, or null = cancelled
//   ...render {finishModal}

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtStart = (ms: number) =>
  new Date(ms).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

interface Pending { startMs: number; who?: string; resolve: (v: number | null) => void }

export function useFinishTime(): [(startMs: number, who?: string) => Promise<number | null>, ReactElement | null] {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState("");
  const [err, setErr] = useState("");
  const pendingRef = useRef<Pending | null>(null);

  const ask = useCallback((startMs: number, who?: string) => {
    // Default guess: an 8-hour day, never later than now.
    setValue(toLocalInput(Math.min(Date.now(), startMs + 8 * 3600000)));
    setErr("");
    return new Promise<number | null>((resolve) => {
      pendingRef.current?.resolve(null);
      const p = { startMs, who, resolve };
      pendingRef.current = p;
      setPending(p);
    });
  }, []);

  const close = (v: number | null) => {
    pendingRef.current?.resolve(v);
    pendingRef.current = null;
    setPending(null);
  };

  const submit = () => {
    if (!pending) return;
    const end = new Date(value).getTime();
    if (isNaN(end)) return setErr("Pick a date and time.");
    if (end <= pending.startMs) return setErr("Finish time has to be after the clock-in.");
    if (end > Date.now() + 60000) return setErr("Finish time can't be in the future.");
    if (end - pending.startMs > 2 * LONG_SHIFT_MS) return setErr("That's over 24 hours — check the date.");
    close(end);
  };

  const hrs = pending ? (new Date(value).getTime() - pending.startMs) / 3600000 : 0;

  const modal = pending ? (
    <div
      onClick={() => close(null)}
      style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(5,5,12,.72)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "linear-gradient(180deg,#14141e 0%,#12121a 100%)", borderTop: "3px solid #2E75B6", borderRadius: 16, padding: "24px 24px 20px", width: "100%", maxWidth: 380, boxShadow: "0 24px 64px rgba(0,0,0,.6)", color: "#e8e8ee" }}
      >
        <h3 style={{ fontFamily: "Oswald, sans-serif", fontSize: 20, textTransform: "uppercase", color: "#5aa2e6", marginBottom: 10, letterSpacing: ".05em", fontWeight: 600 }}>
          What time did you finish?
        </h3>
        <p style={{ fontSize: 15, color: "#b5b5c0", lineHeight: 1.5, marginBottom: 14 }}>
          {pending.who ? `${pending.who} has` : "You've"} been clocked in since <b style={{ color: "#e8e8ee" }}>{fmtStart(pending.startMs)}</b>.
          {" "}Looks like a forgotten clock-out — set the real finish time so the hours are right.
        </p>
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => { setValue(e.target.value); setErr(""); }}
          style={{ width: "100%", marginBottom: 8 }}
        />
        <div style={{ fontSize: 13, color: err ? "#ff9d9d" : "#8b8b99", minHeight: 18, marginBottom: 14 }}>
          {err || (hrs > 0 ? `${hrs.toFixed(2)} hours` : "")}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={() => close(null)} className="bo" style={{ padding: "9px 18px" }}>Cancel</button>
          <button onClick={submit} className="bb" style={{ padding: "9px 18px" }}>Clock out</button>
        </div>
      </div>
    </div>
  ) : null;

  return [ask, modal];
}
