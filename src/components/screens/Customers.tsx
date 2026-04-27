"use client";
/**
 * Customers — first-class CRM entity introduced in Step 1 of the
 * multi-property roadmap. Coexists with the legacy Clients screen
 * (which lives under Operations and works off the older `clients`
 * table); this screen reads/writes the new `customers` and
 * `addresses` tables.
 *
 * This file is the LIST view. Tapping a row sets `selectedId` which
 * the parent route uses to mount CustomerDetail. While CustomerDetail
 * is being built (Step 1.3), the row tap shows an inline placeholder
 * so the screen is still useful for browsing.
 */
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Icon } from "../Icon";
import type { CustomerType } from "@/lib/types";

interface Props {
  setPage: (p: string) => void;
  onSelect?: (customerId: string) => void;
}

const TYPE_FILTERS: { id: "all" | CustomerType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "individual", label: "Individual" },
  { id: "business", label: "Business" },
  { id: "property_manager", label: "Property Mgr" },
];

const TYPE_LABEL: Record<CustomerType, string> = {
  individual: "Individual",
  business: "Business",
  property_manager: "Property Mgr",
};

const TYPE_COLOR: Record<CustomerType, string> = {
  individual: "var(--color-primary)",
  business: "var(--color-success)",
  property_manager: "var(--color-warning)",
};

export default function Customers({ setPage, onSelect }: Props) {
  const customers = useStore((s) => s.customers);
  const addresses = useStore((s) => s.addresses);
  const jobs = useStore((s) => s.jobs);
  const upsertCustomer = useStore((s) => s.upsertCustomer);
  const darkMode = useStore((s) => s.darkMode);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | CustomerType>("all");
  const [showAdd, setShowAdd] = useState(false);

  // Add-customer form
  const [name, setName] = useState("");
  const [type, setType] = useState<CustomerType>("individual");
  const [primaryContact, setPrimaryContact] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");

  const border = darkMode ? "#1e1e2e" : "#eee";

  const addCustomer = async () => {
    if (!name.trim()) {
      useStore.getState().showToast("Enter customer name", "warning");
      return;
    }
    const created = await upsertCustomer({
      name: name.trim(),
      type,
      primary_contact: primaryContact.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    if (!created) {
      useStore.getState().showToast("Failed to save customer", "error");
      return;
    }
    setName(""); setType("individual"); setPrimaryContact("");
    setPhone(""); setEmail(""); setNotes("");
    setShowAdd(false);
    useStore.getState().showToast(`Added ${created.name}`, "success");
  };

  // Per-customer aggregate: address count, jobs touched, last service,
  // total revenue. Linked-by-customer_id wins; unlinked legacy jobs fall
  // back to a property-string match (the backfill UI in Step 1.5 turns
  // that into real links).
  const customersWithStats = customers.map((c) => {
    const addrs = addresses.filter((a) => a.customer_id === c.id);
    const linkedJobs = jobs.filter((j) => j.customer_id === c.id);
    const fuzzyJobs = linkedJobs.length === 0
      ? jobs.filter((j) => j.client && j.client.toLowerCase() === c.name.toLowerCase())
      : [];
    const allJobs = [...linkedJobs, ...fuzzyJobs];
    const completed = allJobs.filter((j) => ["complete", "invoiced", "paid"].includes(j.status));
    const lastService = completed
      .map((j) => j.job_date || j.created_at?.split("T")[0] || "")
      .sort()
      .reverse()[0] || "";
    const revenue = allJobs.reduce((s, j) => s + (j.total || 0), 0);
    const hasOpen = allJobs.some((j) => !["complete", "invoiced", "paid"].includes(j.status));
    return {
      ...c,
      addrCount: addrs.length,
      jobCount: allJobs.length,
      lastService,
      revenue,
      hasOpen,
      isFuzzy: linkedJobs.length === 0 && fuzzyJobs.length > 0,
    };
  });

  const filtered = customersWithStats
    .filter((c) => typeFilter === "all" || c.type === typeFilter)
    .filter((c) => {
      if (!search.trim()) return true;
      const hay = (c.name + " " + (c.primary_contact || "") + " " + (c.phone || "") + " " + (c.email || "")).toLowerCase();
      return hay.includes(search.trim().toLowerCase());
    });

  const total = customers.length;
  const active = customersWithStats.filter((c) => c.hasOpen).length;
  const totalRevenue = customersWithStats.reduce((s, c) => s + c.revenue, 0);

  return (
    <div className="fi">
      {/* Header */}
      <div className="row mb" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <button className="bo" onClick={() => setPage("dash")} style={{ fontSize: 12, padding: "4px 8px" }}>←</button>
          <h2 style={{ fontSize: 18, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="clients" size={18} color="var(--color-primary)" />
            Customers
          </h2>
        </div>
        <button
          className="bb"
          onClick={() => setShowAdd((v) => !v)}
          style={{ fontSize: 13, padding: "6px 14px" }}
        >
          {showAdd ? "Cancel" : "+ Add"}
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="cd mb" style={{ borderLeft: "3px solid var(--color-primary)" }}>
          <h4 style={{ fontSize: 13, marginBottom: 8 }}>New Customer</h4>
          <div className="g2" style={{ marginBottom: 6 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name *" />
            <select value={type} onChange={(e) => setType(e.target.value as CustomerType)} style={{ fontSize: 13 }}>
              <option value="individual">Individual</option>
              <option value="business">Business</option>
              <option value="property_manager">Property Manager</option>
            </select>
          </div>
          {(type === "business" || type === "property_manager") && (
            <input
              value={primaryContact}
              onChange={(e) => setPrimaryContact(e.target.value)}
              placeholder={type === "property_manager" ? "Primary contact (e.g. Sarah at Key Renter)" : "Primary contact"}
              style={{ marginBottom: 6 }}
            />
          )}
          <div className="g2" style={{ marginBottom: 6 }}>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (gate codes, preferences, history...)"
            style={{ width: "100%", minHeight: 50, fontSize: 13, marginBottom: 8 }}
          />
          <button className="bb" onClick={addCustomer} style={{ width: "100%", padding: 10 }}>
            Save Customer
          </button>
        </div>
      )}

      {/* Search */}
      <div className="cd mb" style={{ padding: 8 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, contact, phone, email..."
          style={{ width: "100%", fontSize: 13 }}
        />
      </div>

      {/* Type filter chips */}
      <div style={{ display: "flex", gap: 4, marginBottom: 10, overflowX: "auto", paddingBottom: 2 }}>
        {TYPE_FILTERS.map((f) => {
          const count = f.id === "all"
            ? customers.length
            : customers.filter((c) => c.type === f.id).length;
          const active = typeFilter === f.id;
          const c = f.id === "all" ? "var(--color-primary)" : TYPE_COLOR[f.id as CustomerType];
          return (
            <button
              key={f.id}
              onClick={() => setTypeFilter(f.id)}
              style={{
                padding: "5px 10px", borderRadius: 14, fontSize: 11, whiteSpace: "nowrap",
                background: active ? c : "transparent",
                color: active ? "#fff" : c,
                border: `1px solid ${c}`,
                fontFamily: "Oswald", letterSpacing: ".04em", flexShrink: 0,
              }}
            >
              {f.label} · {count}
            </button>
          );
        })}
      </div>

      {/* Portfolio summary */}
      {total > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
          <div className="cd" style={{ textAlign: "center", padding: 10 }}>
            <div className="sl">Total</div>
            <div className="sv" style={{ color: "var(--color-primary)" }}>{total}</div>
          </div>
          <div className="cd" style={{ textAlign: "center", padding: 10 }}>
            <div className="sl">Active</div>
            <div className="sv" style={{ color: "var(--color-success)" }}>{active}</div>
          </div>
          <div className="cd" style={{ textAlign: "center", padding: 10 }}>
            <div className="sl">Revenue</div>
            <div className="sv" style={{ color: "var(--color-highlight)", fontSize: 18 }}>
              ${totalRevenue >= 1000 ? `${(totalRevenue / 1000).toFixed(1)}k` : totalRevenue.toFixed(0)}
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {filtered.length === 0 && (
        <div className="cd" style={{ textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>👥</div>
          <p className="dim" style={{ fontSize: 13 }}>
            {total === 0
              ? "No customers yet — tap + Add to create one."
              : "No matches — adjust the search or filter."}
          </p>
        </div>
      )}
      {filtered.map((c) => {
        const typeColor = TYPE_COLOR[c.type];
        return (
          <div
            key={c.id}
            onClick={() => onSelect?.(c.id)}
            className="cd mb"
            style={{
              cursor: "pointer",
              borderLeft: `3px solid ${typeColor}`,
              padding: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <b style={{ fontSize: 14 }}>{c.name}</b>
                <span style={{
                  fontSize: 10, fontFamily: "Oswald", letterSpacing: ".04em",
                  padding: "1px 6px", borderRadius: 8,
                  background: `${typeColor}22`, color: typeColor,
                }}>
                  {TYPE_LABEL[c.type]}
                </span>
                {c.isFuzzy && (
                  <span
                    title="Jobs matched by name only — confirm via the backfill tool"
                    style={{
                      fontSize: 10, fontFamily: "Oswald", letterSpacing: ".04em",
                      padding: "1px 6px", borderRadius: 8,
                      background: "var(--color-warning)22", color: "var(--color-warning)",
                    }}
                  >
                    UNLINKED
                  </span>
                )}
              </div>
              <span className="dim" style={{ fontSize: 11 }}>
                {c.lastService || "—"}
              </span>
            </div>
            {c.primary_contact && (
              <div className="dim" style={{ fontSize: 12, marginBottom: 2 }}>
                👤 {c.primary_contact}
              </div>
            )}
            <div className="dim" style={{ fontSize: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span>📍 {c.addrCount} address{c.addrCount === 1 ? "" : "es"}</span>
              <span>🧰 {c.jobCount} job{c.jobCount === 1 ? "" : "s"}</span>
              {c.revenue > 0 && (
                <span style={{ color: "var(--color-success)" }}>
                  ${c.revenue >= 1000 ? `${(c.revenue / 1000).toFixed(1)}k` : c.revenue.toFixed(0)}
                </span>
              )}
              {c.phone && <span>☎ {c.phone}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
