"use client";
/**
 * /portal/request — self-service "request work" form for logged-in
 * portal customers. Pre-fills the customer (from session) and lets them
 * pick which existing address the work is for. They describe the issue
 * and optionally attach photos. Submission creates a Job with
 * status="lead" so it surfaces in Bernard's app the same way leads
 * from the public /lead/<slug> form do.
 *
 * Photos go through /api/portal/upload-photo (cookie-protected) before
 * the form is finalized, so the eventual submit-work-order POST just
 * carries an array of public URLs.
 *
 * If the page is hit without a valid session we redirect to /portal,
 * which handles its own login redirect. This keeps the auth-failure
 * path single-sourced.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Customer, Address } from "@/lib/types";

const PRIMARY = "#2E75B6";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 13px",
  borderRadius: 8,
  border: "1px solid #1e1e2e",
  background: "#12121a",
  color: "#e2e2e8",
  fontSize: 14,
  fontFamily: "Source Sans 3, sans-serif",
};
const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#888",
  fontFamily: "Oswald, sans-serif",
  textTransform: "uppercase",
  letterSpacing: ".06em",
  marginBottom: 4,
  display: "block",
};

function formatAddress(a: Address): string {
  const line = [a.street, a.city, a.state, a.zip].filter(Boolean).join(", ");
  if (a.label && line) return `${a.label} — ${line}`;
  return a.label || line || "(no address info)";
}

interface MeResponse {
  customer: Customer;
  addresses: Address[];
  org: { name?: string } | null;
}

function RequestInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetAddress = searchParams.get("address") || "";

  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [addressId, setAddressId] = useState(presetAddress);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/portal/me", { cache: "no-store" })
      .then((res) => {
        if (res.status === 401) {
          router.replace("/portal/login");
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((j) => {
        if (cancelled || !j) return;
        setMe(j as MeResponse);
        // Auto-select the primary address if no preset and only one
        // makes sense (single-address customers shouldn't have to pick).
        if (!presetAddress) {
          const addrs = (j as MeResponse).addresses;
          const primary = addrs.find((a) => a.is_primary) || addrs[0];
          if (primary) setAddressId(primary.id);
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Couldn't load your portal — try again or request a new link.");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [router, presetAddress]);

  const orgName = me?.org?.name || "your contractor";

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      // Resize to a 1200px max edge before upload (same as /lead form).
      const canvas = document.createElement("canvas");
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("image load failed"));
        img.src = URL.createObjectURL(file);
      });
      let w = img.width, h = img.height;
      const max = 1200;
      if (w > max || h > max) {
        if (w > h) { h = Math.round(h * max / w); w = max; }
        else { w = Math.round(w * max / h); h = max; }
      }
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      const blob = await new Promise<Blob>((res) =>
        canvas.toBlob((b) => res(b || file), "image/jpeg", 0.7),
      );

      const fd = new FormData();
      fd.append("file", new File([blob], `photo.jpg`, { type: "image/jpeg" }));
      const res = await fetch("/api/portal/upload-photo", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Photo upload failed");
        return;
      }
      if (data?.url) setPhotos((prev) => [...prev, data.url]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo upload failed");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    setError("");
    if (!description.trim()) {
      setError("Tell us what you need done.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/portal/submit-work-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addressId: addressId || null,
          description: description.trim(),
          photos,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Couldn't submit — try again.");
        setSubmitting(false);
        return;
      }
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    }
    setSubmitting(false);
  };

  const sortedAddresses = useMemo(() => {
    if (!me) return [];
    return [...me.addresses].sort(
      (a, b) => Number(b.is_primary ?? false) - Number(a.is_primary ?? false),
    );
  }, [me]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: PRIMARY, fontFamily: "Oswald, sans-serif", fontSize: 18 }}>Loading…</div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f, #0d1530)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ width: "100%", maxWidth: 420, textAlign: "center" }}>
          <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 28 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: "#00cc66", textTransform: "uppercase", marginBottom: 8 }}>
              Request received
            </h2>
            <p style={{ color: "#aaa", fontSize: 14, lineHeight: 1.5 }}>
              {orgName} will review your request and get back to you with a quote.
            </p>
            <a
              href="/portal"
              style={{
                display: "inline-block", marginTop: 16,
                padding: "10px 18px", borderRadius: 8,
                background: PRIMARY, color: "#fff",
                fontFamily: "Oswald, sans-serif", fontSize: 13,
                textTransform: "uppercase", letterSpacing: ".05em",
                textDecoration: "none",
              }}
            >
              ← Back to portal
            </a>
          </div>
          <div style={{ color: "#555", fontSize: 10, marginTop: 16 }}>Powered by Creed App</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f, #0d1530)", padding: "24px 16px 60px" }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <div style={{ marginBottom: 14 }}>
          <a
            href="/portal"
            style={{ color: "#888", fontSize: 12, textDecoration: "none" }}
          >
            ← Back to portal
          </a>
        </div>

        <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 22 }}>
          <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: PRIMARY, textTransform: "uppercase", letterSpacing: ".05em", margin: "0 0 4px", textAlign: "center" }}>
            Request Work
          </h1>
          <p style={{ color: "#888", fontSize: 12, textAlign: "center", margin: "0 0 18px" }}>
            We&apos;ll review your request and follow up with a quote.
          </p>

          {/* Address picker */}
          {sortedAddresses.length > 0 ? (
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Property</label>
              <select
                value={addressId}
                onChange={(e) => setAddressId(e.target.value)}
                style={{ ...inputStyle, fontSize: 14 }}
              >
                {sortedAddresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {formatAddress(a)}
                  </option>
                ))}
                <option value="">Other / not listed</option>
              </select>
            </div>
          ) : (
            <div style={{ marginBottom: 12, padding: "8px 10px", borderRadius: 6, background: "#1a1a28", fontSize: 12, color: "#bbb" }}>
              No address on file — your contractor will follow up to confirm where the work is.
            </div>
          )}

          {/* Description */}
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>What do you need done? *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Kitchen faucet leaking, garage door won't close all the way, missing outlet covers in the upstairs bedroom..."
              style={{ ...inputStyle, height: 110, resize: "vertical" }}
            />
          </div>

          {/* Photos */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Photos (optional, up to 8)</label>
            <label
              style={{
                display: "block",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px dashed #444",
                background: "#0a0a0f",
                color: "#888",
                fontSize: 12,
                textAlign: "center",
                cursor: uploading || photos.length >= 8 ? "not-allowed" : "pointer",
                opacity: photos.length >= 8 ? 0.5 : 1,
              }}
            >
              {uploading
                ? "Uploading…"
                : photos.length === 0
                ? "📷 Tap to add photos"
                : photos.length >= 8
                ? "Max photos reached"
                : `+ Add another (${photos.length} added)`}
              <input
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                disabled={uploading || photos.length >= 8}
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []).slice(0, 8 - photos.length);
                  for (const f of files) await uploadPhoto(f);
                  if (e.target) e.target.value = "";
                }}
              />
            </label>
            {photos.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(70px, 1fr))", gap: 6, marginTop: 8 }}>
                {photos.map((url, i) => (
                  <div key={i} style={{ position: "relative" }}>
                    <img
                      src={url}
                      alt=""
                      style={{ width: "100%", height: 70, objectFit: "cover", borderRadius: 6, border: "1px solid #1e1e2e" }}
                    />
                    <button
                      onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                      style={{
                        position: "absolute", top: 2, right: 2,
                        background: "rgba(0,0,0,0.7)", color: "#fff", border: "none",
                        borderRadius: "50%", width: 18, height: 18, fontSize: 12,
                        cursor: "pointer", lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div style={{ background: "#3a0d0d", border: "1px solid #C00000", borderRadius: 6, padding: "8px 10px", marginBottom: 12, fontSize: 12, color: "#ff8888" }}>
              {error}
            </div>
          )}

          <button
            onClick={submit}
            disabled={submitting || uploading}
            style={{
              width: "100%", padding: 13, borderRadius: 8, fontSize: 15,
              fontFamily: "Oswald, sans-serif", textTransform: "uppercase",
              letterSpacing: ".05em", background: PRIMARY, color: "#fff",
              border: "none", cursor: submitting ? "wait" : "pointer",
              opacity: submitting || uploading ? 0.6 : 1,
            }}
          >
            {submitting ? "Sending…" : "📋 Send my request"}
          </button>
          <p style={{ color: "#555", fontSize: 11, textAlign: "center", margin: "10px 0 0" }}>
            Typical response within one business day.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function PortalRequestPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0a0f" }} />}>
      <RequestInner />
    </Suspense>
  );
}
