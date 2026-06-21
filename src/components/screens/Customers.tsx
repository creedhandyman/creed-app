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
import { Icon, type IconName } from "../Icon";
import PropertySearch from "../PropertySearch";
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

const TYPE_ICON: Record<CustomerType, IconName> = {
  individual: "card",
  business: "briefcase",
  property_manager: "ops",
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
      // db.post (or the upsertCustomer fallback) has already toasted the
      // underlying Supabase error. Don't fire a second generic toast — it
      // overwrites the diagnostic message before the user can read it.
      // Leave the form filled so they can retry.
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
    const openCount = allJobs.filter((j) => !["complete", "invoiced", "paid"].includes(j.status)).length;
    const hasOpen = openCount > 0;
    return {
      ...c,
      addrCount: addrs.length,
      jobCount: allJobs.length,
      openCount,
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

  return (
    <div className="fi">
      {/* Add button (the Ops back-header already shows CUSTOMERS) */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button
          onClick={() => setShowAdd((v) => !v)}
          aria-label={showAdd ? "Cancel" : "Add customer"}
          style={{ width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: showAdd ? "var(--color-card-dark-3)" : "var(--color-primary)", border: showAdd ? "1px solid var(--color-border-dark-2)" : "none", color: showAdd ? "var(--color-dim)" : "#fff" }}
        >
          <Icon name={showAdd ? "close" : "add"} size={16} color={showAdd ? "var(--color-dim)" : "#fff"} />
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="cd mb" style={{ borderLeft: "3px solid var(--color-primary)" }}>
          <h4 style={{ fontSize: 15, marginBottom: 8 }}>New Customer</h4>
          <div className="g2" style={{ marginBottom: 6 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name *" />
            <select value={type} onChange={(e) => setType(e.target.value as CustomerType)} style={{ fontSize: 15 }}>
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
            style={{ width: "100%", minHeight: 50, fontSize: 15, marginBottom: 8 }}
          />
          <button className="bb" onClick={addCustomer} style={{ width: "100%", padding: 10 }}>
            Save Customer
          </button>
        </div>
      )}

      {/* Search — typeahead with live suggestions. Selecting a result
          opens that customer's detail directly. The input also drives
          the inline list filter so the row count narrows as you type. */}
      <div className="cd mb" style={{ padding: 8 }}>
        <PropertySearch<typeof customers[number]>
          items={customers}
          getKey={(c) => c.id}
          match={(c) => {
            const addrs = addresses
              .filter((a) => a.customer_id === c.id)
              .map((a) => [a.label, a.street, a.city, a.state, a.zip].filter(Boolean).join(" "))
              .join(" ");
            return [c.name, c.primary_contact, c.phone, c.email, addrs].filter(Boolean).join(" ");
          }}
          render={(c) => (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <b>{c.name}</b>
                {c.primary_contact && <span className="dim"> · {c.primary_contact}</span>}
                {c.phone && <span className="dim"> · {c.phone}</span>}
              </span>
              <span style={{ fontFamily: "Oswald", color: "var(--color-primary)", fontSize: 13, flexShrink: 0 }}>
                {c.type}
              </span>
            </div>
          )}
          onSelect={(c) => onSelect?.(c.id)}
          onQueryChange={setSearch}
          placeholder="Search by name, contact, phone, email…"
        />
      </div>

      {/* Type filter chips — mock pills */}
      <div style={{ display: "flex", gap: 6, marginBottom: 11 }}>
        {TYPE_FILTERS.map((f) => {
          const active = typeFilter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setTypeFilter(f.id)}
              style={{
                flex: 1, textAlign: "center", padding: "7px 4px", borderRadius: 99, fontSize: 10.5, fontWeight: 500, whiteSpace: "nowrap",
                background: active ? "var(--color-primary)" : "var(--color-card-dark-3)",
                border: `1px solid ${active ? "var(--color-primary)" : "var(--color-border-dark-2)"}`,
                color: active ? "#fff" : "var(--color-dim)",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* List — mock CRM rows */}
      {filtered.length === 0 && (
        <div className="cd" style={{ textAlign: "center", padding: 24 }}>
          <Icon name="clients" size={30} color="var(--color-dim)" />
          <p className="dim" style={{ fontSize: 14, marginTop: 8 }}>
            {total === 0
              ? "No customers yet — tap + to create one."
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
            style={{ display: "flex", alignItems: "center", gap: 11, background: "var(--color-card-dark-3)", border: "1px solid var(--color-border-dark-2)", borderRadius: 13, padding: "11px 12px", marginBottom: 8, cursor: "pointer" }}
          >
            <div style={{ width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", background: `${typeColor}22` }}>
              <Icon name={TYPE_ICON[c.type]} size={18} color={typeColor} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 13.5, letterSpacing: ".3px", display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{c.name}</span>
                <span style={{ fontSize: 8.5, fontWeight: 600, padding: "1px 7px", borderRadius: 99, flex: "none", background: `${typeColor}22`, color: typeColor }}>{TYPE_LABEL[c.type]}</span>
                {c.isFuzzy && (
                  <span title="Jobs matched by name only — confirm via the backfill tool" style={{ fontSize: 8.5, fontWeight: 600, padding: "1px 7px", borderRadius: 99, flex: "none", background: "var(--color-warning)22", color: "var(--color-warning)" }}>UNLINKED</span>
                )}
              </div>
              <div style={{ fontSize: 10, color: "var(--color-dim)", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                {c.openCount > 0 && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#3ee08f", boxShadow: "0 0 7px #3ee08f", flex: "none" }} />}
                {c.jobCount} job{c.jobCount === 1 ? "" : "s"}{c.openCount > 0 ? ` · ${c.openCount} open` : ""}
              </div>
            </div>
            {c.revenue > 0 && (
              <div style={{ textAlign: "right", flex: "none" }}>
                <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 13, color: "var(--color-money)" }}>
                  ${c.revenue >= 1000 ? `${(c.revenue / 1000).toFixed(1)}k` : c.revenue.toFixed(0)}
                </div>
                <div style={{ fontSize: 8, color: "var(--color-dim)" }}>lifetime</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
