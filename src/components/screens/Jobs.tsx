"use client";
import { useState, useRef } from "react";
import { useStore } from "@/lib/store";
import { db, supabase } from "@/lib/supabase";

interface Props {
  setPage: (p: string) => void;
  onEditJob?: (jobId: string) => void;
}

export default function Jobs({ setPage, onEditJob }: Props) {
  const user = useStore((s) => s.user)!;
  const jobs = useStore((s) => s.jobs);
  const receipts = useStore((s) => s.receipts);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);

  const [open, setOpen] = useState<string | null>(null);
  const [rn, setRn] = useState("");
  const [ra, setRa] = useState("");
  const [rPhoto, setRPhoto] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  const getWorkers = (j: typeof jobs[0]): { id: string; name: string }[] => {
    try {
      const d = typeof j.rooms === "string" ? JSON.parse(j.rooms) : j.rooms;
      return d?.workers || [];
    } catch {
      return [];
    }
  };

  const uploadPhoto = async (file: File, jobId: string): Promise<string> => {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${jobId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("receipts").upload(path, file);
    if (error) throw error;
    const { data } = supabase.storage.from("receipts").getPublicUrl(path);
    return data.publicUrl;
  };

  const addReceipt = async (jobId: string) => {
    if (!rn.trim()) { alert("Enter a receipt note"); return; }
    const amt = parseFloat(ra);
    if (!amt || amt <= 0) { alert("Enter a valid amount"); return; }
    setUploading(true);
    try {
      let photo_url = "";
      if (rPhoto) {
        photo_url = await uploadPhoto(rPhoto, jobId);
      }
      await db.post("receipts", {
        job_id: jobId,
        note: rn,
        amount: parseFloat(ra),
        receipt_date: new Date().toLocaleDateString(),
        photo_url,
      });
      setRn("");
      setRa("");
      setRPhoto(null);
      if (photoRef.current) photoRef.current.value = "";
      loadAll();
    } catch (err) {
      console.error(err);
      alert("Error saving receipt");
    }
    setUploading(false);
  };

  const setStatus = async (id: string, status: string) => {
    await db.patch("jobs", id, { status });
    loadAll();
  };

  const deleteJob = async (id: string) => {
    if (confirm("Delete this job?")) {
      await db.del("jobs", id);
      loadAll();
    }
  };

  const statusColor = (s: string) => {
    if (s === "complete") return "var(--color-success)";
    if (s === "active") return "var(--color-primary)";
    return "var(--color-warning)";
  };

  return (
    <div className="fi">
      <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 14 }}>
        📋 Jobs ({jobs.length})
      </h2>

      {!jobs.length ? (
        <div className="cd" style={{ textAlign: "center", padding: 24 }}>
          <p className="dim">No jobs — create one in QuoteForge</p>
          <button className="bb mt" onClick={() => setPage("qf")}>
            ⚡ Start Quote
          </button>
        </div>
      ) : (
        jobs.map((j) => {
          const w = getWorkers(j);
          const isOpen = open === j.id;

          return (
            <div key={j.id} className="cd mb">
              {/* Collapsed header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  cursor: "pointer",
                  flexWrap: "wrap",
                  gap: 6,
                }}
                onClick={() => setOpen(isOpen ? null : j.id)}
              >
                <div>
                  <h4 style={{ fontSize: 14 }}>{j.property}</h4>
                  <div style={{ fontSize: 11 }} className="dim">
                    {j.client} · {j.job_date}
                    {w.length > 0 && " · 👷 " + w.map((x) => x.name).join(", ")}
                  </div>
                </div>
                <div className="row">
                  <div
                    style={{
                      fontSize: 18,
                      fontFamily: "Oswald",
                      color: "var(--color-success)",
                    }}
                  >
                    ${(j.total || 0).toFixed(0)}
                  </div>
                  <select
                    value={j.status || "quoted"}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      setStatus(j.id, e.target.value);
                    }}
                    style={{
                      fontSize: 10,
                      padding: "2px 6px",
                      width: "auto",
                      background: statusColor(j.status) + "22",
                    }}
                  >
                    <option value="quoted">Quoted</option>
                    <option value="active">Active</option>
                    <option value="complete">Complete</option>
                  </select>
                </div>
              </div>

              {/* Expanded content */}
              {isOpen && (
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: `1px solid ${darkMode ? "#1e1e2e" : "#eee"}`,
                  }}
                >
                  <div className="row">
                    {onEditJob && (
                      <button
                        className="bb"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditJob(j.id);
                        }}
                        style={{ fontSize: 10, padding: "5px 12px" }}
                      >
                        ✏️ Edit Quote
                      </button>
                    )}
                    <button
                      className="bb"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPage("sched");
                      }}
                      style={{ fontSize: 10, padding: "5px 12px" }}
                    >
                      📅 Schedule This
                    </button>
                    <button
                      className="bo"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteJob(j.id);
                      }}
                      style={{ fontSize: 10, padding: "5px 10px", color: "var(--color-accent-red)" }}
                    >
                      Delete
                    </button>
                  </div>

                  {/* Trade + Callback */}
                  <div className="row" style={{ marginTop: 8 }}>
                    <span className="dim" style={{ fontSize: 11 }}>Trade:</span>
                    <select
                      value={j.trade || ""}
                      onClick={(e) => e.stopPropagation()}
                      onChange={async (e) => {
                        e.stopPropagation();
                        await db.patch("jobs", j.id, { trade: e.target.value });
                        loadAll();
                      }}
                      style={{ width: "auto", fontSize: 10, padding: "3px 6px" }}
                    >
                      <option value="">None</option>
                      <option value="Plumbing">Plumbing</option>
                      <option value="Electrical">Electrical</option>
                      <option value="Carpentry">Carpentry</option>
                      <option value="HVAC">HVAC</option>
                      <option value="Painting">Painting</option>
                      <option value="Flooring">Flooring</option>
                      <option value="General">General</option>
                    </select>
                    <label
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                        cursor: "pointer",
                        color: j.callback ? "var(--color-accent-red)" : "#888",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={j.callback || false}
                        onChange={async (e) => {
                          e.stopPropagation();
                          await db.patch("jobs", j.id, { callback: e.target.checked });
                          loadAll();
                        }}
                        style={{ width: "auto", accentColor: "var(--color-accent-red)" }}
                      />
                      Callback
                    </label>
                  </div>

                  {/* Existing Receipts */}
                  {receipts.filter((r) => r.job_id === j.id).length > 0 && (
                    <div className="mt">
                      <h5 style={{ fontSize: 12, marginBottom: 4 }}>Receipts</h5>
                      {receipts
                        .filter((r) => r.job_id === j.id)
                        .map((r) => (
                          <div
                            key={r.id}
                            className="sep"
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              fontSize: 12,
                              gap: 8,
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <span>{r.note || "Receipt"}</span>
                              <span className="dim" style={{ marginLeft: 6 }}>{r.receipt_date}</span>
                            </div>
                            <span style={{ color: "var(--color-success)", fontFamily: "Oswald" }}>
                              ${(r.amount || 0).toFixed(2)}
                            </span>
                            {r.photo_url && (
                              <img
                                src={r.photo_url}
                                alt="receipt"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setViewPhoto(r.photo_url);
                                }}
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 4,
                                  objectFit: "cover",
                                  cursor: "pointer",
                                  border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`,
                                }}
                              />
                            )}
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (confirm("Delete receipt?")) {
                                  await db.del("receipts", r.id);
                                  loadAll();
                                }
                              }}
                              style={{ background: "none", color: "var(--color-accent-red)", fontSize: 12, padding: 0 }}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                    </div>
                  )}

                  {/* Add Receipt */}
                  <div className="mt">
                    <h5 style={{ fontSize: 12, marginBottom: 4 }}>Add Receipt</h5>
                    <div className="row">
                      <input
                        value={rn}
                        onChange={(e) => setRn(e.target.value)}
                        placeholder="Note"
                        style={{ flex: 1 }}
                      />
                      <input
                        type="number"
                        value={ra}
                        onChange={(e) => setRa(e.target.value)}
                        placeholder="$"
                        style={{ width: 60 }}
                      />
                      <button
                        className="bg"
                        onClick={(e) => {
                          e.stopPropagation();
                          addReceipt(j.id);
                        }}
                        style={{ fontSize: 10, padding: "5px 10px" }}
                        disabled={uploading}
                      >
                        {uploading ? "..." : "Add"}
                      </button>
                    </div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <label
                        onClick={(e) => { e.stopPropagation(); photoRef.current?.click(); }}
                        style={{
                          fontSize: 11,
                          color: "var(--color-primary)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        📷 {rPhoto ? rPhoto.name : "Attach photo"}
                      </label>
                      <input
                        ref={photoRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        style={{ display: "none" }}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          setRPhoto(e.target.files?.[0] || null);
                        }}
                      />
                      {rPhoto && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRPhoto(null);
                            if (photoRef.current) photoRef.current.value = "";
                          }}
                          style={{ background: "none", color: "var(--color-accent-red)", fontSize: 11, padding: 0 }}
                        >
                          ✕ Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}

      <div style={{ textAlign: "center", marginTop: 16 }}>
        <p className="dim" style={{ fontSize: 12 }}>
          💡 Next step: Schedule a job → then start the Timer
        </p>
      </div>

      {/* Photo viewer overlay */}
      {viewPhoto && (
        <div
          onClick={() => setViewPhoto(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999,
            cursor: "pointer",
          }}
        >
          <img
            src={viewPhoto}
            alt="Receipt"
            style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 8 }}
          />
        </div>
      )}
    </div>
  );
}
