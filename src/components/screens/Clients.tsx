"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";

interface Props {
  setPage: (p: string) => void;
}

export default function Clients({ setPage }: Props) {
  const clients = useStore((s) => s.clients);
  const jobs = useStore((s) => s.jobs);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);

  const [open, setOpen] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");

  // Add form
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  const addClient = async () => {
    if (!name.trim()) { useStore.getState().showToast("Enter client name", "warning"); return; }
    const result = await db.post("clients", {
      name: name.trim(),
      phone,
      email,
      address,
      notes,
    });
    if (!result) { useStore.getState().showToast("Failed to save client", "error"); return; }
    setName(""); setPhone(""); setEmail(""); setAddress(""); setNotes("");
    setShowAdd(false);
    await loadAll();
  };

  const deleteClient = async (id: string) => {
    if (await useStore.getState().showConfirm("Delete Client", "Delete this client?")) {
      await db.del("clients", id);
      loadAll();
    }
  };

  const filtered = search
    ? clients.filter((c) =>
        (c.name + c.phone + c.email + c.address)
          .toLowerCase()
          .includes(search.toLowerCase())
      )
    : clients;

  const border = darkMode ? "#1e1e2e" : "#eee";

  return (
    <div className="fi">
      <div className="row mb" style={{ justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 22, color: "var(--color-primary)" }}>
          👥 Clients ({clients.length})
        </h2>
        <button
          className="bb"
          onClick={() => setShowAdd(!showAdd)}
          style={{ fontSize: 13, padding: "5px 12px" }}
        >
          {showAdd ? "Cancel" : "+ Add Client"}
        </button>
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
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (gate code, dog, special instructions...)"
            style={{ height: 50, marginBottom: 8 }}
          />
          <button className="bg" onClick={addClient} style={{ fontSize: 12 }}>
            Save Client
          </button>
        </div>
      )}

      {/* Search */}
      {clients.length > 3 && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search clients..."
          style={{ marginBottom: 12 }}
        />
      )}

      {/* Client list */}
      {!filtered.length ? (
        <div className="cd" style={{ textAlign: "center", padding: 24 }}>
          <p className="dim">No clients yet — add your first one above</p>
        </div>
      ) : (
        filtered.map((c) => {
          const isOpen = open === c.id;
          const clientJobs = jobs.filter(
            (j) => j.client?.toLowerCase() === c.name?.toLowerCase()
          );
          const totalRevenue = clientJobs.reduce((s, j) => s + (j.total || 0), 0);
          const completedCount = clientJobs.filter(
            (j) => j.status === "complete" || j.status === "invoiced" || j.status === "paid"
          ).length;

          return (
            <div key={c.id} className="cd mb">
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  cursor: "pointer",
                  flexWrap: "wrap",
                  gap: 6,
                }}
                onClick={() => setOpen(isOpen ? null : c.id)}
              >
                <div>
                  <h4 style={{ fontSize: 14 }}>{c.name}</h4>
                  <div style={{ fontSize: 11 }} className="dim">
                    {c.phone && `📱 ${c.phone}`}
                    {c.phone && c.email && " · "}
                    {c.email && `✉ ${c.email}`}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, fontFamily: "Oswald", color: "var(--color-success)" }}>
                    {clientJobs.length} job{clientJobs.length !== 1 ? "s" : ""}
                  </div>
                  {totalRevenue > 0 && (
                    <div style={{ fontSize: 10 }} className="dim">
                      ${totalRevenue.toLocaleString()}
                    </div>
                  )}
                </div>
              </div>

              {/* Expanded */}
              {isOpen && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${border}` }}>
                  {/* Contact details */}
                  <div style={{ fontSize: 12, marginBottom: 8 }}>
                    {c.address && (
                      <div className="sep">
                        <span className="dim">Address:</span>{" "}
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "var(--color-primary)", textDecoration: "none" }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          📍 {c.address}
                        </a>
                      </div>
                    )}
                    {c.notes && (
                      <div className="sep">
                        <span className="dim">Notes:</span> {c.notes}
                      </div>
                    )}
                    <div className="sep">
                      <span className="dim">Jobs:</span> {clientJobs.length} total · {completedCount} completed · ${totalRevenue.toLocaleString()} revenue
                    </div>
                  </div>

                  {/* Job history */}
                  {clientJobs.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <h5 style={{ fontSize: 13, marginBottom: 4, color: "var(--color-primary)" }}>Job History</h5>
                      {clientJobs.slice(0, 10).map((j) => (
                        <div
                          key={j.id}
                          className="sep"
                          style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}
                        >
                          <span>{j.property}</span>
                          <span className="dim">{j.job_date}</span>
                          <span style={{
                            color: j.status === "paid" ? "var(--color-success)" : "var(--color-warning)",
                            fontFamily: "Oswald",
                          }}>
                            {j.status} · ${(j.total || 0).toFixed(0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Inline edit fields */}
                  <div className="g2" style={{ marginBottom: 6 }}>
                    <input
                      defaultValue={c.phone}
                      placeholder="Phone"
                      style={{ fontSize: 11 }}
                      onBlur={async (e) => {
                        if (e.target.value !== c.phone) {
                          await db.patch("clients", c.id, { phone: e.target.value });
                          loadAll();
                        }
                      }}
                    />
                    <input
                      defaultValue={c.email}
                      placeholder="Email"
                      style={{ fontSize: 11 }}
                      onBlur={async (e) => {
                        if (e.target.value !== c.email) {
                          await db.patch("clients", c.id, { email: e.target.value });
                          loadAll();
                        }
                      }}
                    />
                  </div>
                  <input
                    defaultValue={c.notes}
                    placeholder="Notes"
                    style={{ fontSize: 13, marginBottom: 6 }}
                    onBlur={async (e) => {
                      if (e.target.value !== c.notes) {
                        await db.patch("clients", c.id, { notes: e.target.value });
                        loadAll();
                      }
                    }}
                  />

                  <button
                    className="bo"
                    onClick={(e) => { e.stopPropagation(); deleteClient(c.id); }}
                    style={{ fontSize: 12, padding: "4px 10px", color: "var(--color-accent-red)" }}
                  >
                    Delete Client
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
