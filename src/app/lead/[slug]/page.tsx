"use client";
/**
 * Public lead intake form. Lives at /lead/[slug] so each org has a
 * shareable link. Submission goes through /api/leads which resolves
 * the org server-side, finds-or-creates a Customer, attaches an
 * Address, and inserts a Job with status="lead".
 *
 * Visual styling matches /status, /review, and /s/[slug] — same
 * dark gradient, Oswald headings, brand-blue accent. Mobile-first
 * since prospects are typically on a phone.
 */
import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { db, supabase } from "@/lib/supabase";
import type { Organization } from "@/lib/types";

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

function LeadIntakeInner() {
  const { slug } = useParams<{ slug: string }>();
  const params = useSearchParams();
  // Tech-attribution: prefer the URL param if present, otherwise fall
  // back to the value /card/<slug> wrote into sessionStorage when the
  // visitor first landed there. Either way it gets POSTed to /api/leads
  // which writes it onto jobs.referrer_tech_id.
  const [techId, setTechId] = useState("");
  useEffect(() => {
    const fromUrl = params.get("tech") || "";
    if (fromUrl) {
      setTechId(fromUrl);
      try { sessionStorage.setItem("c_lead_tech", fromUrl); } catch { /* */ }
      return;
    }
    try {
      const stashed = sessionStorage.getItem("c_lead_tech");
      if (stashed) setTechId(stashed);
    } catch { /* */ }
  }, [params]);

  const [org, setOrg] = useState<Organization | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!slug) { setOrgLoading(false); return; }
    db.get<Organization>("organizations", { site_slug: slug }).then((orgs) => {
      if (orgs.length) setOrg(orgs[0]);
      setOrgLoading(false);
    });
  }, [slug]);

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      const canvas = document.createElement("canvas");
      const img = new Image();
      await new Promise<void>((res) => {
        img.onload = () => res();
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
        canvas.toBlob((b) => res(b || file), "image/jpeg", 0.7)
      );
      const path = `leads/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;
      const { error: upErr } = await supabase.storage.from("receipts").upload(path, blob);
      if (!upErr) {
        const { data } = supabase.storage.from("receipts").getPublicUrl(path);
        if (data?.publicUrl) setPhotos((prev) => [...prev, data.publicUrl]);
      }
    } catch {
      // photo upload failures are non-blocking; the prospect can still submit
    }
    setUploading(false);
  };

  const submit = async () => {
    setError("");
    if (!name.trim() || !description.trim()) {
      setError("Please fill in your name and what you need done.");
      return;
    }
    if (!phone.trim() && !email.trim()) {
      setError("Please add a phone number or email so we can reach you.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          street: street.trim(),
          city: city.trim(),
          state: state.trim(),
          zip: zip.trim(),
          description: description.trim(),
          photos,
          referrer_tech_id: techId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Something went wrong — please call us directly.");
        setSubmitting(false);
        return;
      }
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error — please try again.");
    }
    setSubmitting(false);
  };

  if (orgLoading) {
    return <div style={{ minHeight: "100vh", background: "#0a0a0f" }} />;
  }

  if (!org) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f, #0d1530)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
          <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: "#C00000" }}>Page Not Found</h1>
          <p style={{ color: "#888", fontSize: 13, marginTop: 8 }}>This link may be invalid.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f, #0d1530)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ width: "100%", maxWidth: 420, textAlign: "center" }}>
          {org.logo_url && (
            <img src={org.logo_url} alt="" style={{ height: 56, marginBottom: 16 }}
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          )}
          <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 28 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: "#00cc66", textTransform: "uppercase", marginBottom: 8 }}>
              Thanks!
            </h2>
            <p style={{ color: "#aaa", fontSize: 14, lineHeight: 1.5 }}>
              We&apos;ve got your request. {org.name} will be in touch shortly with a quote.
            </p>
            {org.phone && (
              <p style={{ color: "#666", fontSize: 12, marginTop: 12 }}>
                Need to reach us? <a href={`tel:${org.phone}`} style={{ color: PRIMARY, textDecoration: "none" }}>{org.phone}</a>
              </p>
            )}
          </div>
          <div style={{ color: "#555", fontSize: 10, marginTop: 16 }}>Powered by Creed App</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f, #0d1530)", padding: "24px 16px 40px" }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          {org.logo_url && (
            <img src={org.logo_url} alt="" style={{ height: 56, display: "block", margin: "0 auto 10px" }}
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          )}
          <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: PRIMARY, textTransform: "uppercase", letterSpacing: ".05em", margin: 0 }}>
            {org.name}
          </h1>
          {org.phone && (
            <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{org.phone}</div>
          )}
        </div>

        <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 20 }}>
          <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 18, color: "#e2e2e8", textTransform: "uppercase", textAlign: "center", marginTop: 0, marginBottom: 4 }}>
            Request a Quote
          </h2>
          <p style={{ color: "#888", fontSize: 12, textAlign: "center", margin: "0 0 18px" }}>
            Tell us what you need. We&apos;ll get back to you with a detailed quote.
          </p>

          {/* Contact */}
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Your Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" style={inputStyle} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Phone</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="555-555-5555"
                inputMode="tel"
                autoComplete="tel"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                inputMode="email"
                autoComplete="email"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Address */}
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Property Address</label>
            <input
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              placeholder="Street"
              autoComplete="street-address"
              style={{ ...inputStyle, marginBottom: 8 }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" autoComplete="address-level2" style={inputStyle} />
              <input value={state} onChange={(e) => setState(e.target.value)} placeholder="ST" autoComplete="address-level1" style={inputStyle} />
              <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="ZIP" autoComplete="postal-code" inputMode="numeric" style={inputStyle} />
            </div>
          </div>

          {/* Description */}
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>What do you need done? *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Kitchen faucet leaking, bathroom door won't latch, missing outlet covers in bedroom..."
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
                cursor: "pointer",
              }}
            >
              {uploading ? "Uploading..." : photos.length === 0 ? "📷 Tap to add photos" : `+ Add another (${photos.length} added)`}
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
                    <img src={url} alt="" style={{ width: "100%", height: 70, objectFit: "cover", borderRadius: 6, border: "1px solid #1e1e2e" }} />
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
              width: "100%",
              padding: "13px",
              borderRadius: 8,
              fontSize: 15,
              fontFamily: "Oswald, sans-serif",
              textTransform: "uppercase",
              letterSpacing: ".05em",
              background: PRIMARY,
              color: "#fff",
              border: "none",
              cursor: submitting ? "wait" : "pointer",
              opacity: submitting || uploading ? 0.6 : 1,
            }}
          >
            {submitting ? "Submitting..." : "📋 Send My Request"}
          </button>
          <p style={{ color: "#555", fontSize: 11, textAlign: "center", margin: "10px 0 0" }}>
            We typically respond within one business day.
          </p>
        </div>

        <div style={{ textAlign: "center", color: "#555", fontSize: 10, marginTop: 16 }}>
          Powered by Creed App
        </div>
      </div>
    </div>
  );
}

export default function LeadIntakePage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0a0f" }} />}>
      <LeadIntakeInner />
    </Suspense>
  );
}
