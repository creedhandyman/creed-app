"use client";
/**
 * Public digital business card. Lives at /card/[slug] using the same
 * site_slug as /s/[slug] and /lead/[slug] so contractors share one
 * URL prefix. Designed for in-the-wild handoffs:
 *   - QR code prominently displayed so the contractor can pull this
 *     page up on their phone and have a prospect scan it
 *   - Tap-to-call / tap-to-email / vCard download for native contacts
 *   - Quote-request CTA → /lead/[slug] (existing intake form)
 *   - Returning-customer portal link → /portal/login
 *
 * No auth, no tracking, no app shell — just the card.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { Phone, Mail, FileText, Home, Download, ScanLine } from "lucide-react";
import { db } from "@/lib/supabase";
import type { Organization } from "@/lib/types";

const PRIMARY = "#2E75B6";

interface SiteContent {
  headline?: string;
  subheadline?: string;
  services?: string[];
  whyUs?: string[];
  cta?: string;
  about?: string;
}

const DEFAULT_SERVICES = [
  "Repairs & maintenance",
  "Remodels & renovations",
  "Inspections & estimates",
];

/** Build a vCard 3.0 file from the org's branding fields. We use 3.0
 *  rather than 4.0 because iOS Contacts is more forgiving with it,
 *  and most other clients accept either. Fields are CRLF-delimited
 *  per RFC 2426. */
function buildVCard(org: Organization, cardUrl: string): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  lines.push(`FN:${org.name || ""}`);
  if (org.name) lines.push(`ORG:${org.name}`);
  if (org.phone) lines.push(`TEL;TYPE=WORK,VOICE:${org.phone}`);
  if (org.email) lines.push(`EMAIL;TYPE=WORK:${org.email}`);
  if (org.address) lines.push(`ADR;TYPE=WORK:;;${org.address.replace(/\r?\n/g, ", ")};;;;`);
  if (cardUrl) lines.push(`URL:${cardUrl}`);
  if (org.license_num) lines.push(`NOTE:License #${org.license_num}`);
  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

function downloadVCard(org: Organization, cardUrl: string) {
  const vcard = buildVCard(org, cardUrl);
  const blob = new Blob([vcard], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(org.name || "contact").replace(/[^a-z0-9]+/gi, "_")}.vcf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CardPageInner() {
  const { slug } = useParams<{ slug: string }>();
  const params = useSearchParams();
  // Tech-attribution: when this card was shared from a specific tech's
  // dashboard, the QR / share-link carries ?tech=<profile.id>. Persist
  // it for the whole session so any lead the visitor submits later
  // (even after navigating to /lead/<slug>) credits the right tech.
  const techParam = params.get("tech") || "";

  const [org, setOrg] = useState<Organization | null>(null);
  const [content, setContent] = useState<SiteContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [cardUrl, setCardUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      // The QR encodes the canonical card URL — keep ?tech= in there so
      // someone scanning the contractor's phone screen still attributes
      // back to the contractor / tech displaying it.
      const search = techParam ? `?tech=${encodeURIComponent(techParam)}` : "";
      setCardUrl(window.location.origin + window.location.pathname + search);
      // Persist the tech id so the /lead/<slug> page can read it from
      // sessionStorage if the visitor opens that page directly without
      // a tech param in its URL.
      if (techParam) {
        try { sessionStorage.setItem("c_lead_tech", techParam); } catch { /* */ }
      }
    }
  }, [techParam]);

  useEffect(() => {
    if (!slug) { setLoading(false); return; }
    db.get<Organization>("organizations", { site_slug: slug }).then((orgs) => {
      if (orgs.length) {
        const o = orgs[0];
        setOrg(o);
        try { if (o.site_content) setContent(JSON.parse(o.site_content)); } catch { /* */ }
      }
      setLoading(false);
    });
  }, [slug]);

  // Pull a services list out of site_content if present, else fall back
  // to the licensed_trades list, else a generic 3-bullet default.
  const services = useMemo<string[]>(() => {
    if (content?.services?.length) return content.services.slice(0, 6);
    if (org?.licensed_trades) {
      try {
        const trades = JSON.parse(org.licensed_trades) as string[];
        if (Array.isArray(trades) && trades.length) return trades.slice(0, 6);
      } catch { /* */ }
    }
    return DEFAULT_SERVICES;
  }, [content, org]);

  const cityFromAddress = useMemo(() => {
    if (!org?.address) return "";
    // Address strings usually look like "1234 Main St, City, ST 12345".
    // Pull the second comma-separated token if there are at least two.
    const parts = org.address.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return parts[1];
    return parts[0] || "";
  }, [org]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: PRIMARY, fontFamily: "Oswald, sans-serif", fontSize: 18 }}>Loading…</div>
      </div>
    );
  }

  if (!org) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f, #0d1530)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔗</div>
          <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: "#C00000" }}>Card not found</h1>
          <p style={{ color: "#888", fontSize: 13, marginTop: 8 }}>This contractor card link may be invalid or the slug has changed.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f, #0d1530)", color: "#e2e2e8", padding: "24px 16px 60px" }}>
      <div style={{ maxWidth: 460, margin: "0 auto" }}>
        {/* Identity */}
        <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 16, padding: "26px 22px", textAlign: "center", marginBottom: 14 }}>
          {org.logo_url && (
            <img
              src={org.logo_url}
              alt=""
              style={{ height: 84, width: 84, objectFit: "contain", borderRadius: 14, background: "#0a0a0f", padding: 8, margin: "0 auto 12px", display: "block", border: "1px solid #1e1e2e" }}
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          )}
          <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 26, color: PRIMARY, textTransform: "uppercase", letterSpacing: ".05em", margin: 0 }}>
            {org.name}
          </h1>
          {(content?.headline || cityFromAddress) && (
            <div style={{ fontSize: 13, color: "#aaa", marginTop: 6 }}>
              {content?.headline || `Serving ${cityFromAddress}`}
            </div>
          )}
          <div style={{ fontSize: 11, color: "#666", marginTop: 8, lineHeight: 1.6 }}>
            {org.license_num && <div>License #{org.license_num}</div>}
            {org.address && <div>{org.address}</div>}
          </div>
        </div>

        {/* Tap-to-call / tap-to-email row */}
        <div style={{ display: "grid", gridTemplateColumns: org.phone && org.email ? "1fr 1fr" : "1fr", gap: 8, marginBottom: 14 }}>
          {org.phone && (
            <a
              href={`tel:${org.phone}`}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "14px", borderRadius: 10,
                background: PRIMARY, color: "#fff",
                fontFamily: "Oswald, sans-serif", fontSize: 14, textTransform: "uppercase", letterSpacing: ".05em",
                textDecoration: "none",
              }}
            >
              <Phone size={16} strokeWidth={2} /> Call
            </a>
          )}
          {org.email && (
            <a
              href={`mailto:${org.email}`}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "14px", borderRadius: 10,
                background: "transparent", border: `1px solid ${PRIMARY}`,
                color: PRIMARY,
                fontFamily: "Oswald, sans-serif", fontSize: 14, textTransform: "uppercase", letterSpacing: ".05em",
                textDecoration: "none",
              }}
            >
              <Mail size={16} strokeWidth={2} /> Email
            </a>
          )}
        </div>

        {/* Services */}
        <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#888", fontFamily: "Oswald, sans-serif", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>
            Services
          </div>
          <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: 13, color: "#ccc", lineHeight: 1.6 }}>
            {services.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>

        {/* CTAs */}
        <a
          href={`/lead/${slug}${techParam ? `?tech=${encodeURIComponent(techParam)}` : ""}`}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "13px", borderRadius: 10, marginBottom: 8,
            background: PRIMARY, color: "#fff",
            fontFamily: "Oswald, sans-serif", fontSize: 14,
            textTransform: "uppercase", letterSpacing: ".05em",
            textDecoration: "none",
          }}
        >
          <FileText size={16} strokeWidth={2} /> Request a quote
        </a>
        <a
          href="/portal/login"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "13px", borderRadius: 10, marginBottom: 14,
            background: "transparent", border: "1px solid #1e1e2e",
            color: "#e2e2e8",
            fontFamily: "Oswald, sans-serif", fontSize: 14,
            textTransform: "uppercase", letterSpacing: ".05em",
            textDecoration: "none",
          }}
        >
          <Home size={16} strokeWidth={2} /> Customer portal sign-in
        </a>

        {/* QR */}
        {cardUrl && (
          <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 18, marginBottom: 14, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#888", fontFamily: "Oswald, sans-serif", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ScanLine size={13} strokeWidth={2} /> Scan to share
            </div>
            <div style={{ display: "inline-block", padding: 12, borderRadius: 10, background: "#fff" }}>
              <QRCodeSVG value={cardUrl} size={180} level="M" includeMargin={false} />
            </div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 10, wordBreak: "break-all" }}>
              {cardUrl}
            </div>
          </div>
        )}

        {/* vCard */}
        <button
          onClick={() => downloadVCard(org, cardUrl)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            width: "100%",
            padding: "12px", borderRadius: 10, marginBottom: 16,
            background: "transparent", border: "1px solid #1e1e2e",
            color: "#aaa",
            fontFamily: "Oswald, sans-serif", fontSize: 13,
            textTransform: "uppercase", letterSpacing: ".05em",
            cursor: "pointer",
          }}
        >
          <Download size={15} strokeWidth={2} /> Save contact (vCard)
        </button>

        <div style={{ textAlign: "center", color: "#555", fontSize: 10 }}>
          Powered by Creed App
        </div>
      </div>
    </div>
  );
}

export default function CardPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0a0f" }} />}>
      <CardPageInner />
    </Suspense>
  );
}
