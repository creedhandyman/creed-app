"use client";
/**
 * CustomerPicker — combo picker for the Property + Client pair on
 * QuoteForge and Inspector. When a customer + address are selected,
 * customer_id/address_id FKs get populated AND the legacy `property`
 * and `client` strings stay in sync (so back-compat Job queries
 * keep working until the legacy columns are retired). Falls back to
 * free-text inputs when no customer is chosen, preserving the old
 * flow exactly. Inline "+ New customer" / "+ New address" forms let
 * the user create entities without leaving the screen.
 *
 * The native <select> pickers were replaced with searchable inline
 * panels so the user can type to filter instead of scrolling a long
 * list, and create-flows now dedupe by name (customer) or street
 * (address) so re-entering an existing address never adds a duplicate
 * row.
 */
import { useState, useMemo } from "react";
import { useStore } from "@/lib/store";
import type { Address, CustomerType } from "@/lib/types";

interface Props {
  prop: string;
  setProp: (v: string) => void;
  client: string;
  setClient: (v: string) => void;
  customerId?: string;
  setCustomerId: (v: string | undefined) => void;
  addressId?: string;
  setAddressId: (v: string | undefined) => void;
  /** Tighter font sizing for cramped layouts (e.g. EDIT-mode header). */
  compact?: boolean;
}

const formatAddressLine = (a: Address): string => {
  const line = [a.street, a.city, a.state, a.zip].filter(Boolean).join(", ");
  return line || a.label || "(no address details)";
};

const addressOptionLabel = (a: Address): string => {
  if (a.label && a.street) return `${a.label} — ${a.street}`;
  return a.label || formatAddressLine(a);
};

/** Loose string match — strips punctuation and whitespace so
 *  "123 Main St." matches "123 main st" matches "123, MAIN ST". */
const norm = (s: string | undefined | null): string =>
  (s || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

export default function CustomerPicker({
  prop,
  setProp,
  client,
  setClient,
  customerId,
  setCustomerId,
  addressId,
  setAddressId,
  compact,
}: Props) {
  const customers = useStore((s) => s.customers);
  const addresses = useStore((s) => s.addresses);
  const upsertCustomer = useStore((s) => s.upsertCustomer);
  const upsertAddress = useStore((s) => s.upsertAddress);
  const showToast = useStore((s) => s.showToast);

  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerType, setNewCustomerType] = useState<CustomerType>("individual");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  const [showNewAddress, setShowNewAddress] = useState(false);
  const [newAddrStreet, setNewAddrStreet] = useState("");
  const [newAddrLabel, setNewAddrLabel] = useState("");
  const [creatingAddress, setCreatingAddress] = useState(false);

  // Search-panel state. `customerSearchOpen`/`addressSearchOpen` toggle the
  // inline picker panel; the matching `…Q` (query) string filters the list.
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [customerQ, setCustomerQ] = useState("");
  const [addressSearchOpen, setAddressSearchOpen] = useState(false);
  const [addressQ, setAddressQ] = useState("");

  // If customerId points at a customer that no longer exists (deleted in
  // another tab), gracefully fall back to free text rather than render a
  // dead state.
  const linkedCustomer = customerId
    ? customers.find((c) => c.id === customerId)
    : undefined;
  const isLinked = !!linkedCustomer;

  const customerAddresses = isLinked
    ? addresses.filter((a) => a.customer_id === customerId)
    : [];

  // Filtered lists driven by the search query. Match on customer name +
  // phone for customers; on label + street for addresses.
  const filteredCustomers = useMemo(() => {
    const q = norm(customerQ);
    if (!q) return customers;
    return customers.filter((c) =>
      norm(c.name).includes(q) ||
      norm(c.phone).includes(q) ||
      norm(c.email).includes(q),
    );
  }, [customers, customerQ]);

  const filteredAddresses = useMemo(() => {
    const q = norm(addressQ);
    if (!q) return customerAddresses;
    return customerAddresses.filter((a) =>
      norm(a.street).includes(q) ||
      norm(a.label).includes(q) ||
      norm(a.city).includes(q) ||
      norm(a.zip).includes(q),
    );
  }, [customerAddresses, addressQ]);

  const pickCustomerById = (id: string) => {
    if (!id) {
      setCustomerId(undefined);
      setAddressId(undefined);
      return;
    }
    const c = customers.find((x) => x.id === id);
    if (!c) return;
    setCustomerId(c.id);
    setClient(c.name);
    // Auto-pick the primary (or first) address so the user doesn't have
    // to do two taps for the common single-address case.
    const custAddrs = addresses.filter((a) => a.customer_id === c.id);
    const pick = custAddrs.find((a) => a.is_primary) || custAddrs[0];
    if (pick) {
      setAddressId(pick.id);
      setProp(formatAddressLine(pick));
    } else {
      setAddressId(undefined);
    }
    setCustomerSearchOpen(false);
    setCustomerQ("");
  };

  const pickAddressById = (id: string) => {
    if (!id) {
      setAddressId(undefined);
      return;
    }
    const a = addresses.find((x) => x.id === id);
    if (!a) return;
    setAddressId(a.id);
    setProp(formatAddressLine(a));
    setAddressSearchOpen(false);
    setAddressQ("");
  };

  const createCustomer = async () => {
    const name = newCustomerName.trim();
    if (!name) {
      showToast("Enter customer name", "warning");
      return;
    }
    // Dedup — if a customer with the same normalized name already
    // exists, link to that one instead of inserting a duplicate row.
    // Phone match wins outright (most reliable identifier).
    const phoneNorm = norm(newCustomerPhone);
    const existingByPhone = phoneNorm
      ? customers.find((c) => norm(c.phone) === phoneNorm)
      : undefined;
    const existing =
      existingByPhone ||
      customers.find((c) => norm(c.name) === norm(name));
    if (existing) {
      pickCustomerById(existing.id);
      setShowNewCustomer(false);
      setNewCustomerName("");
      setNewCustomerPhone("");
      setNewCustomerType("individual");
      showToast(`Linked to existing customer "${existing.name}"`, "info");
      return;
    }
    setCreatingCustomer(true);
    const created = await upsertCustomer({
      name,
      type: newCustomerType,
      phone: newCustomerPhone.trim() || undefined,
    });
    setCreatingCustomer(false);
    if (!created) return;
    setCustomerId(created.id);
    setClient(created.name);
    setAddressId(undefined);
    setShowNewCustomer(false);
    setNewCustomerName("");
    setNewCustomerPhone("");
    setNewCustomerType("individual");
    showToast(`Linked to ${created.name}`, "success");
  };

  const createAddress = async () => {
    if (!customerId) return;
    const street = newAddrStreet.trim();
    if (!street) {
      showToast("Enter street address", "warning");
      return;
    }
    // Dedup — if this customer already has an address with the same
    // normalized street, link to that one instead of inserting a
    // duplicate row. Catches "1234 Main St" vs "1234 Main St." vs
    // "1234 main st" vs " 1234  Main St ".
    const existing = customerAddresses.find(
      (a) => norm(a.street) === norm(street),
    );
    if (existing) {
      setAddressId(existing.id);
      setProp(formatAddressLine(existing));
      setShowNewAddress(false);
      setNewAddrStreet("");
      setNewAddrLabel("");
      showToast(`Using existing address`, "info");
      return;
    }
    setCreatingAddress(true);
    const created = await upsertAddress({
      customer_id: customerId,
      street,
      label: newAddrLabel.trim() || undefined,
      // First address auto-flagged primary so the next quote on this
      // customer auto-picks it.
      is_primary: customerAddresses.length === 0,
    });
    setCreatingAddress(false);
    if (!created) return;
    setAddressId(created.id);
    setProp(formatAddressLine(created));
    setShowNewAddress(false);
    setNewAddrStreet("");
    setNewAddrLabel("");
  };

  const unlink = () => {
    setCustomerId(undefined);
    setAddressId(undefined);
    // Keep prop/client text — user may want to keep editing manually.
  };

  const fontSize = compact ? 12 : 13;

  /** Shared inline panel UI for the customer + address pickers. A text
   *  input filters the list as the user types; each row is a tappable
   *  button that selects + closes. A "+ New …" row at the bottom lets
   *  the user create a new entity if no match is found. */
  const PickerPanel = ({
    placeholder,
    q,
    setQ,
    items,
    onPick,
    onNew,
    onCancel,
    emptyLabel,
  }: {
    placeholder: string;
    q: string;
    setQ: (v: string) => void;
    items: { id: string; label: string; sub?: string }[];
    onPick: (id: string) => void;
    onNew: () => void;
    onCancel: () => void;
    emptyLabel: string;
  }) => (
    <div
      style={{
        marginBottom: 6,
        padding: 8,
        borderRadius: 6,
        border: "1px solid var(--color-primary)",
        background: "var(--color-card-dark, #12121a)",
      }}
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        autoFocus
        style={{ fontSize, width: "100%", marginBottom: 6 }}
      />
      <div style={{ maxHeight: 220, overflowY: "auto", marginBottom: 6 }}>
        {items.length === 0 ? (
          <div style={{ fontSize: 11, color: "#888", padding: "6px 4px" }}>
            {emptyLabel}
          </div>
        ) : (
          items.map((it) => (
            <button
              key={it.id}
              onClick={() => onPick(it.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 8px",
                marginBottom: 2,
                fontSize: 12,
                background: "transparent",
                color: "#e2e2e8",
                border: "1px solid transparent",
                borderRadius: 4,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor =
                  "var(--color-primary)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor =
                  "transparent";
              }}
            >
              <div style={{ fontWeight: 600 }}>{it.label}</div>
              {it.sub && (
                <div style={{ fontSize: 10, color: "#888", marginTop: 1 }}>
                  {it.sub}
                </div>
              )}
            </button>
          ))
        )}
      </div>
      <div className="row">
        <button
          className="bo"
          onClick={onNew}
          style={{ fontSize: 11, padding: "4px 10px", color: "var(--color-primary)" }}
        >
          + New
        </button>
        <button
          className="bo"
          onClick={onCancel}
          style={{ fontSize: 11, padding: "4px 10px", marginLeft: "auto" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  // ── Linked mode ───────────────────────────────────────────────────
  if (isLinked) {
    return (
      <div>
        <div className="row" style={{ alignItems: "center", marginBottom: 6, fontSize }}>
          <span style={{ color: "var(--color-primary)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
            🔗 {linkedCustomer.name}
          </span>
          <button
            className="bo"
            onClick={unlink}
            style={{ fontSize: 11, padding: "2px 8px", marginLeft: "auto" }}
          >
            Unlink
          </button>
        </div>

        {/* Address picker — button + inline search panel */}
        {!addressSearchOpen && !showNewAddress && (
          <button
            onClick={() => setAddressSearchOpen(true)}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "6px 10px",
              fontSize,
              background: "transparent",
              color: addressId ? "#e2e2e8" : "#888",
              border: "1px solid var(--color-border-dark, #2a2a3a)",
              borderRadius: 4,
              marginBottom: 6,
              cursor: "pointer",
            }}
          >
            {addressId
              ? addressOptionLabel(addresses.find((a) => a.id === addressId)!)
              : `Select address (${customerAddresses.length})…`}
          </button>
        )}

        {addressSearchOpen && (
          <PickerPanel
            placeholder="Search address by street, label, city, zip…"
            q={addressQ}
            setQ={setAddressQ}
            items={filteredAddresses.map((a) => ({
              id: a.id,
              label: addressOptionLabel(a),
              sub: a.city || a.zip ? [a.city, a.state, a.zip].filter(Boolean).join(", ") : undefined,
            }))}
            onPick={pickAddressById}
            onNew={() => {
              setAddressSearchOpen(false);
              setNewAddrStreet(addressQ);
              setAddressQ("");
              setShowNewAddress(true);
            }}
            onCancel={() => {
              setAddressSearchOpen(false);
              setAddressQ("");
            }}
            emptyLabel="No matching addresses. Tap + New to add."
          />
        )}

        {showNewAddress && (
          <div
            style={{
              marginBottom: 6,
              padding: 8,
              borderRadius: 6,
              border: "1px solid var(--color-primary)",
              background: "var(--color-card-dark, #12121a)",
            }}
          >
            <div className="g2 mb">
              <input
                value={newAddrStreet}
                onChange={(e) => setNewAddrStreet(e.target.value)}
                placeholder="Street *"
                style={{ fontSize: 12 }}
                autoFocus
              />
              <input
                value={newAddrLabel}
                onChange={(e) => setNewAddrLabel(e.target.value)}
                placeholder="Label (optional)"
                style={{ fontSize: 12 }}
              />
            </div>
            <div className="row">
              <button
                className="bg"
                disabled={creatingAddress}
                onClick={createAddress}
                style={{ fontSize: 12, padding: "4px 10px" }}
              >
                {creatingAddress ? "..." : "Create"}
              </button>
              <button
                className="bo"
                onClick={() => {
                  setShowNewAddress(false);
                  setNewAddrStreet("");
                  setNewAddrLabel("");
                }}
                style={{ fontSize: 12, padding: "4px 10px" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <input
          value={prop}
          readOnly
          placeholder="Address (auto-filled from selection)"
          style={{ fontSize, opacity: 0.7 }}
        />
      </div>
    );
  }

  // ── Free-text mode ────────────────────────────────────────────────
  return (
    <div>
      {/* Customer picker — button + inline search panel */}
      {!customerSearchOpen && !showNewCustomer && (
        <button
          onClick={() => setCustomerSearchOpen(true)}
          style={{
            width: "100%",
            textAlign: "left",
            padding: "6px 10px",
            fontSize,
            background: "transparent",
            color: "var(--color-primary)",
            border: "1px solid var(--color-primary)",
            borderRadius: 4,
            marginBottom: 6,
            cursor: "pointer",
          }}
        >
          🔗 Link to customer ({customers.length})…
        </button>
      )}

      {customerSearchOpen && (
        <PickerPanel
          placeholder="Search customers by name, phone, email…"
          q={customerQ}
          setQ={setCustomerQ}
          items={filteredCustomers.map((c) => ({
            id: c.id,
            label: c.name,
            sub: [c.phone, c.email].filter(Boolean).join(" · ") || undefined,
          }))}
          onPick={pickCustomerById}
          onNew={() => {
            setCustomerSearchOpen(false);
            setNewCustomerName(customerQ);
            setCustomerQ("");
            setShowNewCustomer(true);
          }}
          onCancel={() => {
            setCustomerSearchOpen(false);
            setCustomerQ("");
          }}
          emptyLabel="No matching customers. Tap + New to add."
        />
      )}

      {showNewCustomer && (
        <div
          style={{
            marginBottom: 6,
            padding: 8,
            borderRadius: 6,
            border: "1px solid var(--color-primary)",
            background: "var(--color-card-dark, #12121a)",
          }}
        >
          <div className="g2 mb">
            <input
              value={newCustomerName}
              onChange={(e) => setNewCustomerName(e.target.value)}
              placeholder="Name *"
              style={{ fontSize: 12 }}
              autoFocus
            />
            <input
              value={newCustomerPhone}
              onChange={(e) => setNewCustomerPhone(e.target.value)}
              placeholder="Phone"
              style={{ fontSize: 12 }}
            />
          </div>
          <div className="row mb" style={{ flexWrap: "wrap" }}>
            {(["individual", "business", "property_manager"] as CustomerType[]).map((t) => (
              <button
                key={t}
                onClick={() => setNewCustomerType(t)}
                style={{
                  padding: "3px 8px",
                  borderRadius: 4,
                  fontSize: 11,
                  background: newCustomerType === t ? "var(--color-primary)" : "transparent",
                  color: newCustomerType === t ? "#fff" : "#888",
                  border: `1px solid ${newCustomerType === t ? "var(--color-primary)" : "#444"}`,
                }}
              >
                {t === "property_manager" ? "Prop. Mgr" : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
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
                setNewCustomerPhone("");
                setNewCustomerType("individual");
              }}
              style={{ fontSize: 12, padding: "4px 10px" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="g2">
        <input
          value={prop}
          onChange={(e) => setProp(e.target.value)}
          placeholder="Property address *"
          style={{ fontSize }}
        />
        <input
          value={client}
          onChange={(e) => setClient(e.target.value)}
          placeholder="Client name (optional)"
          style={{ fontSize }}
        />
      </div>
    </div>
  );
}
