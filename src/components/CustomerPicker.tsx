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
 */
import { useState } from "react";
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

  const pickCustomerById = (id: string) => {
    if (id === "__NEW__") {
      setShowNewCustomer(true);
      return;
    }
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
  };

  const pickAddressById = (id: string) => {
    if (id === "__NEW__") {
      setShowNewAddress(true);
      return;
    }
    if (!id) {
      setAddressId(undefined);
      return;
    }
    const a = addresses.find((x) => x.id === id);
    if (!a) return;
    setAddressId(a.id);
    setProp(formatAddressLine(a));
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
    if (!newAddrStreet.trim()) {
      showToast("Enter street address", "warning");
      return;
    }
    setCreatingAddress(true);
    const created = await upsertAddress({
      customer_id: customerId,
      street: newAddrStreet.trim(),
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

        <select
          value={addressId || ""}
          onChange={(e) => pickAddressById(e.target.value)}
          style={{ fontSize, marginBottom: 6, width: "100%" }}
        >
          <option value="">Select address...</option>
          {customerAddresses.map((a) => (
            <option key={a.id} value={a.id}>{addressOptionLabel(a)}</option>
          ))}
          <option value="__NEW__">+ New address...</option>
        </select>

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
      <select
        value=""
        onChange={(e) => pickCustomerById(e.target.value)}
        style={{ fontSize, color: "var(--color-primary)", marginBottom: 6, width: "100%" }}
      >
        <option value="">🔗 Link to customer...</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
        <option value="__NEW__">+ New customer...</option>
      </select>

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
