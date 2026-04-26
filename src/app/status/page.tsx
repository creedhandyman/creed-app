"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { db } from "@/lib/supabase";
import type { Job, Organization } from "@/lib/types";
import { Suspense } from "react";

const STATUS_STEPS = [
  { key: "quoted", label: "Quoted", icon: "📝" },
  { key: "accepted", label: "Accepted", icon: "✅" },
  { key: "scheduled", label: "Scheduled", icon: "📅" },
  { key: "active", label: "In Progress", icon: "🔨" },
  { key: "complete", label: "Complete", icon: "🏁" },
  { key: "invoiced", label: "Invoiced", icon: "🧾" },
  { key: "paid", label: "Paid", icon: "💰" },
];

function StatusContent() {
  const params = useSearchParams();
  const jobId = params.get("job");

  const [job, setJob] = useState<Job | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [workOrder, setWorkOrder] = useState<{ room: string; detail: string; done: boolean }[]>([]);

  useEffect(() => {
    if (!jobId) { setLoading(false); return; }
    db.get<Job>("jobs", { id: jobId }).then((jobs) => {
      if (jobs.length) {
        const j = jobs[0];
        setJob(j);
        // Parse work order
        try {
          const data = typeof j.rooms === "string" ? JSON.parse(j.rooms) : j.rooms;
          setWorkOrder((data?.workOrder || []).map((w: { room: string; detail: string; done: boolean }) => ({
            room: w.room, detail: w.detail, done: w.done,
          })));
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

  // Signature pad
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [signed, setSigned] = useState(false);
  const [submittingSig, setSubmittingSig] = useState(false);

  const getPos = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  }, []);

  const startDraw = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    setIsDrawing(true);
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }, [getPos]);

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

  const stopDraw = useCallback(() => setIsDrawing(false), []);

  const clearSig = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      setSigned(false);
    }
  };

  const submitSignature = async () => {
    if (!canvasRef.current || !job || !jobId) return;
    setSubmittingSig(true);
    const sigData = canvasRef.current.toDataURL("image/png");
    // Signature on a "quoted" job auto-promotes it to "accepted" so the
    // contractor's workload view reflects the new state without a manual
    // status flip. Other statuses stay as-is — re-signing a paid invoice
    // shouldn't reset its workflow state.
    const patch: Record<string, unknown> = {
      client_signature: sigData,
      signature_date: new Date().toLocaleDateString(),
    };
    if (job.status === "quoted") patch.status = "accepted";
    await db.patch("jobs", jobId, patch);
    setJob({
      ...job,
      client_signature: sigData,
      signature_date: new Date().toLocaleDateString(),
      status: job.status === "quoted" ? "accepted" : job.status,
    });
    setSubmittingSig(false);
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#2E75B6", fontFamily: "Oswald", fontSize: 18 }}>Loading...</div>
      </div>
    );
  }

  if (!job) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f, #0d1530)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
          <h1 style={{ fontFamily: "Oswald", fontSize: 22, color: "#C00000" }}>Job Not Found</h1>
          <p style={{ color: "#888", fontSize: 13, marginTop: 8 }}>This link may be invalid or the job has been removed.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f, #0d1530)", padding: 20 }}>
      <div style={{ maxWidth: 500, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          {org?.logo_url && (
            <img src={org.logo_url} alt="" style={{ height: 50, display: "block", margin: "0 auto 8px" }}
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          )}
          <h1 style={{ fontFamily: "Oswald", fontSize: 20, color: "#2E75B6", textTransform: "uppercase" }}>
            {org?.name || "Job Status"}
          </h1>
          {org?.phone && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{org.phone}</div>}
        </div>

        {/* Job info */}
        <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <h2 style={{ fontFamily: "Oswald", fontSize: 16, color: "#e2e2e8", marginBottom: 8 }}>{job.property}</h2>
          <div style={{ fontSize: 12, color: "#888" }}>
            {job.client && <div>Client: {job.client}</div>}
            {job.job_date && <div>Date: {job.job_date}</div>}
          </div>
        </div>

        {/* Status timeline */}
        <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <h3 style={{ fontFamily: "Oswald", fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 12 }}>
            Status
          </h3>
          {STATUS_STEPS.map((step, i) => {
            const isDone = i <= currentIdx;
            const isCurrent = i === currentIdx;
            return (
              <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: i < STATUS_STEPS.length - 1 ? 0 : 0 }}>
                {/* Dot + line */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 24 }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: "50%",
                    background: isDone ? (isCurrent ? "#2E75B6" : "#00cc66") : "#1e1e2e",
                    border: `2px solid ${isDone ? (isCurrent ? "#2E75B6" : "#00cc66") : "#333"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, color: "#fff",
                    boxShadow: isCurrent ? "0 0 10px rgba(46,117,182,0.5)" : "none",
                  }}>
                    {isDone ? (isCurrent ? step.icon : "✓") : ""}
                  </div>
                  {i < STATUS_STEPS.length - 1 && (
                    <div style={{ width: 2, height: 20, background: isDone && i < currentIdx ? "#00cc66" : "#1e1e2e" }} />
                  )}
                </div>
                {/* Label */}
                <div style={{
                  fontSize: 12, fontFamily: isCurrent ? "Oswald" : "Source Sans 3",
                  color: isDone ? (isCurrent ? "#2E75B6" : "#00cc66") : "#555",
                  fontWeight: isCurrent ? 700 : 400,
                  paddingBottom: i < STATUS_STEPS.length - 1 ? 16 : 0,
                }}>
                  {step.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Work order progress */}
        {workOrder.length > 0 && (
          <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <h3 style={{ fontFamily: "Oswald", fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>
              Work Progress
            </h3>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#888" }}>{completedCount} of {workOrder.length} tasks</span>
              <span style={{ fontSize: 11, color: completedCount === workOrder.length ? "#00cc66" : "#2E75B6", fontFamily: "Oswald" }}>
                {Math.round((completedCount / workOrder.length) * 100)}%
              </span>
            </div>
            <div style={{ height: 6, background: "#1e1e2e", borderRadius: 3 }}>
              <div style={{
                height: 6, borderRadius: 3, transition: "width 0.3s",
                background: completedCount === workOrder.length ? "#00cc66" : "#2E75B6",
                width: `${(completedCount / workOrder.length) * 100}%`,
              }} />
            </div>
            <div style={{ marginTop: 10 }}>
              {workOrder.map((w, i) => (
                <div key={i} style={{
                  fontSize: 11, padding: "4px 0",
                  borderBottom: i < workOrder.length - 1 ? "1px solid #1e1e2e" : "none",
                  display: "flex", alignItems: "center", gap: 6,
                  opacity: w.done ? 0.5 : 1,
                  textDecoration: w.done ? "line-through" : "none",
                  color: "#ccc",
                }}>
                  <span style={{ fontSize: 12 }}>{w.done ? "✅" : "⬜"}</span>
                  <span><b style={{ color: "#2E75B6" }}>{w.room}</b> — {w.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Total */}
        {job.total > 0 && (
          <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 16, textAlign: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "#888", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em" }}>
              {job.status === "paid" ? "Amount Paid" : "Quote Total"}
            </div>
            <div style={{ fontSize: 28, fontFamily: "Oswald", fontWeight: 700, color: job.status === "paid" ? "#00cc66" : "#2E75B6" }}>
              ${job.total.toLocaleString()}
            </div>
          </div>
        )}

        {/* Signature */}
        <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <h3 style={{ fontFamily: "Oswald", fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>
            Client Approval
          </h3>

          {job.client_signature ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#00cc66", marginBottom: 6 }}>✅ Signed on {job.signature_date}</div>
              <img
                src={job.client_signature}
                alt="Signature"
                style={{ maxWidth: "100%", height: 60, border: "1px solid #1e1e2e", borderRadius: 6, background: "#0a0a0f" }}
              />
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>
                Sign below to approve this work:
              </div>
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
                style={{
                  width: "100%",
                  height: 100,
                  border: "1px solid #333",
                  borderRadius: 6,
                  background: "#0a0a0f",
                  cursor: "crosshair",
                  touchAction: "none",
                }}
              />
              <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
                <button
                  onClick={clearSig}
                  style={{ background: "none", color: "#888", fontSize: 11, padding: 0, textDecoration: "underline" }}
                >
                  Clear
                </button>
                <button
                  onClick={submitSignature}
                  disabled={!signed || submittingSig}
                  style={{
                    padding: "8px 20px", borderRadius: 8, fontSize: 13,
                    fontFamily: "Oswald", textTransform: "uppercase",
                    background: signed ? "#00cc66" : "#333",
                    color: "#fff", opacity: signed ? 1 : 0.5,
                  }}
                >
                  {submittingSig ? "Saving..." : "✍ Submit Signature"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", color: "#555", fontSize: 10, marginTop: 16 }}>
          Powered by Creed App
        </div>
      </div>
    </div>
  );
}

export default function StatusPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0a0f" }} />}>
      <StatusContent />
    </Suspense>
  );
}
