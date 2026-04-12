"use client";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { db } from "@/lib/supabase";
import type { Organization, Review } from "@/lib/types";
import WorkOrderForm from "@/components/WorkOrderForm";
import { Suspense } from "react";

interface SiteContent {
  headline: string;
  subheadline: string;
  services: string[];
  whyUs: string[];
  cta: string;
  about: string;
}
interface GalleryPhoto { url: string; caption: string; }
interface SiteTheme {
  primaryColor: string;
  showGallery: boolean;
  showReviews: boolean;
  showAbout: boolean;
  showServices: boolean;
  showWhyUs: boolean;
}
const DEFAULT_THEME: SiteTheme = { primaryColor: "#2E75B6", showGallery: true, showReviews: true, showAbout: true, showServices: true, showWhyUs: true };

function SitePageContent() {
  const params = useSearchParams();
  const orgId = params.get("org");

  const [org, setOrg] = useState<Organization | null>(null);
  const [content, setContent] = useState<SiteContent | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [gallery, setGallery] = useState<GalleryPhoto[]>([]);
  const [theme, setTheme] = useState<SiteTheme>(DEFAULT_THEME);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) { setLoading(false); return; }
    Promise.all([
      db.get<Organization>("organizations", { id: orgId }),
      db.get<Review>("reviews", { org_id: orgId }),
    ]).then(([orgs, revs]) => {
      if (orgs.length) {
        const o = orgs[0];
        setOrg(o);
        try { if (o.site_content) setContent(JSON.parse(o.site_content)); } catch { /* */ }
        try { if (o.gallery_photos) setGallery(JSON.parse(o.gallery_photos)); } catch { /* */ }
        try { if (o.site_theme) setTheme({ ...DEFAULT_THEME, ...JSON.parse(o.site_theme) }); } catch { /* */ }
      }
      setReviews(revs.filter((r) => r.rating >= 4).slice(0, 6));
      setLoading(false);
    });
  }, [orgId]);

  if (loading) return <div style={{ minHeight: "100vh", background: "#0a0a0f" }} />;
  if (!org || !content) {
    return (
      <div style={{ minHeight: "100vh", background: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: "#888" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔗</div>
          <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: "#C00000" }}>Page Not Found</h1>
        </div>
      </div>
    );
  }

  const pc = theme.primaryColor;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e2e2e8" }}>
      {/* Lightbox */}
      {lightbox !== null && gallery[lightbox] && (
        <div onClick={() => setLightbox(null)} style={{
          position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,.9)",
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        }}>
          <img src={gallery[lightbox].url} alt="" style={{ maxWidth: "90vw", maxHeight: "85vh", borderRadius: 8 }} />
          {gallery[lightbox].caption && (
            <div style={{ position: "absolute", bottom: 32, color: "#fff", fontSize: 14, textAlign: "center" }}>
              {gallery[lightbox].caption}
            </div>
          )}
          {lightbox > 0 && (
            <button onClick={(e) => { e.stopPropagation(); setLightbox(lightbox - 1); }}
              style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,.6)", color: "#fff", border: "none", borderRadius: "50%", width: 40, height: 40, fontSize: 20, cursor: "pointer" }}>‹</button>
          )}
          {lightbox < gallery.length - 1 && (
            <button onClick={(e) => { e.stopPropagation(); setLightbox(lightbox + 1); }}
              style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,.6)", color: "#fff", border: "none", borderRadius: "50%", width: 40, height: 40, fontSize: 20, cursor: "pointer" }}>›</button>
          )}
        </div>
      )}

      {/* Hero */}
      <div style={{ background: "linear-gradient(135deg, #0d1530 0%, #0a0a0f 50%, #0d1020 100%)", padding: "60px 20px 50px", textAlign: "center" }}>
        {org.logo_url && (
          <img src={org.logo_url} alt="" style={{ height: 70, display: "block", margin: "0 auto 16px" }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
        )}
        <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 36, color: pc, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>
          {org.name}
        </h1>
        <p style={{ fontSize: 20, color: "#fff", maxWidth: 600, margin: "0 auto 12px", fontFamily: "Source Sans 3, sans-serif" }}>{content.headline}</p>
        <p style={{ fontSize: 14, color: "#888", maxWidth: 500, margin: "0 auto 24px" }}>{content.subheadline}</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          {org.phone && (
            <a href={`tel:${org.phone}`} style={{ padding: "12px 28px", borderRadius: 8, fontSize: 16, fontFamily: "Oswald, sans-serif", textTransform: "uppercase", background: pc, color: "#fff", textDecoration: "none" }}>
              📞 Call Now
            </a>
          )}
          <a href={`/review?org=${orgId}`} style={{ padding: "12px 28px", borderRadius: 8, fontSize: 16, fontFamily: "Oswald, sans-serif", textTransform: "uppercase", background: "transparent", color: pc, textDecoration: "none", border: `1px solid ${pc}` }}>
            ⭐ Leave a Review
          </a>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 20px" }}>
        {/* Services */}
        {theme.showServices && (
          <div style={{ padding: "40px 0" }}>
            <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: pc, textTransform: "uppercase", textAlign: "center", marginBottom: 24 }}>Our Services</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              {content.services.map((s, i) => (
                <div key={i} style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 10, padding: "16px", textAlign: "center", fontSize: 14 }}>{s}</div>
              ))}
            </div>
          </div>
        )}

        {/* Why Us */}
        {theme.showWhyUs && (
          <div style={{ padding: "30px 0", borderTop: "1px solid #1e1e2e" }}>
            <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: pc, textTransform: "uppercase", textAlign: "center", marginBottom: 24 }}>{content.cta || "Why Choose Us"}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {content.whyUs.map((w, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                  <span style={{ color: "#00cc66", fontSize: 16, flexShrink: 0 }}>✓</span>
                  <span>{w}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* About */}
        {theme.showAbout && content.about && (
          <div style={{ padding: "30px 0", borderTop: "1px solid #1e1e2e", textAlign: "center" }}>
            <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: pc, textTransform: "uppercase", marginBottom: 12 }}>About Us</h2>
            <p style={{ fontSize: 14, color: "#aaa", maxWidth: 600, margin: "0 auto", lineHeight: 1.6 }}>{content.about}</p>
          </div>
        )}

        {/* Gallery */}
        {theme.showGallery && gallery.length > 0 && (
          <div style={{ padding: "30px 0", borderTop: "1px solid #1e1e2e" }}>
            <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: pc, textTransform: "uppercase", textAlign: "center", marginBottom: 24 }}>Our Work</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              {gallery.map((p, i) => (
                <div key={i} onClick={() => setLightbox(i)} style={{ cursor: "pointer", position: "relative", overflow: "hidden", borderRadius: 10, border: "1px solid #1e1e2e" }}>
                  <img src={p.url} alt={p.caption || ""} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block", transition: "transform .2s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")} />
                  {p.caption && (
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "16px 8px 6px", background: "linear-gradient(transparent, rgba(0,0,0,.8))", fontSize: 11, color: "#ddd", textAlign: "center" }}>
                      {p.caption}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reviews */}
        {theme.showReviews && reviews.length > 0 && (
          <div style={{ padding: "30px 0", borderTop: "1px solid #1e1e2e" }}>
            <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: pc, textTransform: "uppercase", textAlign: "center", marginBottom: 24 }}>What Our Clients Say</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
              {reviews.map((r) => (
                <div key={r.id} style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 10, padding: 16 }}>
                  <div style={{ color: "#ffcc00", fontSize: 14, marginBottom: 6 }}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</div>
                  <p style={{ fontSize: 12, color: "#aaa", fontStyle: "italic", marginBottom: 6 }}>&ldquo;{r.review_text?.slice(0, 120)}{r.review_text?.length > 120 ? "..." : ""}&rdquo;</p>
                  <div style={{ fontSize: 11, color: "#666" }}>— {r.client_name}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Work Order Form */}
        {orgId && <WorkOrderForm orgId={orgId} primaryColor={pc} />}

        {/* Contact */}
        <div style={{ padding: "40px 0", borderTop: "1px solid #1e1e2e", textAlign: "center" }}>
          <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: pc, textTransform: "uppercase", marginBottom: 16 }}>Get in Touch</h2>
          <div style={{ fontSize: 14, color: "#888", lineHeight: 2 }}>
            {org.phone && <div>📞 <a href={`tel:${org.phone}`} style={{ color: pc, textDecoration: "none" }}>{org.phone}</a></div>}
            {org.email && <div>✉ <a href={`mailto:${org.email}`} style={{ color: pc, textDecoration: "none" }}>{org.email}</a></div>}
            {org.address && <div>📍 {org.address}</div>}
            {org.license_num && <div>License #{org.license_num}</div>}
          </div>
        </div>

        <div style={{ padding: "16px 0", borderTop: "1px solid #1e1e2e", textAlign: "center", fontSize: 10, color: "#555" }}>
          Powered by Creed App
        </div>
      </div>
    </div>
  );
}

export default function SitePage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0a0f" }} />}>
      <SitePageContent />
    </Suspense>
  );
}
