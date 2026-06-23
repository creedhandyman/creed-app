"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { db } from "@/lib/supabase";
import type { Job, Organization, Room } from "@/lib/types";
import { Suspense } from "react";
import { Icon } from "@/components/Icon";
import { openJobQuotePdf } from "@/lib/quote-pdf";

const STATUS_STEPS = [
  { key: "quoted", label: "Quoted", icon: "📝" },
  { key: "accepted", label: "Accepted", icon: "✅" },
  { key: "scheduled", label: "Scheduled", icon: "📅" },
  { key: "active", label: "In Progress", icon: "🔨" },
  { key: "complete", label: "Complete", icon: "🏁" },
  { key: "invoiced", label: "Invoiced", icon: "🧾" },
  { key: "paid", label: "Paid", icon: "💰" },
];

// Big friendly status hero — color + icon + reassurance line per status.
// `color` drives the gradient/border/icon-tile; `text` is the brighter
// shade for the label so it reads on the dark hero.
const STATUS_HERO: Record<string, { label: string; desc: string; color: string; text: string; icon: string }> = {
  quoted:    { label: "Quote Ready", desc: "Review and approve your quote below", color: "#C00000", text: "#ff7a7a", icon: "📝" },
  accepted:  { label: "Accepted",    desc: "Thanks! We'll get you scheduled soon", color: "#ff8800", text: "#ffb86b", icon: "✅" },
  scheduled: { label: "Scheduled",   desc: "You're on the calendar",               color: "#ffcc00", text: "#ffe07a", icon: "📅" },
  active:    { label: "In Progress", desc: "Your crew is on site",                 color: "#00cc66", text: "#3ee08f", icon: "🔨" },
  complete:  { label: "Complete",    desc: "Work finished — thank you!",           color: "#2E75B6", text: "#7fb6ff", icon: "🏁" },
  invoiced:  { label: "Invoiced",    desc: "Your invoice is ready",                color: "#6a3de8", text: "#b9a3ff", icon: "🧾" },
  paid:      { label: "Paid",        desc: "Payment received — thank you!",        color: "#9d4edd", text: "#d8b6ff", icon: "💰" },
};

function StatusContent() {
  const params = useSearchParams();
  const jobId = params.get("job");
  const token = params.get("t");

  const [job, setJob] = useState<Job | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [workOrder, setWorkOrder] = useState<{ room: string; detail: string; done: boolean }[]>([]);
  // Per-quote discount surfaced from the rooms JSON blob — so customers
  // see "$200 off" or "10% return-customer discount" right above the total.
  const [discount, setDiscount] = useState<{ type: "percent" | "fixed"; value: number; label?: string } | null>(null);
  // Quote scope for the customer-facing line-item breakdown. Mirrors the
  // category aggregation the quote PDF uses (export-pdf.ts).
  const [quoteRooms, setQuoteRooms] = useState<Room[]>([]);
  const [laborRate, setLaborRate] = useState<number | null>(null);

  useEffect(() => {
    if (!jobId) { setLoading(false); return; }
    db.get<Job>("jobs", { id: jobId }).then((jobs) => {
      if (jobs.length) {
        const j = jobs[0];
        setJob(j);
        // Parse work order + discount off the rooms JSON blob
        try {
          const data = typeof j.rooms === "string" ? JSON.parse(j.rooms) : j.rooms;
          setWorkOrder((data?.workOrder || []).map((w: { room: string; detail: string; done: boolean }) => ({
            room: w.room, detail: w.detail, done: w.done,
          })));
          const d = data?.discount;
          if (d && (d.type === "percent" || d.type === "fixed") && typeof d.value === "number" && d.value > 0) {
            setDiscount({ type: d.type, value: d.value, label: typeof d.label === "string" ? d.label : undefined });
          }
          if (Array.isArray(data?.rooms)) setQuoteRooms(data.rooms as Room[]);
          if (typeof data?.laborRate === "number" && data.laborRate > 0) setLaborRate(data.laborRate);
        } catch { /* */ }
        // Load org
        if (j.org_id) {
          db.get<Organization>("organizations", { id: j.org_id }).then((orgs) => {
            if (orgs.length) setOrg(orgs[0]);
          });
        }
      }
      setLoading(false);
    });
  }, [jobId]);

  const currentIdx = job ? STATUS_STEPS.findIndex((s) => s.key === job.status) : -1;
  const completedCount = workOrder.filter((w) => w.done).length;

  // Signature: prospects can either draw on the canvas or type their
  // name + tick the "I authorize" box. Both paths go through the new
  // /api/jobs/approve route which stamps approved_at + approved_ip
  // server-side and auto-promotes a quoted job to accepted.
  const [signMode, setSignMode] = useState<"type" | "draw">("type");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [signed, setSigned] = useState(false);
  const [submittingSig, setSubmittingSig] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [signError, setSignError] = useState("");

  // Deposit / Stripe checkout
  const [depositPct, setDepositPct] = useState(50);
  const [depositLoading, setDepositLoading] = useState(false);

  const getPos = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  }, []);

  // Block page scroll for the whole stroke. Attaching this at the DOCUMENT
  // level on touch-start (before the first touch-move) reliably stops iOS
  // panning — canvas-only touch-action:none wasn't enough. Removed on
  // stop/cancel/unmount. Stable ref so add/remove match.
  const preventScroll = useCallback((e: TouchEvent) => e.preventDefault(), []);

  const startDraw = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    setIsDrawing(true);
    if ("touches" in e) document.addEventListener("touchmove", preventScroll, { passive: false });
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }, [getPos, preventScroll]);

  const draw = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#fff";
    ctx.lineTo(x, y);
    ctx.stroke();
    setSigned(true);
  }, [isDrawing, getPos]);

  const stopDraw = useCallback(() => {
    setIsDrawing(false);
    document.removeEventListener("touchmove", preventScroll);
  }, [preventScroll]);

  // Safety net: if the page unmounts mid-stroke, drop the global scroll-block
  // so the rest of the app can scroll normally again.
  useEffect(() => () => document.removeEventListener("touchmove", preventScroll), [preventScroll]);

  const clearSig = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      setSigned(false);
    }
  };

  const submitApproval = async (signatureType: "typed" | "canvas", signatureValue: string) => {
    if (!job || !jobId || !signatureValue) return;
    setSignError("");
    setSubmittingSig(true);
    try {
      const res = await fetch("/api/jobs/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, token, signatureType, signatureValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSignError(data?.error || "Couldn't save your approval — please try again.");
        setSubmittingSig(false);
        return;
      }
      const stampedDate = new Date().toLocaleDateString();
      setJob({
        ...job,
        client_signature: signatureValue,
        signature_date: stampedDate,
        approved_at: new Date().toISOString(),
        status: data.status || (job.status === "quoted" ? "accepted" : job.status),
      });
    } catch (e) {
      setSignError(e instanceof Error ? e.message : "Network error — please try again.");
    }
    setSubmittingSig(false);
  };

  const submitTypedSignature = () => {
    const name = typedName.trim();
    if (!name) {
      setSignError("Please type your full name to authorize.");
      return;
    }
    if (!authorized) {
      setSignError("Please tick the authorization box.");
      return;
    }
    submitApproval("typed", name);
  };

  const submitCanvasSignature = () => {
    if (!canvasRef.current) return;
    submitApproval("canvas", canvasRef.current.toDataURL("image/png"));
  };

  const startDeposit = async () => {
    if (!job || !jobId || !org) return;
    setDepositLoading(true);
    try {
      const amount = Math.round(job.total * (depositPct / 100) * 100) / 100;
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          property: job.property,
          client: job.client,
          amount,
          orgName: org.name,
          stripeAccountId: org.stripe_account_id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.url) {
        window.location.href = data.url;
      } else {
        setSignError(data?.error || "Couldn't start checkout.");
        setDepositLoading(false);
      }
    } catch (e) {
      setSignError(e instanceof Error ? e.message : "Network error.");
      setDepositLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="pub" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#7fb6ff", fontFamily: "Oswald, sans-serif", fontSize: 20 }}>Loading…</div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="pub" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
          <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: "#ff7a7a", textTransform: "uppercase" }}>Job Not Found</h1>
          <p style={{ color: "#8a8a99", fontSize: 15, marginTop: 8 }}>This link may be invalid or the job has been removed.</p>
        </div>
      </div>
    );
  }

  const hero = STATUS_HERO[job.status] || STATUS_HERO.quoted;
  const pct = workOrder.length ? Math.round((completedCount / workOrder.length) * 100) : 0;

  // Per-category quote breakdown (same aggregation as the PDF estimate
  // summary): collapse rooms by name, section total = hrs × rate + raw
  // materials. rate resolves per-quote override → org default → $55.
  const rate = laborRate || org?.default_rate || 55;
  const breakdown = (() => {
    const byCat: Record<string, { name: string; hrs: number; mat: number; count: number; details: string[] }> = {};
    const order: string[] = [];
    for (const rm of quoteRooms) {
      if (!rm?.items?.length) continue;
      const key = rm.name.trim().toLowerCase();
      if (!byCat[key]) { byCat[key] = { name: rm.name, hrs: 0, mat: 0, count: 0, details: [] }; order.push(key); }
      for (const it of rm.items) {
        byCat[key].hrs += it.laborHrs || 0;
        byCat[key].mat += (it.materials || []).reduce((s, m) => s + (m.c || 0), 0);
        byCat[key].count += 1;
        if (it.detail) byCat[key].details.push(it.detail);
      }
    }
    return order.map((k) => {
      const c = byCat[k];
      return { name: c.name, total: c.hrs * rate + c.mat, blurb: c.details.slice(0, 3).join(", "), count: c.count };
    });
  })();
  const itemCount = breakdown.reduce((s, b) => s + b.count, 0);

  return (
    <div className="pub">
      <div className="pub-wrap">
        {/* Brand header */}
        <div className="bh">
          <div className="logo">
            {org?.logo_url
              ? <img src={org.logo_url} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
              : (org?.name?.[0]?.toUpperCase() || "C")}
          </div>
          <div className="nm">{org?.name || "Job Status"}</div>
          {org?.phone && <div className="ph">{org.phone}</div>}
        </div>

        {/* Hero status */}
        <div className="hero" style={{ background: `linear-gradient(135deg, ${hero.color}38, ${hero.color}0d)`, border: `1px solid ${hero.color}66` }}>
          <div className="ic" style={{ background: `${hero.color}33` }}>{hero.icon}</div>
          <div className="st" style={{ color: hero.text }}>{hero.label}</div>
          <div className="ds">{hero.desc}</div>
        </div>

        {/* Job info */}
        <div className="card">
          <div className="prop">{job.property}</div>
          {(job.client || job.job_date) && (
            <div className="sub">
              {job.client ? `Client: ${job.client}` : ""}
              {job.client && job.job_date ? " · " : ""}
              {job.job_date || ""}
            </div>
          )}
        </div>

        {/* Status timeline */}
        <div className="card">
          <div className="lbl">Progress</div>
          <div className="tl">
            {STATUS_STEPS.map((step, i) => {
              const isDone = i <= currentIdx;
              const isCurrent = i === currentIdx;
              const last = i === STATUS_STEPS.length - 1;
              return (
                <div className="step" key={step.key}>
                  <div className="dotcol">
                    <div className="dot" style={{
                      background: isCurrent ? "#2E75B6" : isDone ? "#00cc66" : "#1e1e2e",
                      boxShadow: isCurrent ? "0 0 10px rgba(46,117,182,.6)" : "none",
                    }}>
                      {isDone ? (isCurrent ? step.icon : "✓") : ""}
                    </div>
                    {!last && <div className="ln" style={{ background: i < currentIdx ? "#00cc66" : "#1e1e2e" }} />}
                  </div>
                  <div className="tlab" style={{
                    color: isCurrent ? "#7fb6ff" : isDone ? "#00cc66" : "#555",
                    fontFamily: isCurrent ? "Oswald, sans-serif" : undefined,
                    fontWeight: isCurrent ? 700 : 400,
                  }}>
                    {step.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Work progress */}
        {workOrder.length > 0 && (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
              <div className="lbl" style={{ margin: 0 }}>Work progress</div>
              <span style={{ fontFamily: "Oswald, sans-serif", color: pct === 100 ? "#3ee08f" : "#7fb6ff", fontSize: 13 }}>{pct}%</span>
            </div>
            <div className="bar"><i style={{ width: `${pct}%`, background: pct === 100 ? "#00cc66" : "#2E75B6" }} /></div>
            <div style={{ marginTop: 11 }}>
              {workOrder.map((w, i) => (
                <div className="wo" key={i}>
                  <span className="tick" style={w.done ? { background: "rgba(0,204,102,.2)" } : { border: "1.5px solid #2a2a3a" }}>{w.done ? "✅" : ""}</span>
                  <span style={w.done ? { opacity: 0.55, textDecoration: "line-through" } : undefined}>
                    <b style={{ color: "#7fb6ff" }}>{w.room}</b> — {w.detail}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quote breakdown — per-category scope + cost (mirrors the PDF) */}
        {breakdown.length > 0 && (
          <div className="card">
            <div className="lbl">Quote breakdown{itemCount > 0 ? ` · ${itemCount} item${itemCount === 1 ? "" : "s"}` : ""}</div>
            {breakdown.map((b, i) => (
              <div className="wo" key={i}>
                <b style={{ color: "#7fb6ff", minWidth: 84, display: "inline-block", flexShrink: 0 }}>{b.name}</b>
                <span style={{ flex: 1, color: "#cfd2da", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.blurb}</span>
                <span style={{ fontFamily: "Oswald, sans-serif", marginLeft: 8, flexShrink: 0 }}>${Math.round(b.total).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}

        {/* Total */}
        {job.total > 0 && (
          <div className="total">
            <div style={{ minWidth: 0 }}>
              <div className="lbl" style={{ margin: 0, color: "#3ee08f" }}>{job.status === "paid" ? "Amount Paid" : "Quote Total"}</div>
              <div className="n">${job.total.toLocaleString()}</div>
              {discount && (
                <div style={{ fontSize: 13, color: "#3ee08f", marginTop: 3 }}>
                  ✓ {discount.label && discount.label.trim()
                    ? discount.label.trim()
                    : (discount.type === "percent"
                        ? `${discount.value}% discount applied`
                        : `$${discount.value.toFixed(2)} discount applied`)}
                </div>
              )}
            </div>
            <span className="chip" style={{ background: "rgba(0,204,102,.16)", color: "#3ee08f" }}>{job.status === "paid" ? "Paid" : "Quote"}</span>
          </div>
        )}

        {/* Download the full quote PDF — same estimate the contractor sends
            (shared builder with the customer portal's Documents section). */}
        {job.total > 0 && (
          <button className="btn ghost" onClick={() => openJobQuotePdf(job, org)} style={{ marginBottom: 13 }}>
            <Icon name="download" size={16} /> Download Quote (PDF)
          </button>
        )}

        {/* Signature + approval */}
        <div className="card">
          <div className="lbl">Approve &amp; Sign</div>

          {job.client_signature ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, color: "#3ee08f", marginBottom: 6 }}>✅ Approved on {job.signature_date}</div>
              {/* Canvas signatures are data URLs (start with "data:");
                  typed signatures are plain strings — render each
                  appropriately. */}
              {job.client_signature.startsWith("data:") ? (
                <img src={job.client_signature} alt="Signature" style={{ maxWidth: "100%", height: 60, border: "1px solid #1e1e2e", borderRadius: 8, background: "#0d0d15" }} />
              ) : (
                <div style={{ fontFamily: "Caveat, cursive, Georgia, serif", fontSize: 28, color: "#f1f2f6", padding: "10px 6px", border: "1px solid #1e1e2e", borderRadius: 8, background: "#0d0d15" }}>
                  {job.client_signature}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Mode toggle */}
              <div style={{ display: "flex", gap: 4, marginBottom: 11, background: "#0d0d15", borderRadius: 10, padding: 3 }}>
                {(["type", "draw"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setSignMode(m); setSignError(""); }}
                    style={{
                      flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 13.5,
                      fontFamily: "Oswald, sans-serif", textTransform: "uppercase", letterSpacing: ".05em",
                      background: signMode === m ? "#2E75B6" : "transparent",
                      color: signMode === m ? "#fff" : "#8a8a99",
                      border: "none", cursor: "pointer",
                    }}
                  >
                    {m === "type" ? "Type name" : "Draw"}
                  </button>
                ))}
              </div>

              {signMode === "type" ? (
                <div>
                  <input
                    className="in"
                    value={typedName}
                    onChange={(e) => setTypedName(e.target.value)}
                    placeholder="Type your full name"
                    autoComplete="name"
                    style={{ fontSize: 18 }}
                  />
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 14, color: "#8a8a99", marginBottom: 11 }}>
                    <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} style={{ marginTop: 2, cursor: "pointer" }} />
                    <span>I authorize {org?.name || "this contractor"} to perform the work described above for ${job.total?.toFixed(2) || "0.00"}.</span>
                  </label>
                  <button className="btn glow-green" onClick={submitTypedSignature} disabled={!typedName.trim() || !authorized || submittingSig}>
                    <Icon name="check" size={17} /> {submittingSig ? "Saving…" : "Approve & Sign"}
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 13, color: "#8a8a99", marginBottom: 6 }}>Draw your signature below to approve this work:</div>
                  <canvas
                    ref={canvasRef}
                    width={340}
                    height={100}
                    onMouseDown={startDraw}
                    onMouseMove={draw}
                    onMouseUp={stopDraw}
                    onMouseLeave={stopDraw}
                    onTouchStart={startDraw}
                    onTouchMove={draw}
                    onTouchEnd={stopDraw}
                    onTouchCancel={stopDraw}
                    style={{ width: "100%", height: 100, border: "1px solid #2a2a3a", borderRadius: 11, background: "#0d0d15", cursor: "crosshair", touchAction: "none" }}
                  />
                  <div className="row" style={{ marginTop: 8, justifyContent: "space-between", alignItems: "center" }}>
                    <button onClick={clearSig} style={{ background: "none", color: "#8a8a99", fontSize: 13, padding: 0, textDecoration: "underline", border: "none", cursor: "pointer" }}>Clear</button>
                    <button className="btn glow-green" onClick={submitCanvasSignature} disabled={!signed || submittingSig} style={{ width: "auto", padding: "10px 22px" }}>
                      <Icon name="check" size={16} /> {submittingSig ? "Saving…" : "Approve & Sign"}
                    </button>
                  </div>
                </div>
              )}

              {signError && (
                <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "#3a0d0d", border: "1px solid #C00000", fontSize: 14, color: "#ff8888" }}>
                  {signError}
                </div>
              )}
            </>
          )}
        </div>

        {/* Deposit button — only after approval, only if total > 0 and
            the contractor has Stripe Connect set up. We default to a 50%
            deposit; the prospect can dial it up to 100% (full payment
            up front) before being routed to Stripe Checkout. */}
        {job.client_signature && job.total > 0 && job.status !== "paid" && org?.stripe_connected && (
          <div className="card">
            <div className="lbl">Pay Deposit</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 11 }}>
              {[25, 50, 100].map((p) => (
                <button
                  key={p}
                  onClick={() => setDepositPct(p)}
                  style={{
                    flex: 1, padding: "9px 0", borderRadius: 9, fontSize: 13.5, fontFamily: "Oswald, sans-serif",
                    background: depositPct === p ? "rgba(46,117,182,.14)" : "transparent",
                    color: depositPct === p ? "#acd2ff" : "#8a8a99",
                    border: `1px solid ${depositPct === p ? "rgba(46,117,182,.9)" : "#2a2a3a"}`,
                    cursor: "pointer",
                  }}
                >
                  {p === 100 ? "Pay in full" : `${p}% deposit`}
                </button>
              ))}
            </div>
            <button className="btn glow-gold" onClick={startDeposit} disabled={depositLoading}>
              <Icon name="pay" size={17} /> {depositLoading ? "Redirecting…" : `Pay $${(job.total * (depositPct / 100)).toFixed(2)} now`}
            </button>
            <p style={{ fontSize: 12, color: "#666", textAlign: "center", margin: "9px 0 0" }}>
              Secure checkout via Stripe.
              {depositPct < 100 && ` Remaining $${(job.total * ((100 - depositPct) / 100)).toFixed(2)} due on completion.`}
            </p>
          </div>
        )}

        {/* Footer */}
        <div style={{ textAlign: "center", color: "#666", fontSize: 12, marginTop: 16 }}>Powered by Creed App</div>
      </div>
    </div>
  );
}

export default function StatusPage() {
  return (
    <Suspense fallback={<div className="pub" />}>
      <StatusContent />
    </Suspense>
  );
}
