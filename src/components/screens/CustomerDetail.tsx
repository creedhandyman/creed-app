"use client";
/**
 * CustomerDetail — read-only stub in Step 1.2; the full editable
 * version (inline edit + add/delete addresses + related jobs/quotes/
 * payments) lands in Step 1.3. Routed from AppShell when the user
 * taps a row in Customers.tsx.
 */
import { useStore } from "@/lib/store";
import { Icon } from "../Icon";
import type { CustomerType } from "@/lib/types";

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

const formatAddress = (a: { street?: string; city?: string; state?: string; zip?: string }) => {
  const line = [a.street, a.city, a.state, a.zip].filter(Boolean).join(", ");
  return line || "(no street info)";
};

export default function CustomerDetail({ customerId, onBack }: Props) {
  const customer = useStore((s) => s.customers.find((c) => c.id === customerId));
  const addresses = useStore((s) => s.addresses.filter((a) => a.customer_id === customerId));

  if (!customer) {
    return (
      <div className="fi">
        <div className="row mb">
          <button className="bo" onClick={onBack} style={{ fontSize: 12, padding: "4px 8px" }}>← Back</button>
          <h2 style={{ fontSize: 18, color: "var(--color-warning)" }}>Customer not found</h2>
        </div>
        <p className="dim" style={{ fontSize: 13 }}>
          The customer record may have been deleted. Returning to the list will refresh.
        </p>
      </div>
    );
  }

  const typeColor = TYPE_COLOR[customer.type];

  return (
    <div className="fi">
      {/* Header */}
      <div className="row mb" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <button className="bo" onClick={onBack} style={{ fontSize: 12, padding: "4px 8px" }}>← Back</button>
          <h2 style={{ fontSize: 18, color: typeColor, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="clients" size={18} color={typeColor} />
            {customer.name}
          </h2>
        </div>
        <span style={{
          fontSize: 11, fontFamily: "Oswald", letterSpacing: ".04em",
          padding: "3px 8px", borderRadius: 10,
          background: `${typeColor}22`, color: typeColor,
        }}>
          {TYPE_LABEL[customer.type]}
        </span>
      </div>

      {/* Contact info */}
      <div className="cd mb">
        <h4 style={{ fontSize: 13, marginBottom: 8 }}>Contact</h4>
        {customer.primary_contact && (
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            <span className="dim" style={{ fontSize: 11 }}>Primary contact</span>
            <div>{customer.primary_contact}</div>
          </div>
        )}
        {customer.phone && (
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            <span className="dim" style={{ fontSize: 11 }}>Phone</span>
            <div>☎ {customer.phone}</div>
          </div>
        )}
        {customer.email && (
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            <span className="dim" style={{ fontSize: 11 }}>Email</span>
            <div>✉ {customer.email}</div>
          </div>
        )}
        {!customer.primary_contact && !customer.phone && !customer.email && (
          <p className="dim" style={{ fontSize: 12 }}>No contact info on file.</p>
        )}
      </div>

      {/* Notes */}
      {customer.notes && (
        <div className="cd mb">
          <h4 style={{ fontSize: 13, marginBottom: 6 }}>Notes</h4>
          <p style={{ fontSize: 13, whiteSpace: "pre-wrap", margin: 0 }}>{customer.notes}</p>
        </div>
      )}

      {/* Addresses */}
      <div className="cd mb">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h4 style={{ fontSize: 13, margin: 0 }}>
            📍 Addresses ({addresses.length})
          </h4>
        </div>
        {addresses.length === 0 ? (
          <p className="dim" style={{ fontSize: 12, fontStyle: "italic" }}>
            No addresses yet. Editing comes in the next update — for now, addresses can be added from the quote/job creation flow once it&apos;s wired.
          </p>
        ) : (
          addresses
            .slice()
            .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
            .map((a) => (
              <div
                key={a.id}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: `1px solid ${a.is_primary ? "var(--color-primary)" : "transparent"}`,
                  background: a.is_primary ? "var(--color-primary)11" : undefined,
                  marginBottom: 4,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <b style={{ fontSize: 13 }}>{a.label || a.street || "(unlabeled)"}</b>
                  {a.is_primary && (
                    <span style={{ fontSize: 10, color: "var(--color-primary)", fontFamily: "Oswald" }}>PRIMARY</span>
                  )}
                </div>
                <div className="dim" style={{ fontSize: 12 }}>{formatAddress(a)}</div>
              </div>
            ))
        )}
      </div>

      <p className="dim" style={{ fontSize: 11, textAlign: "center", marginTop: 6 }}>
        Read-only view. Inline editing and related jobs/quotes/payments arrive in the next deploy.
      </p>
    </div>
  );
}
