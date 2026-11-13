"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";

interface Props {
  /** The business's web address name (site_slug); the lead route finds the
   *  business from it server-side. */
  slug: string;
  primaryColor: string;
}

export default function WorkOrderForm({ slug, primaryColor: pc }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const ready = !!(name.trim() && phone.trim() && description.trim());

  // Goes through the public lead route (service role, org resolved from the
  // slug) so the request becomes a real lead with an alert. It used to write
  // a referrals row straight from the browser, which never saved for
  // signed-out visitors.
  const submit = async () => {
    if (!ready) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          name: name.trim(),
          phone: phone.trim(),
          street: address.trim(),
          description: description.trim(),
        }),
      });
      if (!res.ok) throw new Error(`lead ${res.status}`);
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
        <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: pc, textTransform: "uppercase", marginBottom: 8 }}>
          Request Received!
        </h2>
        <p style={{ color: "#888", fontSize: 16 }}>We&apos;ll be in touch shortly with a quote.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "30px 0", borderTop: "1px solid #1e1e2e" }}>
      <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: pc, textTransform: "uppercase", textAlign: "center", marginBottom: 20 }}>
        Request a Quote
      </h2>
      <div style={{ maxWidth: 500, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name *"
            style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #1e1e2e", background: "#12121a", color: "#e2e2e8", fontSize: 15 }}
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone number *"
            style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #1e1e2e", background: "#12121a", color: "#e2e2e8", fontSize: 15 }}
          />
        </div>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Property address"
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #1e1e2e", background: "#12121a", color: "#e2e2e8", fontSize: 15, marginBottom: 10 }}
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the work you need done *"
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #1e1e2e", background: "#12121a", color: "#e2e2e8", fontSize: 15, height: 90, resize: "vertical", marginBottom: 10 }}
        />
        <button
          onClick={submit}
          disabled={submitting || !ready}
          style={{
            width: "100%", padding: "12px", borderRadius: 8, fontSize: 18,
            fontFamily: "Oswald, sans-serif", textTransform: "uppercase",
            background: !ready ? "#333" : pc,
            color: "#fff", border: "none", cursor: submitting ? "wait" : "pointer",
            opacity: !ready ? 0.5 : 1,
          }}
        >
          {submitting ? "Submitting..." : "📋 Submit Work Order"}
        </button>
        <p style={{ textAlign: "center", color: "#555", fontSize: 14, marginTop: 8 }}>
          We&apos;ll review your request and send you a detailed quote
        </p>
      </div>
    </div>
  );
}
