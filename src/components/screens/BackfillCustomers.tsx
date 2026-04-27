"use client";
/**
 * BackfillCustomers — admin-only one-time tool that walks every job
 * with no customer_id, groups by unique `property` string, and lets
 * the user link those properties to a Customer + Address. Designed for
 * Bernard's main case where most legacy jobs belong to a single PM
 * client (Key Renter), so the bulk-assign-many-to-one flow is the
 * primary path. Per-row picking is supported for one-offs.
 *
 * Lives as a tab in Operations so it's automatically gated to
 * admin/owner roles. Once everything is linked, the tab is still
 * useful — it'll just show "All jobs are linked" and a checkmark.
 *
 * Confirmatory: nothing is patched until the user clicks Apply on a
 * row or Bulk-Apply on a selection. Both actions go through
 * showConfirm first.
 */
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import type { Address, CustomerType } from "@/lib/types";
import { Icon } from "../Icon";

interface PropertyGroup {
  key: string;          // canonical lowercased property string
  property: string;     // display string (first-seen casing)
  client: string;       // most-common legacy client name across the group
  jobCount: number;
  revenue: number;
  lastDate: string;
  jobIds: string[];
}

const formatAddressLine = (a: Address): string => {
  const line = [a.street, a.city, a.state, a.zip].filter(Boolean).join(", ");
  return line || a.label || "(no address details)";
};

export default function BackfillCustomers() {
  const jobs = useStore((s) => s.jobs);
  const customers = useStore((s) => s.customers);
  const addresses = useStore((s) => s.addresses);
  const upsertCustomer = useStore((s) => s.upsertCustomer);
  const upsertAddress = useStore((s) => s.upsertAddress);
  const loadAll = useStore((s) => s.loadAll);
  const showToast = useStore((s) => s.showToast);
  const showConfirm = useStore((s) => s.showConfirm);
  const darkMode = useStore((s) => s.darkMode);

  const [search, setSearch] = useState("");
  // Per-row picked customer (key → customer_id)
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCustomerId, setBulkCustomerId] = useState<string>("");
  const [applying, setApplying] = useState(false);

  // New-customer inline form
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerType, setNewCustomerType] = useState<CustomerType>("property_manager");
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  /* ── Compute unique property groups from unlinked jobs ── */
  const groups = useMemo<PropertyGroup[]>(() => {
    const map = new Map<string, {
      property: string;
      clients: Map<string, number>;
      jobIds: string[];
      revenue: number;
      lastDate: string;
    }>();
    for (const j of jobs) {
      if (j.customer_id) continue;
      const propRaw = (j.property || "").trim();
      if (!propRaw) continue;
      const key = propRaw.toLowerCase();
      let g = map.get(key);
      if (!g) {
        g = { property: propRaw, clients: new Map(), jobIds: [], revenue: 0, lastDate: "" };
        map.set(key, g);
      }
      g.jobIds.push(j.id);
      g.revenue += j.total || 0;
      if (j.client) g.clients.set(j.client, (g.clients.get(j.client) || 0) + 1);
      const d = j.job_date || j.created_at?.split("T")[0] || "";
      if (d > g.lastDate) g.lastDate = d;
    }
    return Array.from(map.entries()).map(([key, g]) => {
      let topClient = "";
      let topCount = 0;
      g.clients.forEach((count, name) => {
        if (count > topCount) { topClient = name; topCount = count; }
      });
      return {
        key,
        property: g.property,
        client: topClient,
        jobCount: g.jobIds.length,
        revenue: g.revenue,
        lastDate: g.lastDate,
        jobIds: g.jobIds,
      };
    });
  }, [jobs]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return groups
      .filter((g) => !s || (g.property + " " + g.client).toLowerCase().includes(s))
      // Highest job-count first — concentrates the user on the rows that
      // matter most (e.g. all the Key Renter properties bubble up).
      .sort((a, b) => b.jobCount - a.jobCount || b.revenue - a.revenue);
  }, [groups, search]);

  const totalUnlinkedJobs = groups.reduce((s, g) => s + g.jobCount, 0);
  const totalLinkedJobs = jobs.filter((j) => j.customer_id).length;

  /* ── Actions ── */
  const toggleSelected = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((g) => g.key)));
  };

  /** Find or create the address + patch every job in the group. */
  const linkGroup = async (group: PropertyGroup, customerId: string) => {
    const existing = addresses.find(
      (a) => a.customer_id === customerId
        && (a.street || "").trim().toLowerCase() === group.property.toLowerCase()
    );
    let addressId = existing?.id;
    if (!addressId) {
      const created = await upsertAddress({
        customer_id: customerId,
        street: group.property,
        is_primary: addresses.filter((a) => a.customer_id === customerId).length === 0,
      });
      if (!created) return false;
      addressId = created.id;
    }
    for (const jobId of group.jobIds) {
      await db.patch("jobs", jobId, {
        customer_id: customerId,
        address_id: addressId,
      });
    }
    return true;
  };

  const applyRow = async (group: PropertyGroup) => {
    const customerId = picks[group.key];
    if (!customerId) {
      showToast("Pick a customer first", "warning");
      return;
    }
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) return;
    const ok = await showConfirm(
      "Link Property",
      `Link "${group.property}" (${group.jobCount} ${group.jobCount === 1 ? "job" : "jobs"}) to ${customer.name}?`
    );
    if (!ok) return;
    setApplying(true);
    const success = await linkGroup(group, customerId);
    if (success) {
      setPicks((prev) => {
        const next = { ...prev };
        delete next[group.key];
        return next;
      });
      await loadAll();
      showToast(`Linked to ${customer.name}`, "success");
    }
    setApplying(false);
  };

  const applyBulk = async () => {
    if (!bulkCustomerId) {
      showToast("Pick a customer for bulk assignment", "warning");
      return;
    }
    const sel = filtered.filter((g) => selected.has(g.key));
    if (sel.length === 0) {
      showToast("Select at least one property", "warning");
      return;
    }
    const customer = customers.find((c) => c.id === bulkCustomerId);
    if (!customer) return;
    const totalJobs = sel.reduce((s, g) => s + g.jobCount, 0);
    const ok = await showConfirm(
      "Bulk Backfill",
      `Link ${sel.length} ${sel.length === 1 ? "property" : "properties"} (${totalJobs} ${totalJobs === 1 ? "job" : "jobs"} total) to ${customer.name}? Each property string becomes an address under that customer.`
    );
    if (!ok) return;
    setApplying(true);
    let succeeded = 0;
    for (const g of sel) {
      const ok2 = await linkGroup(g, bulkCustomerId);
      if (ok2) succeeded++;
    }
    await loadAll();
    setSelected(new Set());
    setApplying(false);
    showToast(
      `Linked ${succeeded} ${succeeded === 1 ? "property" : "properties"} to ${customer.name}`,
      succeeded === sel.length ? "success" : "warning"
    );
  };

  const createCustomer = async () => {
    if (!newCustomerName.trim()) {
      showToast("Enter customer name", "warning");
      return;
    }
    setCreatingCustomer(true);
    const created = await upsertCustomer({
      name: newCustomerName.trim(),
      type: newCustomerType,
    });
    setCreatingCustomer(false);
    if (!created) return;
    setBulkCustomerId(created.id);
    setShowNewCustomer(false);
    setNewCustomerName("");
    setNewCustomerType("property_manager");
    showToast(`Created ${created.name}`, "success");
  };

  const border = darkMode ? "#1e1e2e" : "#eee";

  /* ── Empty state ── */
  if (groups.length === 0) {
    return (
      <div className="cd" style={{ textAlign: "center", padding: 32 }}>
        <div style={{ fontSize: 32, marginBottom: 8, color: "var(--color-success)" }}>
          <Icon name="checkCircle" size={42} color="var(--color-success)" />
        </div>
        <h3 style={{ fontSize: 16, marginBottom: 4 }}>All jobs are linked</h3>
        <div className="dim" style={{ fontSize: 12 }}>
          {totalLinkedJobs > 0
            ? `${totalLinkedJobs} ${totalLinkedJobs === 1 ? "job is" : "jobs are"} already linked to a customer.`
            : "There are no jobs with property addresses yet."}
        </div>
      </div>
    );
  }

  /* ── Main ── */
  return (
    <div>
      {/* Header / stats */}
      <div className="cd mb">
        <h3 style={{ fontSize: 15, marginBottom: 4, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="link" size={16} color="var(--color-primary)" />
          Backfill customers
        </h3>
        <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>
          {totalUnlinkedJobs} {totalUnlinkedJobs === 1 ? "job" : "jobs"} across{" "}
          {groups.length} unique {groups.length === 1 ? "property" : "properties"} have no customer link yet.
          {totalLinkedJobs > 0 && (
            <span> {totalLinkedJobs} already linked.</span>
          )}
        </div>

        {/* Bulk action */}
        <div
          style={{
            padding: 8,
            borderRadius: 6,
            background: darkMode ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
            border: `1px dashed ${border}`,
          }}
        >
          <div className="sl" style={{ marginBottom: 4 }}>
            Bulk: link selected properties to one customer
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            <select
              value={bulkCustomerId}
              onChange={(e) => {
                if (e.target.value === "__NEW__") setShowNewCustomer(true);
                else setBulkCustomerId(e.target.value);
              }}
              style={{ flex: "1 1 160px", fontSize: 13 }}
            >
              <option value="">Pick customer...</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              <option value="__NEW__">+ New customer...</option>
            </select>
            <button
              className="bb"
              disabled={!bulkCustomerId || selected.size === 0 || applying}
              onClick={applyBulk}
              style={{ fontSize: 13, padding: "5px 12px" }}
            >
              Link {selected.size || 0} selected
            </button>
          </div>

          {showNewCustomer && (
            <div
              style={{
                marginTop: 8,
                padding: 8,
                borderRadius: 6,
                border: "1px solid var(--color-primary)",
                background: darkMode ? "#12121a" : "#fff",
              }}
            >
              <div className="g2 mb">
                <input
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  placeholder="Customer name *"
                  style={{ fontSize: 12 }}
                  autoFocus
                />
                <select
                  value={newCustomerType}
                  onChange={(e) => setNewCustomerType(e.target.value as CustomerType)}
                  style={{ fontSize: 12 }}
                >
                  <option value="individual">Individual</option>
                  <option value="business">Business</option>
                  <option value="property_manager">Property Manager</option>
                </select>
              </div>
              <div className="row">
                <button
                  className="bg"
                  disabled={creatingCustomer}
                  onClick={createCustomer}
                  style={{ fontSize: 12, padding: "4px 10px" }}
                >
                  {creatingCustomer ? "..." : "Create"}
                </button>
                <button
                  className="bo"
                  onClick={() => {
                    setShowNewCustomer(false);
                    setNewCustomerName("");
                    setNewCustomerType("property_manager");
                  }}
                  style={{ fontSize: 12, padding: "4px 10px" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Search + select-all */}
      <div className="cd mb">
        <div className="row" style={{ gap: 6 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search property or client..."
            style={{ flex: 1, fontSize: 13 }}
          />
          <button
            className="bo"
            onClick={toggleAll}
            style={{ fontSize: 12, padding: "5px 10px", whiteSpace: "nowrap" }}
          >
            {selected.size === filtered.length && filtered.length > 0 ? "Clear all" : "Select all"}
          </button>
        </div>
      </div>

      {/* Group rows */}
      {filtered.length === 0 ? (
        <div className="dim" style={{ fontSize: 13, textAlign: "center", padding: 16 }}>
          No properties match this search.
        </div>
      ) : (
        filtered.map((g) => {
          const checked = selected.has(g.key);
          const pickedId = picks[g.key];
          const pickedCustomer = pickedId ? customers.find((c) => c.id === pickedId) : undefined;
          const pickedAddresses = pickedId
            ? addresses.filter((a) => a.customer_id === pickedId)
            : [];
          const matchingAddress = pickedId
            ? pickedAddresses.find(
                (a) => (a.street || "").trim().toLowerCase() === g.property.toLowerCase()
              )
            : undefined;

          return (
            <div
              key={g.key}
              className="cd mb"
              style={{
                borderLeft: checked
                  ? "3px solid var(--color-primary)"
                  : `3px solid transparent`,
              }}
            >
              <div className="row" style={{ alignItems: "flex-start", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSelected(g.key)}
                  style={{ marginTop: 4 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, wordBreak: "break-word" }}>
                    {g.property}
                  </div>
                  <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                    {g.client && <>Client: <b>{g.client}</b> · </>}
                    {g.jobCount} {g.jobCount === 1 ? "job" : "jobs"}
                    {g.revenue > 0 && <> · ${g.revenue.toFixed(0)}</>}
                    {g.lastDate && <> · last {g.lastDate}</>}
                  </div>
                </div>
              </div>

              <div className="row mt" style={{ flexWrap: "wrap", gap: 6 }}>
                <select
                  value={pickedId || ""}
                  onChange={(e) =>
                    setPicks((prev) => {
                      const next = { ...prev };
                      if (e.target.value) next[g.key] = e.target.value;
                      else delete next[g.key];
                      return next;
                    })
                  }
                  style={{ flex: "1 1 160px", fontSize: 12 }}
                >
                  <option value="">Pick customer...</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button
                  className="bg"
                  disabled={!pickedId || applying}
                  onClick={() => applyRow(g)}
                  style={{ fontSize: 12, padding: "5px 10px" }}
                >
                  Apply
                </button>
              </div>

              {pickedCustomer && (
                <div
                  className="dim"
                  style={{
                    fontSize: 11,
                    marginTop: 6,
                    padding: 6,
                    borderRadius: 4,
                    background: darkMode ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
                  }}
                >
                  →{" "}
                  {matchingAddress
                    ? <>Will link to existing address <b>{formatAddressLine(matchingAddress)}</b></>
                    : <>Will create new address <b>{g.property}</b> under {pickedCustomer.name}</>
                  }
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
