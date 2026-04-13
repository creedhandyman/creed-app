"use client";
import { useState } from "react";
import { db } from "@/lib/supabase";
import { useStore } from "@/lib/store";

interface Props {
  orgId: string;
  primaryColor: string;
}

export default function WorkOrderForm({ orgId, primaryColor: pc }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim() || !description.trim()) return;
    setSubmitting(true);
    try {
      await db.post("referrals", {
        org_id: orgId,
        name: name.trim(),
        source: `WORK ORDER | Phone: ${phone || "N/A"} | Address: ${address || "N/A"} | ${description.trim()}`,
        status: "pending",
        ref_date: new Date().toISOString().split("T")[0],
      });
      setSubmitted(true);
    } catch (e) {
      console.error(e);
      useStore.getState().showToast("Failed to submit — please call us directly", "error");
    }
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <div style={{ padding: "30px 0", borderTop: "1px solid #1e1e2e", textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: pc, textTransform: "uppercase", marginBottom: 8 }}>
          Request Received!
        </h2>
        <p style={{ color: "#888", fontSize: 14 }}>We&apos;ll be in touch shortly with a quote.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "30px 0", borderTop: "1px solid #1e1e2e" }}>
      <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: pc, textTransform: "uppercase", textAlign: "center", marginBottom: 20 }}>
        Request a Quote
      </h2>
      <div style={{ maxWidth: 500, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name *"
            style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #1e1e2e", background: "#12121a", color: "#e2e2e8", fontSize: 13 }}
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone number"
            style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #1e1e2e", background: "#12121a", color: "#e2e2e8", fontSize: 13 }}
          />
        </div>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Property address"
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #1e1e2e", background: "#12121a", color: "#e2e2e8", fontSize: 13, marginBottom: 10 }}
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the work you need done *"
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #1e1e2e", background: "#12121a", color: "#e2e2e8", fontSize: 13, height: 90, resize: "vertical", marginBottom: 10 }}
        />
        <button
          onClick={submit}
          disabled={submitting || !name.trim() || !description.trim()}
          style={{
            width: "100%", padding: "12px", borderRadius: 8, fontSize: 16,
            fontFamily: "Oswald, sans-serif", textTransform: "uppercase",
            background: (!name.trim() || !description.trim()) ? "#333" : pc,
            color: "#fff", border: "none", cursor: submitting ? "wait" : "pointer",
            opacity: (!name.trim() || !description.trim()) ? 0.5 : 1,
          }}
        >
          {submitting ? "Submitting..." : "📋 Submit Work Order"}
        </button>
        <p style={{ textAlign: "center", color: "#555", fontSize: 12, marginTop: 8 }}>
          We&apos;ll review your request and send you a detailed quote
        </p>
      </div>
    </div>
  );
}
