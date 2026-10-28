"use client";
/**
 * Record a quote approval for a homeowner who doesn't approve online — they
 * said yes in person, on the phone, or signed a paper copy. Posts to
 * /api/jobs/record-approval, which locks the job exactly like the /status
 * "Approve & Sign" (picked option's price + crew work order, status →
 * accepted, approval record noting how it was approved).
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { apiFetch } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { TierKey } from "@/lib/tiers";
import { readBlob } from "@/lib/job-blob";

type Job = { id: string; client?: string | null; property?: string | null; total?: number | null; rooms?: unknown };
type Via = "in_person" | "phone" | "paper";

const VIA_LABEL: Record<Via, string> = { in_person: "In person", phone: "By phone", paper: "Signed paper copy" };
const HUE: Record<TierKey, string> = { base: "#8a8a99", better: "#2E75B6", best: "#9d4edd" };

export default function RecordApprovalSheet({ job, onClose }: { job: Job; onClose: () => void }) {
  const blob: Record<string, unknown> = readBlob(job.rooms);
  const tt = blob.tierTotals as Record<TierKey, number> | undefined;
  const tiered = blob.tieredQuote === true && !!tt;
  const names = (blob.tierNames as { better?: string; best?: string } | undefined) || {};
  const optName = (k: TierKey) => (k === "base" ? "Base" : names[k] || (k === "better" ? "Better" : "Best"));

  const [tier, setTier] = useState<TierKey | null>(null);
  const [via, setVia] = useState<Via>("in_person");
  const [name, setName] = useState(job.client || "");
  const [signOnScreen, setSignOnScreen] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  // Signature pad: dark ink on white, sized to the device pixel ratio.
  useEffect(() => {
    if (!signOnScreen) return;
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111";
    setHasInk(false);
  }, [signOnScreen]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext("2d"); if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d"); if (!ctx) return;
    const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
    if (!hasInk) setHasInk(true);
  };
  const up = () => { drawing.current = false; };
  const clearPad = () => {
    const c = canvasRef.current; const ctx = c?.getContext("2d");
    if (c && ctx) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore(); }
    setHasInk(false);
  };

  const save = async () => {
    if (tiered && !tier) { useStore.getState().showToast("Pick the option the homeowner chose", "warning"); return; }
    if (!name.trim()) { useStore.getState().showToast("Enter the homeowner's name", "warning"); return; }
    if (signOnScreen && !hasInk) { useStore.getState().showToast("Have them sign in the box, or turn off on-screen signing", "warning"); return; }
    setBusy(true);
    try {
      const signature = signOnScreen && hasInk ? canvasRef.current?.toDataURL("image/png") : undefined;
      const res = await apiFetch("/api/jobs/record-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, tier: tier || undefined, via, name: name.trim(), signature }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { useStore.getState().showToast(data.error || "Couldn't record the approval", "error"); setBusy(false); return; }
      await useStore.getState().loadAll();
      useStore.getState().showToast(
        `Approved${tier ? ` — ${optName(tier)} $${Math.round(tt![tier]).toLocaleString()}` : ""}. Job moved to Accepted.`,
        "success",
      );
      onClose();
    } catch {
      useStore.getState().showToast("Couldn't record the approval — check your connection", "error");
      setBusy(false);
    }
  };

  const chip = (on: boolean, hue = "#2E75B6"): React.CSSProperties => ({
    padding: "8px 12px", borderRadius: 10, cursor: "pointer", fontSize: 14,
    border: on ? `2px solid ${hue}` : "1px solid var(--color-border-dark-2, #333)",
    background: on ? `${hue}26` : "transparent", color: "inherit",
  });

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="cd" style={{ width: "100%", maxWidth: 520, maxHeight: "92vh", overflowY: "auto", borderRadius: "16px 16px 0 0", padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <h3 style={{ fontFamily: "Oswald", fontSize: 18, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icon name="checkCircle" size={18} /> Record approval
          </h3>
          <button className="bo" onClick={onClose} style={{ padding: "4px 10px" }}>✕</button>
        </div>
        <div className="dim" style={{ fontSize: 13, marginBottom: 12 }}>
          For a homeowner who approved without the online link. This locks the price, cuts the crew&apos;s work order to what they bought, and moves the job to Accepted.
        </div>

        {tiered && (
          <>
            <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>Option they chose</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
              {(["base", "better", "best"] as TierKey[]).map((k) => (
                <button key={k} type="button" onClick={() => setTier(k)} style={{ ...chip(tier === k, HUE[k]), textAlign: "center", padding: "10px 6px" }}>
                  <div style={{ fontFamily: "Oswald", fontSize: 13, textTransform: "uppercase", color: HUE[k], fontWeight: 700 }}>{optName(k)}</div>
                  <div style={{ fontFamily: "Oswald", fontSize: 18, fontWeight: 700 }}>${Math.round(tt![k]).toLocaleString()}</div>
                </button>
              ))}
            </div>
          </>
        )}
        {!tiered && (
          <div style={{ fontSize: 14, marginBottom: 14 }}>Quote total: <b>${Math.round(Number(job.total) || 0).toLocaleString()}</b></div>
        )}

        <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>How they approved</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {(Object.keys(VIA_LABEL) as Via[]).map((v) => (
            <button key={v} type="button" onClick={() => setVia(v)} style={chip(via === v)}>{VIA_LABEL[v]}</button>
          ))}
        </div>

        <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>Homeowner&apos;s name</div>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Full name" style={{ marginBottom: 12 }} />

        {via === "in_person" && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={signOnScreen} onChange={(e) => setSignOnScreen(e.target.checked)} style={{ width: 18, height: 18, minHeight: 0, padding: 0, flexShrink: 0 }} />
              Have them sign on this screen
            </label>
            {signOnScreen && (
              <div style={{ marginTop: 8 }}>
                <canvas
                  ref={canvasRef}
                  onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
                  style={{ width: "100%", height: 150, background: "#fff", borderRadius: 10, touchAction: "none", display: "block" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                  <span className="dim" style={{ fontSize: 12 }}>Sign above</span>
                  <button type="button" className="bo" onClick={clearPad} style={{ fontSize: 12, padding: "3px 10px" }}>Clear</button>
                </div>
              </div>
            )}
          </div>
        )}

        <button className="bg" disabled={busy} onClick={save} style={{ width: "100%", padding: 12, fontFamily: "Oswald", fontSize: 16 }}>
          {busy ? "Saving…" : tiered && tier ? `Approve ${optName(tier)} — $${Math.round(tt![tier]).toLocaleString()}` : "Record approval"}
        </button>
      </div>
    </div>
  );
}
