"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { db } from "@/lib/supabase";
import type { Organization, Review } from "@/lib/types";

interface SiteContent {
  headline: string;
  subheadline: string;
  services: string[];
  whyUs: string[];
  cta: string;
  about: string;
}

export default function SlugSitePage() {
  const { slug } = useParams<{ slug: string }>();

  const [org, setOrg] = useState<Organization | null>(null);
  const [content, setContent] = useState<SiteContent | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) { setLoading(false); return; }
    // Look up org by slug
    db.get<Organization>("organizations", { site_slug: slug }).then(async (orgs) => {
      if (!orgs.length) { setLoading(false); return; }
      const o = orgs[0];
      setOrg(o);
      try {
        if (o.site_content) setContent(JSON.parse(o.site_content));
      } catch { /* */ }
      const revs = await db.get<Review>("reviews", { org_id: o.id });
      setReviews(revs.filter((r) => r.rating >= 4).slice(0, 6));
      setLoading(false);
    });
  }, [slug]);

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

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e2e2e8" }}>
      {/* Hero */}
      <div style={{
        background: "linear-gradient(135deg, #0d1530 0%, #0a0a0f 50%, #0d1020 100%)",
        padding: "60px 20px 50px", textAlign: "center",
      }}>
        {org.logo_url && (
          <img src={org.logo_url} alt="" style={{ height: 70, display: "block", margin: "0 auto 16px" }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
        )}
        <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 36, color: "#2E75B6", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>
          {org.name}
        </h1>
        <p style={{ fontSize: 20, color: "#fff", maxWidth: 600, margin: "0 auto 12px", fontFamily: "Source Sans 3, sans-serif" }}>
          {content.headline}
        </p>
        <p style={{ fontSize: 14, color: "#888", maxWidth: 500, margin: "0 auto 24px" }}>
          {content.subheadline}
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          {org.phone && (
            <a href={`tel:${org.phone}`} style={{
              padding: "12px 28px", borderRadius: 8, fontSize: 16, fontFamily: "Oswald, sans-serif",
              textTransform: "uppercase", background: "#2E75B6", color: "#fff", textDecoration: "none",
            }}>
              📞 Call Now
            </a>
          )}
          <a href={`/review?org=${org.id}`} style={{
            padding: "12px 28px", borderRadius: 8, fontSize: 16, fontFamily: "Oswald, sans-serif",
            textTransform: "uppercase", background: "transparent", color: "#2E75B6", textDecoration: "none",
            border: "1px solid #2E75B6",
          }}>
            ⭐ Leave a Review
          </a>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 20px" }}>
        {/* Services */}
        <div style={{ padding: "40px 0" }}>
          <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: "#2E75B6", textTransform: "uppercase", textAlign: "center", marginBottom: 24 }}>
            Our Services
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {content.services.map((s, i) => (
              <div key={i} style={{
                background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 10,
                padding: "16px", textAlign: "center", fontSize: 14,
              }}>
                {s}
              </div>
            ))}
          </div>
        </div>

        {/* Why Us */}
        <div style={{ padding: "30px 0", borderTop: "1px solid #1e1e2e" }}>
          <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: "#2E75B6", textTransform: "uppercase", textAlign: "center", marginBottom: 24 }}>
            {content.cta || "Why Choose Us"}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {content.whyUs.map((w, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                <span style={{ color: "#00cc66", fontSize: 16, flexShrink: 0 }}>✓</span>
                <span>{w}</span>
              </div>
            ))}
          </div>
        </div>

        {/* About */}
        {content.about && (
          <div style={{ padding: "30px 0", borderTop: "1px solid #1e1e2e", textAlign: "center" }}>
            <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: "#2E75B6", textTransform: "uppercase", marginBottom: 12 }}>
              About Us
            </h2>
            <p style={{ fontSize: 14, color: "#aaa", maxWidth: 600, margin: "0 auto", lineHeight: 1.6 }}>
              {content.about}
            </p>
          </div>
        )}

        {/* Reviews */}
        {reviews.length > 0 && (
          <div style={{ padding: "30px 0", borderTop: "1px solid #1e1e2e" }}>
            <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: "#2E75B6", textTransform: "uppercase", textAlign: "center", marginBottom: 24 }}>
              What Our Clients Say
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
              {reviews.map((r) => (
                <div key={r.id} style={{
                  background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 10, padding: 16,
                }}>
                  <div style={{ color: "#ffcc00", fontSize: 14, marginBottom: 6 }}>
                    {"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}
                  </div>
                  <p style={{ fontSize: 12, color: "#aaa", fontStyle: "italic", marginBottom: 6 }}>
                    &ldquo;{r.review_text?.slice(0, 120)}{r.review_text?.length > 120 ? "..." : ""}&rdquo;
                  </p>
                  <div style={{ fontSize: 11, color: "#666" }}>— {r.client_name}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Contact */}
        <div style={{ padding: "40px 0", borderTop: "1px solid #1e1e2e", textAlign: "center" }}>
          <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: "#2E75B6", textTransform: "uppercase", marginBottom: 16 }}>
            Get in Touch
          </h2>
          <div style={{ fontSize: 14, color: "#888", lineHeight: 2 }}>
            {org.phone && <div>📞 <a href={`tel:${org.phone}`} style={{ color: "#2E75B6", textDecoration: "none" }}>{org.phone}</a></div>}
            {org.email && <div>✉ <a href={`mailto:${org.email}`} style={{ color: "#2E75B6", textDecoration: "none" }}>{org.email}</a></div>}
            {org.address && <div>📍 {org.address}</div>}
            {org.license_num && <div>License #{org.license_num}</div>}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 0", borderTop: "1px solid #1e1e2e", textAlign: "center", fontSize: 10, color: "#555" }}>
          Powered by Creed App
        </div>
      </div>
    </div>
  );
}
