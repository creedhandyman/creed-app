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
  const org = useStore((s) => s.org);
  const jobs = useStore((s) => s.jobs);
  const receipts = useStore((s) => s.receipts);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);

  const [jobTab, setJobTab] = useState<"active" | "billing" | "paid">("active");
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
    if (s === "paid") return "var(--color-success)";
    if (s === "invoiced" || s === "complete") return "#00cc66";
    if (s === "active" || s === "scheduled") return "var(--color-primary)";
    if (s === "accepted") return "var(--color-highlight)";
    return "var(--color-warning)";
  };

  const generateInvoice = (j: typeof jobs[0]) => {
    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Invoice — ${j.property}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Source+Sans+3:wght@400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Source Sans 3',sans-serif;color:#1a1a2a;font-size:12px}
.page{max-width:700px;margin:0 auto;padding:40px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:3px solid #2E75B6}
h1{font-family:Oswald;font-size:22px;color:#2E75B6;text-transform:uppercase;letter-spacing:.05em}
.llc{font-family:Oswald;font-size:10px;color:#C00000;letter-spacing:.15em}
.info{font-size:10px;color:#666;margin-top:4px;line-height:1.6}
.inv-label{text-align:right}
.inv-label h2{font-family:Oswald;font-size:20px;color:#2E75B6;text-transform:uppercase}
.inv-label .date{font-size:11px;color:#666;margin-top:2px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px}
.box{background:#f5f7fa;border-radius:6px;padding:10px 14px}
.box .label{font-family:Oswald;font-size:9px;text-transform:uppercase;color:#888;letter-spacing:.08em}
.box .value{font-size:13px;font-weight:600;margin-top:2px}
table{width:100%;border-collapse:collapse;margin-bottom:20px}
th{font-family:Oswald;text-transform:uppercase;font-size:9px;letter-spacing:.06em;color:#fff;background:#2E75B6;padding:6px 10px;text-align:left}
td{padding:5px 10px;border-bottom:1px solid #eee}
.total-row{font-weight:700;background:#f0f4f8;border-top:2px solid #2E75B6}
.total-row td{font-family:Oswald;font-size:14px}
.amount-due{text-align:center;margin:24px 0;padding:20px;background:#f0f4f8;border-radius:8px}
.amount-due .label{font-family:Oswald;font-size:11px;color:#888;text-transform:uppercase}
.amount-due .value{font-family:Oswald;font-size:32px;color:#2E75B6;font-weight:700}
.terms{font-size:10px;color:#666;line-height:1.6;margin-bottom:20px}
.footer{border-top:1px solid #ddd;padding-top:8px;text-align:center;font-size:9px;color:#888}
@media print{.page{padding:20px}}
</style></head><body><div class="page">
<div class="header">
  <div><h1>${org?.name || "Handyman Service"}</h1>
  <div class="info">${org?.phone ? "☎ " + org.phone + "<br/>" : ""}${org?.email ? "✉ " + org.email + "<br/>" : ""}${org?.license_num ? "License #" + org.license_num : ""}</div></div>
  <div class="inv-label"><h2>Invoice</h2><div class="date">${today}</div></div>
</div>
<div class="grid">
  <div class="box"><div class="label">Bill To</div><div class="value">${j.client || "Client"}</div></div>
  <div class="box"><div class="label">Property</div><div class="value">${j.property}</div></div>
  <div class="box"><div class="label">Job Date</div><div class="value">${j.job_date || "—"}</div></div>
  <div class="box"><div class="label">Status</div><div class="value">Due Upon Receipt</div></div>
</div>
<table>
  <thead><tr><th>Description</th><th style="text-align:right">Hours</th><th style="text-align:right">Labor</th><th style="text-align:right">Materials</th><th style="text-align:right">Total</th></tr></thead>
  <tbody>
    <tr><td>Property repairs at ${j.property}</td><td style="text-align:right">${(j.total_hrs || 0).toFixed(1)}</td><td style="text-align:right">$${(j.total_labor || 0).toFixed(2)}</td><td style="text-align:right">$${(j.total_mat || 0).toFixed(2)}</td><td style="text-align:right">$${(j.total || 0).toFixed(2)}</td></tr>
    <tr class="total-row"><td colspan="4">Amount Due</td><td style="text-align:right">$${(j.total || 0).toFixed(2)}</td></tr>
  </tbody>
</table>
<div class="amount-due"><div class="label">Total Amount Due</div><div class="value">$${(j.total || 0).toFixed(2)}</div></div>
<div class="terms">
  <b>Payment Terms:</b> Due upon receipt.<br/>
  Please make checks payable to <b>${org?.name || "Handyman Service"}</b>.<br/>
  For questions about this invoice, contact ${org?.phone || ""} ${org?.email ? "or " + org.email : ""}.
</div>
<div class="footer">${org?.name || "Handyman Service"}${org?.address ? " · " + org.address : ""}${org?.phone ? " · " + org.phone : ""}${org?.license_num ? " · Lic #" + org.license_num : ""}</div>
</div></body></html>`;
    const win = window.open("", "_blank");
    if (!win) { alert("Allow popups to generate invoice"); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 600);
  };

  return (
    <div className="fi">
      <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 10 }}>
        📋 Jobs
      </h2>

      {/* Job tabs */}
      {(() => {
        const activeJobs = jobs.filter((j) => !["complete", "invoiced", "paid"].includes(j.status));
        const billingJobs = jobs.filter((j) => j.status === "complete" || j.status === "invoiced");
        const paidJobs = jobs.filter((j) => j.status === "paid");
        const tabs = [
          { id: "active" as const, l: `🔨 Active (${activeJobs.length})`, c: "var(--color-primary)" },
          { id: "billing" as const, l: `🧾 Billing (${billingJobs.length})`, c: "var(--color-warning)" },
          { id: "paid" as const, l: `✅ Paid (${paidJobs.length})`, c: "var(--color-success)" },
        ];
        return (
          <div style={{ display: "flex", gap: 3, marginBottom: 12 }}>
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setJobTab(t.id)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 6,
                  fontSize: 11,
                  background: jobTab === t.id ? t.c : "transparent",
                  color: jobTab === t.id ? "#fff" : "#888",
                  fontFamily: "Oswald",
                  border: `1px solid ${jobTab === t.id ? t.c : darkMode ? "#1e1e2e" : "#ddd"}`,
                }}
              >
                {t.l}
              </button>
            ))}
          </div>
        );
      })()}

      {/* Billing tab header */}
      {jobTab === "billing" && jobs.some((j) => j.status === "complete" || j.status === "invoiced") && (
        <div className="cd mb" style={{ borderLeft: "3px solid var(--color-warning)", padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="sl">Ready to Invoice</div>
              <div style={{ fontSize: 20, fontFamily: "Oswald", fontWeight: 700, color: "var(--color-warning)" }}>
                ${jobs.filter((j) => j.status === "complete" || j.status === "invoiced").reduce((s, j) => s + (j.total || 0), 0).toLocaleString()}
              </div>
            </div>
            {!org?.stripe_connected && (
              <button className="bb" onClick={() => setPage("dash")} style={{ fontSize: 10, padding: "5px 10px" }}>
                Connect Stripe →
              </button>
            )}
          </div>
        </div>
      )}

      {(() => {
        const filtered = jobTab === "active"
          ? jobs.filter((j) => !["complete", "invoiced", "paid"].includes(j.status))
          : jobTab === "billing"
          ? jobs.filter((j) => j.status === "complete" || j.status === "invoiced")
          : jobs.filter((j) => j.status === "paid");

        if (!filtered.length) {
          return (
            <div className="cd" style={{ textAlign: "center", padding: 24 }}>
              <p className="dim">
                {jobTab === "active" ? "No active jobs — create one in QuoteForge" : jobTab === "billing" ? "No jobs ready for billing" : "No paid jobs yet"}
              </p>
              {jobTab === "active" && (
                <button className="bb mt" onClick={() => setPage("qf")}>⚡ Start Quote</button>
              )}
            </div>
          );
        }

        return filtered.map((j) => {
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
                  {j.property && (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.property)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{ fontSize: 10, color: "var(--color-primary)", textDecoration: "none" }}
                    >
                      📍 View on Map
                    </a>
                  )}
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
                    <option value="accepted">Accepted</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="active">Active</option>
                    <option value="complete">Complete</option>
                    <option value="invoiced">Invoiced</option>
                    <option value="paid">Paid</option>
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

                  {/* Invoice */}
                  {(j.status === "complete" || j.status === "invoiced" || j.status === "paid") && (
                    <div className="row" style={{ marginTop: 8 }}>
                      <button
                        className="bb"
                        onClick={(e) => {
                          e.stopPropagation();
                          generateInvoice(j);
                          if (j.status === "complete") {
                            setStatus(j.id, "invoiced");
                          }
                        }}
                        style={{ fontSize: 10, padding: "5px 12px" }}
                      >
                        🧾 {j.status === "complete" ? "Generate Invoice" : "View Invoice"}
                      </button>
                      {(j.status === "invoiced" || j.status === "complete") && j.total > 0 && org?.stripe_connected && (
                        <button
                          className="bb"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const res = await fetch("/api/checkout", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  jobId: j.id,
                                  property: j.property,
                                  client: j.client,
                                  amount: j.total,
                                  orgName: org?.name || "Handyman Service",
                                  stripeAccountId: org?.stripe_account_id || "",
                                }),
                              });
                              const data = await res.json();
                              if (data.url) {
                                navigator.clipboard.writeText(data.url);
                                alert("Payment link copied! Send it to the client.\n\n" + data.url);
                                if (j.status === "complete") setStatus(j.id, "invoiced");
                              } else {
                                alert("Error: " + (data.error || "Could not create payment link"));
                              }
                            } catch { alert("Failed to create payment link"); }
                          }}
                          style={{ fontSize: 10, padding: "5px 12px" }}
                        >
                          💳 Payment Link
                        </button>
                      )}
                      {j.status === "invoiced" && (
                        <button
                          className="bg"
                          onClick={(e) => {
                            e.stopPropagation();
                            setStatus(j.id, "paid");
                          }}
                          style={{ fontSize: 10, padding: "5px 12px" }}
                        >
                          ✅ Mark Paid
                        </button>
                      )}
                    </div>
                  )}

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
        });
      })()}

      <div style={{ textAlign: "center", marginTop: 16 }}>
        <p className="dim" style={{ fontSize: 12 }}>
          {jobTab === "active" ? "💡 Next step: Schedule a job → then start the Timer" : jobTab === "billing" ? "💡 Send payment links to collect from clients" : "💡 All paid — great work!"}
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
