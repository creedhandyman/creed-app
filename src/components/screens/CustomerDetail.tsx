"use client";
/**
 * CustomerDetail — full edit + address management + related work.
 *
 * Sections:
 *  1. Header (back, name, type badge, delete).
 *  2. Customer info (inline edit toggle: name, type, primary_contact,
 *     phone, email, notes).
 *  3. Addresses (list with edit/delete + "+ Add" form). Property-manager
 *     customers get optional metadata fields (unit_count, owner,
 *     occupancy_status).
 *  4. Related work — jobs grouped by status, pulled by customer_id link
 *     OR by name match against legacy j.client for unlinked jobs.
 */
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Icon } from "../Icon";
import type { CustomerType, Address, Job } from "@/lib/types";

interface Props {
  customerId: string;
  onBack: () => void;
}

const TYPE_LABEL: Record<CustomerType, string> = {
  individual: "Individual",
  business: "Business",
  property_manager: "Property Manager",
};

const TYPE_COLOR: Record<CustomerType, string> = {
  individual: "var(--color-primary)",
  business: "var(--color-success)",
  property_manager: "var(--color-warning)",
};

const STATUS_COLOR: Record<string, string> = {
  quoted: "var(--color-accent-red)",
  accepted: "#ff8800",
  scheduled: "var(--color-highlight)",
  active: "var(--color-success)",
  complete: "var(--color-primary)",
  invoiced: "#5a5af0",
  paid: "#9b59b6",
  inspection: "#888",
};

const formatAddressLine = (a: Address) => {
  const line = [a.street, a.city, a.state, a.zip].filter(Boolean).join(", ");
  return line || "(no street info)";
};

const fmtDate = (s: string | undefined) => {
  if (!s) return "";
  const d = s.split("T")[0];
  return d || "";
};

export default function CustomerDetail({ customerId, onBack }: Props) {
  const customer = useStore((s) => s.customers.find((c) => c.id === customerId));
  const allAddresses = useStore((s) => s.addresses);
  const jobs = useStore((s) => s.jobs);
  const upsertCustomer = useStore((s) => s.upsertCustomer);
  const deleteCustomer = useStore((s) => s.deleteCustomer);
  const upsertAddress = useStore((s) => s.upsertAddress);
  const deleteAddress = useStore((s) => s.deleteAddress);
  const showConfirm = useStore((s) => s.showConfirm);
  const showToast = useStore((s) => s.showToast);
  const darkMode = useStore((s) => s.darkMode);

  const addresses = useMemo(
    () => allAddresses
      .filter((a) => a.customer_id === customerId)
      .sort((a, b) => Number(b.is_primary ?? false) - Number(a.is_primary ?? false)),
    [allAddresses, customerId],
  );

  // Customer edit state — pre-fill from current customer values.
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(customer?.name ?? "");
  const [editType, setEditType] = useState<CustomerType>(customer?.type ?? "individual");
  const [editPrimary, setEditPrimary] = useState(customer?.primary_contact ?? "");
  const [editPhone, setEditPhone] = useState(customer?.phone ?? "");
  const [editEmail, setEditEmail] = useState(customer?.email ?? "");
  const [editNotes, setEditNotes] = useState(customer?.notes ?? "");

  const startEdit = () => {
    if (!customer) return;
    setEditName(customer.name);
    setEditType(customer.type);
    setEditPrimary(customer.primary_contact ?? "");
    setEditPhone(customer.phone ?? "");
    setEditEmail(customer.email ?? "");
    setEditNotes(customer.notes ?? "");
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!customer) return;
    if (!editName.trim()) {
      showToast("Name is required", "warning");
      return;
    }
    await upsertCustomer({
      id: customer.id,
      name: editName.trim(),
      type: editType,
      primary_contact: editPrimary.trim() || undefined,
      phone: editPhone.trim() || undefined,
      email: editEmail.trim() || undefined,
      notes: editNotes.trim() || undefined,
    });
    setEditing(false);
    showToast("Customer updated", "success");
  };

  const removeCustomer = async () => {
    if (!customer) return;
    const confirmed = await showConfirm(
      "Delete Customer",
      `Delete "${customer.name}"? Their addresses will be removed too. Linked jobs are kept (FK is set to NULL on delete).`,
    );
    if (!confirmed) return;
    await deleteCustomer(customer.id);
    showToast(`Deleted ${customer.name}`, "success");
    onBack();
  };

  // Address add/edit state — single form, addressBeingEdited drives
  // whether it's an insert (null) or update (an address id).
  const [addrFormOpen, setAddrFormOpen] = useState(false);
  const [editingAddrId, setEditingAddrId] = useState<string | null>(null);
  const [aLabel, setALabel] = useState("");
  const [aStreet, setAStreet] = useState("");
  const [aCity, setACity] = useState("");
  const [aState, setAState] = useState("");
  const [aZip, setAZip] = useState("");
  const [aIsPrimary, setAIsPrimary] = useState(false);
  const [aUnitCount, setAUnitCount] = useState("");
  const [aOwner, setAOwner] = useState("");
  const [aOccupancy, setAOccupancy] = useState("");

  const resetAddrForm = () => {
    setALabel(""); setAStreet(""); setACity(""); setAState(""); setAZip("");
    setAIsPrimary(false);
    setAUnitCount(""); setAOwner(""); setAOccupancy("");
    setEditingAddrId(null);
  };

  const openAddrAdd = () => {
    resetAddrForm();
    // Default to primary if this would be the first address.
    if (addresses.length === 0) setAIsPrimary(true);
    setAddrFormOpen(true);
  };

  const openAddrEdit = (a: Address) => {
    setALabel(a.label ?? "");
    setAStreet(a.street ?? "");
    setACity(a.city ?? "");
    setAState(a.state ?? "");
    setAZip(a.zip ?? "");
    setAIsPrimary(!!a.is_primary);
    const meta = (a.metadata ?? {}) as Record<string, unknown>;
    setAUnitCount(meta.unit_count != null ? String(meta.unit_count) : "");
    setAOwner(typeof meta.owner === "string" ? meta.owner : "");
    setAOccupancy(typeof meta.occupancy_status === "string" ? meta.occupancy_status : "");
    setEditingAddrId(a.id);
    setAddrFormOpen(true);
  };

  const saveAddress = async () => {
    if (!customer) return;
    if (!aStreet.trim() && !aLabel.trim()) {
      showToast("Need at least a label or street", "warning");
      return;
    }
    const meta: Record<string, unknown> = {};
    if (customer.type === "property_manager") {
      if (aUnitCount.trim()) meta.unit_count = Number(aUnitCount) || aUnitCount.trim();
      if (aOwner.trim()) meta.owner = aOwner.trim();
      if (aOccupancy.trim()) meta.occupancy_status = aOccupancy.trim();
    }
    const payload: Partial<Address> & { customer_id: string } = {
      customer_id: customer.id,
      label: aLabel.trim() || undefined,
      street: aStreet.trim() || undefined,
      city: aCity.trim() || undefined,
      state: aState.trim() || undefined,
      zip: aZip.trim() || undefined,
      is_primary: aIsPrimary,
      metadata: Object.keys(meta).length ? meta : undefined,
    };
    if (editingAddrId) payload.id = editingAddrId;

    // Only one address per customer can be primary — clear the flag on
    // any other address before saving this one as primary.
    if (aIsPrimary) {
      const others = addresses.filter((x) => x.id !== editingAddrId && x.is_primary);
      for (const o of others) {
        await upsertAddress({ id: o.id, customer_id: customer.id, is_primary: false });
      }
    }

    await upsertAddress(payload);
    showToast(editingAddrId ? "Address updated" : "Address added", "success");
    resetAddrForm();
    setAddrFormOpen(false);
  };

  const removeAddress = async (a: Address) => {
    const confirmed = await showConfirm(
      "Delete Address",
      `Remove "${a.label || a.street || "this address"}"? Linked jobs are kept (FK is set to NULL on delete).`,
    );
    if (!confirmed) return;
    await deleteAddress(a.id);
    showToast("Address removed", "success");
  };

  // Related work — jobs linked by customer_id win; legacy name-matched
  // jobs come through too so the user can see history before backfill.
  const relatedJobs = useMemo(() => {
    if (!customer) return { linked: [] as Job[], fuzzy: [] as Job[] };
    const linked = jobs.filter((j) => j.customer_id === customer.id);
    const fuzzy = linked.length === 0
      ? jobs.filter((j) => j.client && j.client.toLowerCase() === customer.name.toLowerCase())
      : [];
    return { linked, fuzzy };
  }, [jobs, customer]);

  const allRelated = [...relatedJobs.linked, ...relatedJobs.fuzzy];
  const totalRevenue = allRelated.reduce((s, j) => s + (j.total || 0), 0);
  const paidRevenue = allRelated
    .filter((j) => j.status === "paid")
    .reduce((s, j) => s + (j.total || 0), 0);

  const groupedByStatus = useMemo(() => {
    const order = ["quoted", "accepted", "scheduled", "active", "complete", "invoiced", "paid", "inspection"];
    const buckets: Record<string, Job[]> = {};
    for (const j of allRelated) {
      const k = j.status || "other";
      if (!buckets[k]) buckets[k] = [];
      buckets[k].push(j);
    }
    return order
      .filter((s) => buckets[s])
      .map((s) => ({ status: s, jobs: buckets[s] }));
  }, [allRelated]);

  if (!customer) {
    return (
      <div className="fi">
        <div className="row mb">
          <button className="bo" onClick={onBack} style={{ fontSize: 12, padding: "4px 8px" }}>← Back</button>
          <h2 style={{ fontSize: 18, color: "var(--color-warning)" }}>Customer not found</h2>
        </div>
        <p className="dim" style={{ fontSize: 13 }}>
          The customer record may have been deleted.
        </p>
      </div>
    );
  }

  const typeColor = TYPE_COLOR[customer.type];
  const border = darkMode ? "#1e1e2e" : "#eee";

  return (
    <div className="fi">
      {/* Header */}
      <div className="row mb" style={{ justifyContent: "space-between" }}>
        <div className="row" style={{ minWidth: 0 }}>
          <button className="bo" onClick={onBack} style={{ fontSize: 12, padding: "4px 8px" }}>←</button>
          <h2 style={{
            fontSize: 18, color: typeColor,
            display: "inline-flex", alignItems: "center", gap: 6,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            <Icon name="clients" size={18} color={typeColor} />
            {customer.name}
          </h2>
        </div>
        <span style={{
          fontSize: 11, fontFamily: "Oswald", letterSpacing: ".04em",
          padding: "3px 8px", borderRadius: 10, flexShrink: 0,
          background: `${typeColor}22`, color: typeColor,
        }}>
          {TYPE_LABEL[customer.type]}
        </span>
      </div>

      {/* Customer info card — view or edit */}
      <div className="cd mb">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h4 style={{ fontSize: 13, margin: 0 }}>Info</h4>
          {!editing ? (
            <button className="bo" onClick={startEdit} style={{ fontSize: 11, padding: "3px 10px" }}>
              <Icon name="edit" size={12} /> Edit
            </button>
          ) : (
            <div style={{ display: "flex", gap: 4 }}>
              <button className="bo" onClick={() => setEditing(false)} style={{ fontSize: 11, padding: "3px 10px" }}>
                Cancel
              </button>
              <button className="bb" onClick={saveEdit} style={{ fontSize: 11, padding: "3px 10px" }}>
                Save
              </button>
            </div>
          )}
        </div>

        {!editing ? (
          <>
            {customer.primary_contact && (
              <div style={{ fontSize: 13, marginBottom: 4 }}>
                <span className="dim" style={{ fontSize: 11 }}>Primary contact</span>
                <div>👤 {customer.primary_contact}</div>
              </div>
            )}
            {customer.phone && (
              <div style={{ fontSize: 13, marginBottom: 4 }}>
                ☎ {customer.phone}
              </div>
            )}
            {customer.email && (
              <div style={{ fontSize: 13, marginBottom: 4 }}>
                ✉ {customer.email}
              </div>
            )}
            {customer.notes && (
              <div style={{ fontSize: 13, marginTop: 6, padding: 8, background: darkMode ? "#0f0f18" : "#f7f7fa", borderRadius: 6, whiteSpace: "pre-wrap" }}>
                {customer.notes}
              </div>
            )}
            {!customer.primary_contact && !customer.phone && !customer.email && !customer.notes && (
              <p className="dim" style={{ fontSize: 12, fontStyle: "italic" }}>No contact info on file.</p>
            )}
          </>
        ) : (
          <>
            <div className="g2" style={{ marginBottom: 6 }}>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name *" />
              <select value={editType} onChange={(e) => setEditType(e.target.value as CustomerType)} style={{ fontSize: 13 }}>
                <option value="individual">Individual</option>
                <option value="business">Business</option>
                <option value="property_manager">Property Manager</option>
              </select>
            </div>
            {(editType === "business" || editType === "property_manager") && (
              <input
                value={editPrimary}
                onChange={(e) => setEditPrimary(e.target.value)}
                placeholder="Primary contact"
                style={{ marginBottom: 6 }}
              />
            )}
            <div className="g2" style={{ marginBottom: 6 }}>
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="Phone" />
              <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Email" />
            </div>
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Notes (gate codes, preferences, history...)"
              style={{ width: "100%", minHeight: 60, fontSize: 13 }}
            />
          </>
        )}
      </div>

      {/* Addresses */}
      <div className="cd mb">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h4 style={{ fontSize: 13, margin: 0 }}>📍 Addresses ({addresses.length})</h4>
          {!addrFormOpen && (
            <button className="bo" onClick={openAddrAdd} style={{ fontSize: 11, padding: "3px 10px" }}>
              + Add
            </button>
          )}
        </div>

        {addresses.length === 0 && !addrFormOpen && (
          <p className="dim" style={{ fontSize: 12, fontStyle: "italic" }}>
            No addresses yet — tap + Add.
          </p>
        )}

        {addresses.map((a) => (
          <div
            key={a.id}
            style={{
              padding: 10, borderRadius: 6,
              border: `1px solid ${a.is_primary ? "var(--color-primary)" : border}`,
              background: a.is_primary ? "var(--color-primary)11" : undefined,
              marginBottom: 6,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <b style={{ fontSize: 13 }}>{a.label || a.street || "(unlabeled)"}</b>
                  {a.is_primary && (
                    <span style={{ fontSize: 9, color: "var(--color-primary)", fontFamily: "Oswald", letterSpacing: ".04em" }}>PRIMARY</span>
                  )}
                </div>
                <div className="dim" style={{ fontSize: 12 }}>{formatAddressLine(a)}</div>
                {a.metadata && Object.keys(a.metadata).length > 0 && (
                  <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                    {Object.entries(a.metadata).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                <button className="bo" onClick={() => openAddrEdit(a)} style={{ fontSize: 11, padding: "3px 8px" }}>
                  Edit
                </button>
                <button onClick={() => removeAddress(a)} style={{ fontSize: 11, padding: "3px 8px", color: "var(--color-accent-red)", background: "transparent", border: `1px solid ${border}`, borderRadius: 6 }}>
                  ×
                </button>
              </div>
            </div>
          </div>
        ))}

        {addrFormOpen && (
          <div style={{ marginTop: 6, padding: 10, borderRadius: 6, border: "1px dashed var(--color-primary)" }}>
            <div className="g2" style={{ marginBottom: 6 }}>
              <input value={aLabel} onChange={(e) => setALabel(e.target.value)} placeholder='Label (e.g. "Main")' />
              <input value={aStreet} onChange={(e) => setAStreet(e.target.value)} placeholder="Street" />
            </div>
            <div className="g2" style={{ marginBottom: 6 }}>
              <input value={aCity} onChange={(e) => setACity(e.target.value)} placeholder="City" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 4 }}>
                <input value={aState} onChange={(e) => setAState(e.target.value)} placeholder="ST" maxLength={2} />
                <input value={aZip} onChange={(e) => setAZip(e.target.value)} placeholder="ZIP" />
              </div>
            </div>

            {customer.type === "property_manager" && (
              <div style={{ marginBottom: 6 }}>
                <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>Property-manager metadata (optional)</div>
                <div className="g2" style={{ marginBottom: 4 }}>
                  <input value={aUnitCount} onChange={(e) => setAUnitCount(e.target.value)} placeholder="Unit count" />
                  <input value={aOwner} onChange={(e) => setAOwner(e.target.value)} placeholder="Owner" />
                </div>
                <input
                  value={aOccupancy}
                  onChange={(e) => setAOccupancy(e.target.value)}
                  placeholder='Occupancy status (e.g. "vacant", "tenant move-out")'
                />
              </div>
            )}

            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={aIsPrimary}
                onChange={(e) => setAIsPrimary(e.target.checked)}
              />
              Primary address (only one per customer)
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="bo"
                onClick={() => { resetAddrForm(); setAddrFormOpen(false); }}
                style={{ flex: 1, fontSize: 12, padding: 6 }}
              >
                Cancel
              </button>
              <button
                className="bb"
                onClick={saveAddress}
                style={{ flex: 1, fontSize: 12, padding: 6 }}
              >
                {editingAddrId ? "Update" : "Add"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Related work */}
      <div className="cd mb">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h4 style={{ fontSize: 13, margin: 0 }}>
            🧰 Related Work ({allRelated.length})
          </h4>
          {totalRevenue > 0 && (
            <span className="dim" style={{ fontSize: 11 }}>
              ${paidRevenue.toFixed(0)} paid · ${totalRevenue.toFixed(0)} total
            </span>
          )}
        </div>

        {relatedJobs.fuzzy.length > 0 && (
          <div style={{
            fontSize: 11, padding: "6px 10px",
            borderLeft: "3px solid var(--color-warning)",
            background: "var(--color-warning)11",
            borderRadius: 4, marginBottom: 8,
          }}>
            <b>{relatedJobs.fuzzy.length}</b> job(s) matched by name only — they pre-date the customer link. Use the backfill tool (Step 1.5) to attach them to this customer.
          </div>
        )}

        {allRelated.length === 0 ? (
          <p className="dim" style={{ fontSize: 12, fontStyle: "italic" }}>
            No jobs yet for this customer.
          </p>
        ) : (
          groupedByStatus.map(({ status, jobs: statusJobs }) => (
            <div key={status} style={{ marginBottom: 8 }}>
              <div className="dim" style={{
                fontSize: 10, fontFamily: "Oswald", letterSpacing: ".06em",
                textTransform: "uppercase", marginBottom: 4,
                color: STATUS_COLOR[status] || "#888",
              }}>
                {status} ({statusJobs.length})
              </div>
              {statusJobs.map((j) => (
                <div
                  key={j.id}
                  style={{
                    display: "flex", justifyContent: "space-between",
                    fontSize: 12, padding: "4px 0",
                    borderBottom: `1px solid ${border}`,
                  }}
                >
                  <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {j.property || "(no address)"}
                  </span>
                  <span className="dim" style={{ marginLeft: 8 }}>{fmtDate(j.job_date) || fmtDate(j.created_at)}</span>
                  {j.total > 0 && (
                    <span style={{ marginLeft: 8, color: "var(--color-success)", fontFamily: "Oswald" }}>
                      ${j.total.toFixed(0)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Danger zone */}
      <button
        onClick={removeCustomer}
        style={{
          width: "100%", padding: 10, fontSize: 12,
          background: "transparent",
          border: `1px solid var(--color-accent-red)`,
          color: "var(--color-accent-red)",
          borderRadius: 6, fontFamily: "Oswald", letterSpacing: ".04em",
        }}
      >
        Delete Customer
      </button>
    </div>
  );
}
