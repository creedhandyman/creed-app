"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { t } from "@/lib/i18n";

interface Props {
  setPage: (p: string) => void;
}

export default function Clients({ setPage }: Props) {
  const clients = useStore((s) => s.clients);
  const jobs = useStore((s) => s.jobs);
  const profiles = useStore((s) => s.profiles);
  const reviews = useStore((s) => s.reviews);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);

  const [open, setOpen] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "revenue" | "recent" | "jobs">("name");

  // Add form
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  const addClient = async () => {
    if (!name.trim()) { useStore.getState().showToast("Enter client name", "warning"); return; }
    const result = await db.post("clients", { name: name.trim(), phone, email, address, notes });
    if (!result) { useStore.getState().showToast("Failed to save client", "error"); return; }
    setName(""); setPhone(""); setEmail(""); setAddress(""); setNotes("");
    setShowAdd(false);
    await loadAll();
  };

  const deleteClient = async (id: string) => {
    if (await useStore.getState().showConfirm("Delete Client", "Delete this client and all associated data?")) {
      await db.del("clients", id);
      loadAll();
    }
  };

  // Compute client stats
  const clientsWithStats = clients.map((c) => {
    const clientJobs = jobs.filter((j) => j.client?.toLowerCase() === c.name?.toLowerCase());
    const completedJobs = clientJobs.filter((j) => ["complete", "invoiced", "paid"].includes(j.status));
    const paidJobs = clientJobs.filter((j) => j.status === "paid");
    const totalRevenue = clientJobs.reduce((s, j) => s + (j.total || 0), 0);
    const paidRevenue = paidJobs.reduce((s, j) => s + (j.total || 0), 0);

    // Last service date
    const sortedByDate = completedJobs.sort((a, b) => (b.job_date || b.created_at || "").localeCompare(a.job_date || a.created_at || ""));
    const lastService = sortedByDate[0]?.job_date || sortedByDate[0]?.created_at?.split("T")[0] || "";

    // Preferred tech (most assigned)
    const techCount: Record<string, number> = {};
    clientJobs.forEach((j) => {
      if (j.requested_tech) techCount[j.requested_tech] = (techCount[j.requested_tech] || 0) + 1;
      try {
        const d = typeof j.rooms === "string" ? JSON.parse(j.rooms) : j.rooms;
        d?.workers?.forEach((w: { name: string }) => { if (w.name) techCount[w.name] = (techCount[w.name] || 0) + 1; });
      } catch { /* */ }
    });
    const preferredTech = Object.entries(techCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

    // Client reviews
    const clientReviews = reviews.filter((r) => r.client_name?.toLowerCase() === c.name?.toLowerCase());
    const avgRating = clientReviews.length ? (clientReviews.reduce((s, r) => s + (r.rating || 0), 0) / clientReviews.length).toFixed(1) : "";

    // Properties (unique addresses)
    const properties = [...new Set(clientJobs.map((j) => j.property).filter(Boolean))];

    return { ...c, clientJobs, completedJobs, totalRevenue, paidRevenue, lastService, preferredTech, avgRating, properties, jobCount: clientJobs.length };
  });

  // Filter + Sort
  const filtered = search
    ? clientsWithStats.filter((c) => (c.name + c.phone + c.email + c.address).toLowerCase().includes(search.toLowerCase()))
    : clientsWithStats;

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "revenue") return b.totalRevenue - a.totalRevenue;
    if (sortBy === "jobs") return b.jobCount - a.jobCount;
    if (sortBy === "recent") return (b.lastService || "").localeCompare(a.lastService || "");
    return a.name.localeCompare(b.name);
  });

  // Portfolio stats
  const totalClients = clients.length;
  const totalClientRevenue = clientsWithStats.reduce((s, c) => s + c.totalRevenue, 0);
  const activeClients = clientsWithStats.filter((c) => c.clientJobs.some((j) => !["complete", "invoiced", "paid"].includes(j.status))).length;

  const border = darkMode ? "#1e1e2e" : "#eee";

  return (
    <div className="fi">
      <div className="row mb" style={{ justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 22, color: "var(--color-primary)" }}>👥 {t("dash.clients")} ({totalClients})</h2>
        <button className="bb" onClick={() => setShowAdd(!showAdd)} style={{ fontSize: 13, padding: "5px 12px" }}>
          {showAdd ? t("common.cancel") : "+ Add"}
        </button>
      </div>

      {/* Portfolio overview */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
        <div className="cd" style={{ textAlign: "center", padding: 10 }}>
          <div className="sl">Clients</div>
          <div style={{ fontSize: 20, fontFamily: "Oswald", color: "var(--color-primary)" }}>{totalClients}</div>
        </div>
        <div className="cd" style={{ textAlign: "center", padding: 10 }}>
          <div className="sl">Active</div>
          <div style={{ fontSize: 20, fontFamily: "Oswald", color: "var(--color-warning)" }}>{activeClients}</div>
        </div>
        <div className="cd" style={{ textAlign: "center", padding: 10 }}>
          <div className="sl">Revenue</div>
          <div style={{ fontSize: 20, fontFamily: "Oswald", color: "var(--color-success)" }}>${totalClientRevenue.toLocaleString()}</div>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="cd mb">
          <h4 style={{ fontSize: 13, marginBottom: 8 }}>New Client</h4>
          <div className="g2 mb">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name *" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
          </div>
          <div className="g2 mb">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" />
          </div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (gate code, dog, special instructions...)" style={{ height: 50, marginBottom: 8 }} />
          <button className="bg" onClick={addClient} style={{ fontSize: 12 }}>Save Client</button>
        </div>
      )}

      {/* Search + Sort */}
      <div className="row mb" style={{ gap: 6 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Search clients..." style={{ flex: 1 }} />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} style={{ width: "auto", fontSize: 12, padding: "6px 8px" }}>
          <option value="name">A-Z</option>
          <option value="revenue">Revenue</option>
          <option value="jobs">Jobs</option>
          <option value="recent">Recent</option>
        </select>
      </div>

      {/* Client list */}
      {!sorted.length ? (
        <div className="cd" style={{ textAlign: "center", padding: 24 }}>
          <p className="dim">No clients yet — add your first one above</p>
        </div>
      ) : (
        sorted.map((c) => {
          const isOpen = open === c.id;

          return (
            <div key={c.id} className="cd mb">
              {/* Header */}
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", flexWrap: "wrap", gap: 6 }}
                onClick={() => setOpen(isOpen ? null : c.id)}
              >
                <div>
                  <h4 style={{ fontSize: 14 }}>{c.name}</h4>
                  <div style={{ fontSize: 12 }} className="dim">
                    {c.phone && `📱 ${c.phone}`}
                    {c.phone && c.email && " · "}
                    {c.email && `✉ ${c.email}`}
                    {c.preferredTech && ` · 👷 ${c.preferredTech}`}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 14, fontFamily: "Oswald", color: "var(--color-success)" }}>
                    ${c.totalRevenue.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 12 }} className="dim">
                    {c.jobCount} job{c.jobCount !== 1 ? "s" : ""}{c.lastService ? ` · Last: ${c.lastService}` : ""}
                  </div>
                </div>
              </div>

              {/* Expanded CRM view */}
              {isOpen && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${border}` }}>

                  {/* Stats row */}
                  <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                    <div style={{ flex: 1, textAlign: "center", padding: 6, borderRadius: 6, background: darkMode ? "#1a1a28" : "#f5f5f8" }}>
                      <div className="sl">Total Jobs</div>
                      <div style={{ fontFamily: "Oswald", color: "var(--color-primary)", fontSize: 16 }}>{c.jobCount}</div>
                    </div>
                    <div style={{ flex: 1, textAlign: "center", padding: 6, borderRadius: 6, background: darkMode ? "#1a1a28" : "#f5f5f8" }}>
                      <div className="sl">Revenue</div>
                      <div style={{ fontFamily: "Oswald", color: "var(--color-success)", fontSize: 16 }}>${c.totalRevenue.toLocaleString()}</div>
                    </div>
                    <div style={{ flex: 1, textAlign: "center", padding: 6, borderRadius: 6, background: darkMode ? "#1a1a28" : "#f5f5f8" }}>
                      <div className="sl">Paid</div>
                      <div style={{ fontFamily: "Oswald", color: "var(--color-highlight)", fontSize: 16 }}>${c.paidRevenue.toLocaleString()}</div>
                    </div>
                    {c.avgRating && (
                      <div style={{ flex: 1, textAlign: "center", padding: 6, borderRadius: 6, background: darkMode ? "#1a1a28" : "#f5f5f8" }}>
                        <div className="sl">Rating</div>
                        <div style={{ fontFamily: "Oswald", color: "var(--color-warning)", fontSize: 16 }}>⭐ {c.avgRating}</div>
                      </div>
                    )}
                  </div>

                  {/* Properties portfolio */}
                  {c.properties.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div className="sl" style={{ marginBottom: 4 }}>📍 Properties ({c.properties.length})</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {c.properties.map((p, i) => (
                          <a
                            key={i}
                            href={`https://www.google.com/maps/search/${encodeURIComponent(p)}`}
                            target="_blank" rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{ fontSize: 12, padding: "3px 8px", borderRadius: 6, background: darkMode ? "#1a1a28" : "#f0f0f5", border: `1px solid ${border}`, color: "var(--color-primary)", textDecoration: "none" }}
                          >
                            {p}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Contact details — editable */}
                  <div className="g2" style={{ marginBottom: 6 }}>
                    <div>
                      <div className="sl" style={{ fontSize: 12 }}>Phone</div>
                      <input defaultValue={c.phone} placeholder="Phone" style={{ fontSize: 13 }} onBlur={async (e) => { if (e.target.value !== c.phone) { await db.patch("clients", c.id, { phone: e.target.value }); loadAll(); } }} />
                    </div>
                    <div>
                      <div className="sl" style={{ fontSize: 12 }}>Email</div>
                      <input defaultValue={c.email} placeholder="Email" style={{ fontSize: 13 }} onBlur={async (e) => { if (e.target.value !== c.email) { await db.patch("clients", c.id, { email: e.target.value }); loadAll(); } }} />
                    </div>
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    <div className="sl" style={{ fontSize: 12 }}>Address</div>
                    <input defaultValue={c.address} placeholder="Address" style={{ fontSize: 13 }} onBlur={async (e) => { if (e.target.value !== c.address) { await db.patch("clients", c.id, { address: e.target.value }); loadAll(); } }} />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <div className="sl" style={{ fontSize: 12 }}>Notes</div>
                    <textarea defaultValue={c.notes} placeholder="Gate code, dog, special instructions..." style={{ fontSize: 13, height: 50 }} onBlur={async (e) => { if (e.target.value !== c.notes) { await db.patch("clients", c.id, { notes: e.target.value }); loadAll(); } }} />
                  </div>

                  {/* Preferred tech */}
                  <div style={{ marginBottom: 10 }}>
                    <div className="sl" style={{ fontSize: 12, marginBottom: 4 }}>👷 Preferred Tech</div>
                    <div className="dim" style={{ fontSize: 13 }}>
                      {c.preferredTech ? `${c.preferredTech} (assigned to ${Object.entries(
                        c.clientJobs.reduce((acc: Record<string, number>, j) => {
                          try { const d = typeof j.rooms === "string" ? JSON.parse(j.rooms) : j.rooms; d?.workers?.forEach((w: { name: string }) => { if (w.name) acc[w.name] = (acc[w.name] || 0) + 1; }); } catch { /* */ }
                          return acc;
                        }, {})
                      ).filter(([n]) => n === c.preferredTech)[0]?.[1] || 0} jobs)` : "No preference — based on assignments"}
                    </div>
                  </div>

                  {/* Job history */}
                  {c.clientJobs.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div className="sl" style={{ marginBottom: 6 }}>📋 Job History</div>
                      {c.clientJobs.slice(0, 10).map((j) => (
                        <div key={j.id} className="sep" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600 }}>{j.property}</div>
                            <div className="dim">{j.job_date}{j.trade ? ` · ${j.trade}` : ""}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 4, background: j.status === "paid" ? "#00cc6622" : j.status === "complete" || j.status === "invoiced" ? "#ff880022" : "#2E75B622", color: j.status === "paid" ? "var(--color-success)" : j.status === "complete" || j.status === "invoiced" ? "var(--color-warning)" : "var(--color-primary)" }}>
                              {j.status}
                            </span>
                            <div style={{ fontFamily: "Oswald", color: "var(--color-success)", fontSize: 13, marginTop: 2 }}>${(j.total || 0).toFixed(0)}</div>
                          </div>
                        </div>
                      ))}
                      {c.clientJobs.length > 10 && <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>+{c.clientJobs.length - 10} more jobs</div>}
                    </div>
                  )}

                  {/* Communication log */}
                  <div style={{ marginBottom: 8 }}>
                    <div className="sl" style={{ marginBottom: 4 }}>💬 Communication Log</div>
                    <textarea
                      defaultValue={(() => { try { return c.notes?.split("---LOG---")[1]?.trim() || ""; } catch { return ""; } })()}
                      placeholder="Log calls, texts, emails with this client..."
                      style={{ fontSize: 13, height: 60 }}
                      onBlur={async (e) => {
                        const baseNotes = c.notes?.split("---LOG---")[0]?.trim() || c.notes || "";
                        const log = e.target.value.trim();
                        const combined = log ? `${baseNotes}\n---LOG---\n${log}` : baseNotes;
                        if (combined !== c.notes) {
                          await db.patch("clients", c.id, { notes: combined });
                          loadAll();
                        }
                      }}
                    />
                  </div>

                  {/* Actions */}
                  <div className="row">
                    <button className="bb" onClick={(e) => { e.stopPropagation(); setPage("qf"); }} style={{ fontSize: 12, padding: "5px 12px" }}>
                      ⚡ New Quote
                    </button>
                    <button className="bo" onClick={(e) => { e.stopPropagation(); deleteClient(c.id); }} style={{ fontSize: 12, padding: "5px 10px", color: "var(--color-accent-red)" }}>
                      🗑 {t("jobs.delete")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
