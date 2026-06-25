"use client";
/**
 * Public digital business card. Lives at /card/[slug] using the same
 * site_slug as /s/[slug] and /lead/[slug] so contractors share one
 * URL prefix. Designed for in-the-wild handoffs:
 *   - Glowing identity hero (logo tile + gradient name + trust chips)
 *   - Tap-to-call / tap-to-email split, with a green-glow "Request a
 *     quote" as the hero action (the money move)
 *   - Services rendered as ROYGBIV trade-dot chips
 *   - QR code ("Scan to save my card") for the in-person handoff
 *   - vCard download + returning-customer portal link as quiet ghosts
 *
 * All content is the org's existing fields — name, logo, license,
 * address→city, plus an editable headline + services list stored in
 * `site_content` (Operations → Settings → Public card). No new schema.
 * No auth, no tracking, no app shell — just the card. Always dark
 * (matches the other public /s, /status, /lead pages).
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import {
  Phone, Mail, FileText, Download, ShieldCheck, BadgeCheck,
  Star, Hammer, ScanLine, UserRound, Zap,
} from "lucide-react";
import { db } from "@/lib/supabase";
import type { Organization, Review } from "@/lib/types";
import { isHex, shade, lighten, brandInk, rgba } from "@/lib/brand";

const BLUE = "#2E75B6";
const BLUE_SOFT = "#7fb6ff";

// ROYGBIV-ish trade palette — the services chips cycle these dots so the
// card echoes the app's trade colors. Order picked for visual contrast.
const TRADE_DOTS = ["#9d4edd", "#ff8800", "#2E75B6", "#00cc66", "#ffcc00", "#6a3de8", "#ff3d6e"];

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
  const [reviews, setReviews] = useState<Review[]>([]);
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
    db.get<Organization>("organizations", { site_slug: slug }).then(async (orgs) => {
      if (orgs.length) {
        const o = orgs[0];
        setOrg(o);
        try { if (o.site_content) setContent(JSON.parse(o.site_content)); } catch { /* */ }
        // Real review rating powers the ★ trust chip. Best-effort — the
        // reviews table is public-readable by org_id (same as /s/[slug]);
        // if it returns nothing the chip simply hides.
        try {
          const revs = await db.get<Review>("reviews", { org_id: o.id });
          setReviews(revs);
        } catch { /* no rating chip */ }
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

  // Average star rating across all reviews (one decimal), or 0 if none.
  const rating = useMemo(() => {
    if (!reviews.length) return 0;
    return reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length;
  }, [reviews]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: BLUE, fontFamily: "Oswald, sans-serif", fontSize: 20 }}>Loading…</div>
      </div>
    );
  }

  if (!org) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f, #0d1530)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔗</div>
          <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: "#C00000" }}>Card not found</h1>
          <p style={{ color: "#888", fontSize: 15, marginTop: 8 }}>This contractor card link may be invalid or the slug has changed.</p>
        </div>
      </div>
    );
  }

  // Brand color (falls back to the default blue for orgs that haven't picked).
  const brand = isHex(org.brand_color) ? org.brand_color : BLUE;
  const brand2 = isHex(org.brand_color_2) ? org.brand_color_2 : shade(brand, 40);
  const bInk = brandInk(brand);
  const bGrad = `linear-gradient(135deg, ${brand}, ${brand2})`;
  const bName = `linear-gradient(90deg, ${lighten(brand, 80)}, ${lighten(brand, 24)})`;
  const bSoft = lighten(brand, 60);

  const tagline = content?.headline || (cityFromAddress ? `Serving ${cityFromAddress}` : "");
  const monogram = (org.name || "?").slice(0, 2).toUpperCase();

  // ── shared inline styles (the card is always dark) ──
  const sec: React.CSSProperties = {
    background: "#12121a", border: "1px solid #1e1e2e",
    borderRadius: 15, padding: 15, marginTop: 13,
  };
  const lbl: React.CSSProperties = {
    fontFamily: "Oswald, sans-serif", fontWeight: 600, fontSize: 12,
    letterSpacing: ".09em", textTransform: "uppercase", color: "#8a8a99",
    marginBottom: 11, display: "flex", alignItems: "center", gap: 6,
  };
  const tchip: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5,
    fontWeight: 600, padding: "4px 10px", borderRadius: 99,
    background: "#16161f", border: "1px solid #2a2a3a", color: "#cfd2da",
  };
  const ghost: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    width: "100%", marginTop: 11, padding: 13, borderRadius: 13,
    background: "transparent", border: "1px solid #2a2a3a", color: "#8a8a99",
    fontFamily: "Oswald, sans-serif", fontWeight: 600, fontSize: 14,
    letterSpacing: ".04em", textTransform: "uppercase", cursor: "pointer",
    textDecoration: "none",
  };

  return (
    <div style={{ position: "relative", minHeight: "100vh", background: "radial-gradient(1000px 520px at 50% -8%, #0d1530 0%, #0a0a0f 60%)", color: "#f1f2f6", padding: "8px 16px 60px", overflow: "hidden" }}>
      {/* Brand glow strip down the left edge */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 5, background: bGrad, boxShadow: `0 0 16px 0 ${rgba(brand, 0.6)}, 0 0 30px -2px ${rgba(brand, 0.5)}` }} />
      <div style={{ position: "relative", maxWidth: 440, margin: "0 auto" }}>

        {/* ── Identity hero ── */}
        <div style={{ position: "relative", textAlign: "center", padding: "30px 18px 18px" }}>
          {/* radial glow behind the logo */}
          <div style={{ position: "absolute", inset: 0, background: `radial-gradient(420px 200px at 50% -10%, ${rgba(brand, 0.35)}, transparent 70%)`, pointerEvents: "none" }} />
          <div style={{ position: "relative" }}>
            <div
              style={{
                width: 84, height: 84, borderRadius: 22, margin: "0 auto 12px",
                background: org.logo_url ? "#0a0a0f" : bGrad,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: 34, color: org.logo_url ? "#fff" : bInk,
                boxShadow: `0 0 30px -6px ${rgba(brand, 0.7)}, inset 0 1px 0 rgba(255,255,255,.18)`,
                border: `1px solid ${rgba(brand, 0.35)}`, overflow: "hidden",
              }}
            >
              {org.logo_url ? (
                <img
                  src={org.logo_url}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "contain", padding: 8 }}
                  onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                />
              ) : (
                monogram
              )}
            </div>
            <div
              style={{
                fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: 27,
                letterSpacing: ".04em", textTransform: "uppercase", lineHeight: 1.05,
                background: bName,
                WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
              }}
            >
              {org.name}
            </div>
            {tagline && <div style={{ fontSize: 14, color: "#b6bccb", marginTop: 5 }}>{tagline}</div>}

            {/* Trust chips */}
            {(org.license_num || rating > 0) && (
              <div style={{ display: "flex", justifyContent: "center", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                {org.license_num && (
                  <span style={{ ...tchip, color: "#7dffb8", borderColor: "rgba(0,204,102,.35)", background: "rgba(0,204,102,.1)" }}>
                    <ShieldCheck size={12} strokeWidth={2} /> Licensed &amp; insured
                  </span>
                )}
                {org.license_num && (
                  <span style={tchip}>
                    <BadgeCheck size={12} strokeWidth={2} /> Lic #{org.license_num}
                  </span>
                )}
                {rating > 0 && (
                  <span style={{ ...tchip, color: "#ffd76b", borderColor: "rgba(245,180,0,.4)", background: "rgba(245,180,0,.1)" }}>
                    <Star size={12} strokeWidth={2} fill="#ffd76b" /> {rating.toFixed(1)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Contact row ── */}
        {(org.phone || org.email) && (
          <div style={{ display: "grid", gridTemplateColumns: org.phone && org.email ? "1fr 1fr" : "1fr", gap: 9, marginTop: 6 }}>
            {org.phone && (
              <a
                href={`tel:${org.phone}`}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  padding: 14, borderRadius: 13, background: brand, color: bInk,
                  fontFamily: "Oswald, sans-serif", fontWeight: 600, fontSize: 15,
                  letterSpacing: ".04em", textTransform: "uppercase", textDecoration: "none",
                  boxShadow: `0 8px 20px -8px ${rgba(brand, 0.8)}`,
                }}
              >
                <Phone size={17} strokeWidth={2} /> Call
              </a>
            )}
            {org.email && (
              <a
                href={`mailto:${org.email}`}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  padding: 14, borderRadius: 13, background: "transparent",
                  border: `1.5px solid ${brand}`, color: bSoft,
                  fontFamily: "Oswald, sans-serif", fontWeight: 600, fontSize: 15,
                  letterSpacing: ".04em", textTransform: "uppercase", textDecoration: "none",
                }}
              >
                <Mail size={17} strokeWidth={2} /> Email
              </a>
            )}
          </div>
        )}

        {/* ── Primary CTA — the money action ── */}
        <a
          href={`/lead/${slug}${techParam ? `?tech=${encodeURIComponent(techParam)}` : ""}`}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
            width: "100%", marginTop: 11, padding: 15, borderRadius: 14,
            background: brand, border: `1.5px solid ${brand}`,
            color: bInk, boxShadow: `0 0 26px -4px ${rgba(brand, 0.6)}, inset 0 1px 0 rgba(255,255,255,.18)`,
            fontFamily: "Oswald, sans-serif", fontWeight: 600, fontSize: 16,
            letterSpacing: ".4px", textTransform: "uppercase", textDecoration: "none",
          }}
        >
          <FileText size={18} strokeWidth={2} /> Request a Quote
        </a>

        {/* ── Services ── */}
        <div style={sec}>
          <div style={lbl}><Hammer size={14} strokeWidth={2} color={BLUE_SOFT} /> Services</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {services.map((s, i) => (
              <span
                key={i}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13,
                  fontWeight: 500, padding: "7px 12px", borderRadius: 10,
                  background: "#16161f", border: "1px solid #2a2a3a",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: TRADE_DOTS[i % TRADE_DOTS.length] }} />
                {s}
              </span>
            ))}
          </div>
        </div>

        {/* ── QR ── */}
        {cardUrl && (
          <div style={{ ...sec, textAlign: "center" }}>
            <div style={{ ...lbl, justifyContent: "center" }}>
              <ScanLine size={14} strokeWidth={2} color={BLUE_SOFT} /> Scan to save my card
            </div>
            <div style={{ display: "inline-block", padding: 14, borderRadius: 16, background: "#fff", boxShadow: `0 0 30px -8px ${rgba(brand, 0.5)}` }}>
              <QRCodeSVG value={cardUrl} size={160} level="M" includeMargin={false} />
            </div>
            <div style={{ fontSize: 12, color: "#666", marginTop: 11, wordBreak: "break-all" }}>{cardUrl}</div>
          </div>
        )}

        {/* ── Quiet ghost actions ── */}
        <button type="button" onClick={() => downloadVCard(org, cardUrl)} style={ghost}>
          <Download size={15} strokeWidth={2} /> Save Contact (vCard)
        </button>
        <a href="/portal/login" style={ghost}>
          <UserRound size={15} strokeWidth={2} /> Customer Portal Sign-in
        </a>

        <div style={{ textAlign: "center", color: "#666", fontSize: 12, marginTop: 18, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
          <Zap size={12} strokeWidth={2} /> Powered by Creed
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
