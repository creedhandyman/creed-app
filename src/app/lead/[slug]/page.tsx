"use client";
/**
 * Public lead intake form. Lives at /lead/[slug] so each org has a
 * shareable link. Submission goes through /api/leads which resolves
 * the org server-side, finds-or-creates a Customer, attaches an
 * Address, and inserts a Job with status="lead".
 *
 * Visual styling matches /status, /review via the shared `.pub` design
 * system (globals.css) — same dark brand, Oswald headings, glow CTA.
 * Mobile-first since prospects are typically on a phone.
 */
import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { db, supabase } from "@/lib/supabase";
import type { Organization } from "@/lib/types";
import { Icon, type IconName } from "@/components/Icon";

// Job-type quick picker (from the render). Folded into the description on
// submit so it's captured without an /api/leads contract change.
const JOB_TYPES: { key: string; icon: IconName }[] = [
  { key: "Repair", icon: "hammer" },
  { key: "Remodel", icon: "paint" },
  { key: "Turnover", icon: "home" },
];

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

  const [jobType, setJobType] = useState("");
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
          // Prepend the chosen job type so the crew sees it on the lead.
          description: (jobType ? `[${jobType}] ` : "") + description.trim(),
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
    return <div className="pub" />;
  }

  if (!org) {
    return (
      <div className="pub" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
          <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: "#ff7a7a", textTransform: "uppercase" }}>Page Not Found</h1>
          <p style={{ color: "#8a8a99", fontSize: 15, marginTop: 8 }}>This link may be invalid.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="pub" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="pub-wrap" style={{ textAlign: "center" }}>
          <div className="bh">
            <div className="logo">
              {org.logo_url
                ? <img src={org.logo_url} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
                : (org.name?.[0]?.toUpperCase() || "C")}
            </div>
            <div className="nm">{org.name}</div>
          </div>
          <div className="card" style={{ textAlign: "center", padding: 28 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: "#3ee08f", textTransform: "uppercase", marginBottom: 8 }}>Thanks!</h2>
            <p className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
              We&apos;ve got your request. {org.name} will be in touch shortly with a quote.
            </p>
            {org.phone && (
              <p style={{ color: "#8a8a99", fontSize: 14, marginTop: 12 }}>
                Need to reach us? <a href={`tel:${org.phone}`} style={{ color: "#7fb6ff", textDecoration: "none" }}>{org.phone}</a>
              </p>
            )}
          </div>
          <div style={{ color: "#666", fontSize: 12, marginTop: 16 }}>Powered by Creed App</div>
        </div>
      </div>
    );
  }

  return (
    <div className="pub">
      <div className="pub-wrap">
        {/* Brand header */}
        <div className="bh">
          <div className="logo">
            {org.logo_url
              ? <img src={org.logo_url} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
              : (org.name?.[0]?.toUpperCase() || "C")}
          </div>
          <div className="nm">{org.name}</div>
          {org.phone && <div className="ph">{org.phone}</div>}
        </div>

        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: ".4px", textTransform: "uppercase" }}>Get a Free Quote</div>
          <div className="muted" style={{ marginTop: 3 }}>Tell us what you need — we reply same day.</div>
        </div>

        {/* Job type */}
        <div className="lbl">What&apos;s the job?</div>
        <div className="seg">
          {JOB_TYPES.map((t) => (
            <div
              key={t.key}
              className={`segb${jobType === t.key ? " on" : ""}`}
              onClick={() => setJobType(jobType === t.key ? "" : t.key)}
            >
              <Icon name={t.icon} size={19} /> {t.key}
            </div>
          ))}
        </div>

        {/* Contact */}
        <input className="in" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
        <div className="row" style={{ marginBottom: 10 }}>
          <input className="in" style={{ marginBottom: 0 }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" inputMode="tel" autoComplete="tel" />
          <input className="in" style={{ marginBottom: 0 }} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" inputMode="email" autoComplete="email" />
        </div>

        {/* Address */}
        <input className="in" value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Property address" autoComplete="street-address" />
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
          <input className="in" style={{ marginBottom: 0 }} value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" autoComplete="address-level2" />
          <input className="in" style={{ marginBottom: 0 }} value={state} onChange={(e) => setState(e.target.value)} placeholder="ST" autoComplete="address-level1" />
          <input className="in" style={{ marginBottom: 0 }} value={zip} onChange={(e) => setZip(e.target.value)} placeholder="ZIP" autoComplete="postal-code" inputMode="numeric" />
        </div>

        {/* Description */}
        <textarea className="in" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the work…" rows={3} style={{ resize: "vertical" }} />

        {/* Photos */}
        <div className="lbl">Photos help us quote faster</div>
        <div className="photos">
          {photos.map((url, i) => (
            <div key={i} className="ph-img" style={{ backgroundImage: `url(${url})` }}>
              <span className="x" onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}><Icon name="close" size={11} color="#fff" /></span>
            </div>
          ))}
          {photos.length < 8 && (
            <label className="ph-tile">
              {uploading ? "…" : <Icon name="camera" size={20} />}
              <input
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                disabled={uploading}
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []).slice(0, 8 - photos.length);
                  for (const f of files) await uploadPhoto(f);
                  if (e.target) e.target.value = "";
                }}
              />
            </label>
          )}
        </div>

        {error && (
          <div style={{ background: "#3a0d0d", border: "1px solid #C00000", borderRadius: 8, padding: "8px 10px", marginBottom: 11, fontSize: 14, color: "#ff8888" }}>
            {error}
          </div>
        )}

        <button className="btn glow-green" onClick={submit} disabled={submitting || uploading}>
          <Icon name="send" size={17} /> {submitting ? "Submitting…" : "Send My Request"}
        </button>
        <div className="muted" style={{ textAlign: "center", marginTop: 9, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <Icon name="safety" size={12} /> No spam. We only use this to quote your job.
        </div>

        <div style={{ textAlign: "center", color: "#666", fontSize: 12, marginTop: 16 }}>Powered by Creed App</div>
      </div>
    </div>
  );
}

export default function LeadIntakePage() {
  return (
    <Suspense fallback={<div className="pub" />}>
      <LeadIntakeInner />
    </Suspense>
  );
}
