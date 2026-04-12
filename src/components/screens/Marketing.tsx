"use client";
import { useState, useRef, useEffect } from "react";
import { useStore } from "@/lib/store";
import { db, supabase } from "@/lib/supabase";

interface GalleryPhoto {
  url: string;
  caption: string;
}

interface SiteTheme {
  primaryColor: string;
  showGallery: boolean;
  showReviews: boolean;
  showAbout: boolean;
  showServices: boolean;
  showWhyUs: boolean;
}

const DEFAULT_THEME: SiteTheme = {
  primaryColor: "#2E75B6",
  showGallery: true,
  showReviews: true,
  showAbout: true,
  showServices: true,
  showWhyUs: true,
};

const COLOR_PRESETS = [
  { label: "Blue", value: "#2E75B6" },
  { label: "Red", value: "#C00000" },
  { label: "Green", value: "#1B8C3A" },
  { label: "Orange", value: "#D4760A" },
  { label: "Purple", value: "#7B3FAD" },
  { label: "Teal", value: "#0E8585" },
];

export default function Marketing() {
  const user = useStore((s) => s.user)!;
  const org = useStore((s) => s.org);
  const reviews = useStore((s) => s.reviews);
  const darkMode = useStore((s) => s.darkMode);

  const [step, setStep] = useState<"overview" | "survey" | "generating">(
    org?.site_content ? "overview" : "survey"
  );
  const [generating, setGenerating] = useState(false);

  // Survey fields
  const [svcDesc, setSvcDesc] = useState("");
  const [serviceArea, setServiceArea] = useState(org?.address || "");
  const [specialties, setSpecialties] = useState("");
  const [yearsExp, setYearsExp] = useState("");
  const [targetClient, setTargetClient] = useState("");
  const [uniqueSell, setUniqueSell] = useState("");

  // Slug
  const [slug, setSlug] = useState(org?.site_slug || "");
  const [slugSaving, setSlugSaving] = useState(false);

  // Gallery
  const galleryInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const photos: GalleryPhoto[] = (() => {
    try { return org?.gallery_photos ? JSON.parse(org.gallery_photos) : []; }
    catch { return []; }
  })();

  // Theme
  const theme: SiteTheme = (() => {
    try { return org?.site_theme ? { ...DEFAULT_THEME, ...JSON.parse(org.site_theme) } : DEFAULT_THEME; }
    catch { return DEFAULT_THEME; }
  })();
  const [localTheme, setLocalTheme] = useState(theme);
  const [themeDirty, setThemeDirty] = useState(false);

  // Editing captions
  const [editingCaption, setEditingCaption] = useState<number | null>(null);
  const [captionText, setCaptionText] = useState("");

  // AI tips
  const [tips, setTips] = useState<string[]>([]);
  const [tipsLoading, setTipsLoading] = useState(false);

  const baseUrl = "https://creedhm.com";
  const siteUrl = org?.site_slug
    ? `${baseUrl}/s/${org.site_slug}`
    : `${baseUrl}/site?org=${org?.id}`;
  const reviewUrl = `${baseUrl}/review?org=${org?.id}`;

  const refreshOrg = async () => {
    const orgs = await db.get("organizations", { id: org!.id });
    if (orgs.length) useStore.getState().setOrg(orgs[0] as never);
  };

  const saveSlug = async () => {
    const clean = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!clean) { alert("Enter a valid slug"); return; }
    setSlugSaving(true);
    const existing = await db.get("organizations", { site_slug: clean });
    if (existing.length && existing[0].id !== org!.id) {
      alert(`"${clean}" is already taken — try another`);
      setSlugSaving(false);
      return;
    }
    await db.patch("organizations", org!.id, { site_slug: clean });
    setSlug(clean);
    await refreshOrg();
    setSlugSaving(false);
  };

  // Gallery upload
  const uploadPhotos = async (files: FileList) => {
    setUploading(true);
    const updated = [...photos];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split(".").pop() || "jpg";
      const path = `gallery/${org!.id}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const { error } = await supabase.storage.from("receipts").upload(path, file);
      if (error) { console.error(error); continue; }
      const { data } = supabase.storage.from("receipts").getPublicUrl(path);
      if (data?.publicUrl) updated.push({ url: data.publicUrl, caption: "" });
    }
    await db.patch("organizations", org!.id, { gallery_photos: JSON.stringify(updated) });
    await refreshOrg();
    setUploading(false);
  };

  const deletePhoto = async (idx: number) => {
    if (!confirm("Remove this photo?")) return;
    const updated = photos.filter((_, i) => i !== idx);
    await db.patch("organizations", org!.id, { gallery_photos: JSON.stringify(updated) });
    await refreshOrg();
  };

  const saveCaption = async (idx: number) => {
    const updated = [...photos];
    updated[idx] = { ...updated[idx], caption: captionText };
    await db.patch("organizations", org!.id, { gallery_photos: JSON.stringify(updated) });
    await refreshOrg();
    setEditingCaption(null);
  };

  // Theme save
  const saveTheme = async () => {
    await db.patch("organizations", org!.id, { site_theme: JSON.stringify(localTheme) });
    await refreshOrg();
    setThemeDirty(false);
  };

  const updateTheme = (key: keyof SiteTheme, value: string | boolean) => {
    setLocalTheme((t) => ({ ...t, [key]: value }));
    setThemeDirty(true);
  };

  const jobs = useStore((s) => s.jobs);

  const loadTips = async () => {
    setTipsLoading(true);
    try {
      const completedJobs = jobs.filter((j) => ["complete", "invoiced", "paid"].includes(j.status)).length;
      const totalJobs = jobs.length;
      const avgRating = reviews.length ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1) : "none";
      const hasWebsite = !!org?.site_content;
      const hasGallery = photos.length > 0;
      const hasSlug = !!org?.site_slug;

      const prompt = `You are a marketing coach for a small field service contractor. Give exactly 5 short, specific, actionable marketing tips. Each tip should be 1-2 sentences max. Use an emoji at the start of each tip.

Business context:
- Business: ${org?.name || "Service business"} in ${org?.address || "unknown area"}
- Website: ${hasWebsite ? (hasSlug ? `Live at creedhm.com/s/${org?.site_slug}` : "Live but no custom URL") : "Not created yet"}
- Reviews: ${reviews.length} total, average ${avgRating} stars
- Jobs: ${totalJobs} total, ${completedJobs} completed
- Gallery photos: ${photos.length}
- Phone: ${org?.phone ? "Yes" : "No"}

Give tips they haven't heard before. Be specific to their situation — if they have few reviews, focus on getting more. If they have no gallery photos, suggest adding some. If they have a website, suggest ways to promote it. Mix digital and offline tactics. Make each tip feel like advice from a friend who knows marketing, not a textbook.

Return ONLY the 5 tips, one per line. No numbering, no headers.`;

      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 500,
          messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        }),
      });
      const data = await res.json();
      const text = data.content?.[0]?.text || "";
      const lines = text.split("\n").filter((l: string) => l.trim().length > 5).slice(0, 5);
      if (lines.length) setTips(lines);
    } catch (e) {
      console.error(e);
    }
    setTipsLoading(false);
  };

  // Auto-load tips on first visit to overview
  useEffect(() => {
    if (step === "overview" && org?.site_content && tips.length === 0 && !tipsLoading) {
      loadTips();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const generateSite = async () => {
    if (!svcDesc.trim()) { alert("Describe your services"); return; }
    setGenerating(true);
    setStep("generating");

    try {
      const prompt = `Generate website copy for a field service business. Return ONLY valid JSON.

Business: ${org?.name || "Service Business"}
Location: ${serviceArea || org?.address || ""}
Services: ${svcDesc}
Specialties: ${specialties || "General services"}
Experience: ${yearsExp || "Experienced"} years
Target clients: ${targetClient || "Homeowners and property managers"}
What makes them different: ${uniqueSell || "Quality work at fair prices"}
Phone: ${org?.phone || ""}
${reviews.length > 0 ? `They have ${reviews.length} reviews, avg ${(reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1)} stars.` : ""}

Return this JSON format:
{
  "headline": "Bold, compelling headline (8-12 words)",
  "subheadline": "Supporting text that builds trust (15-25 words)",
  "services": ["Service 1", "Service 2", "Service 3", "Service 4", "Service 5", "Service 6"],
  "whyUs": ["Reason 1 (short sentence)", "Reason 2", "Reason 3", "Reason 4", "Reason 5", "Reason 6"],
  "cta": "Why Choose Us section title",
  "about": "2-3 sentence about paragraph that builds trust and credibility"
}`;

      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        }),
      });

      const data = await res.json();
      const text = data.content?.[0]?.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const content = jsonMatch[0];
        await db.patch("organizations", org!.id, { site_content: content, site_published: true });
        await refreshOrg();
        setStep("overview");
      } else {
        alert("AI generation failed — try again");
        setStep("survey");
      }
    } catch (e) {
      console.error(e);
      alert("Failed to generate site content");
      setStep("survey");
    }
    setGenerating(false);
  };

  // ── OVERVIEW ──
  if (step === "overview" && org?.site_content) {
    return (
      <div className="fi">
        <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 14 }}>📣 Marketing</h2>

        {/* Site status */}
        <div className="cd mb" style={{ borderLeft: "3px solid var(--color-success)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h4 style={{ fontSize: 14, color: "var(--color-success)" }}>🌐 Your Site is Live</h4>
              <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>Share this link with clients — it&apos;s your website</div>
            </div>
            <span style={{ fontSize: 13, padding: "2px 8px", borderRadius: 10, background: "var(--color-success)" + "22", color: "var(--color-success)" }}>Published</span>
          </div>
          <div style={{ marginTop: 8, padding: 8, background: darkMode ? "#1a1a28" : "#f5f5f8", borderRadius: 6, fontSize: 13, wordBreak: "break-all", color: "var(--color-primary)" }}>
            {siteUrl}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="bb" onClick={() => { navigator.clipboard.writeText(siteUrl); alert("Site link copied!"); }} style={{ fontSize: 12, padding: "5px 12px" }}>
              📋 Copy Link
            </button>
            <button className="bo" onClick={() => window.open(siteUrl, "_blank")} style={{ fontSize: 12, padding: "5px 12px" }}>
              👁 Preview
            </button>
            <button className="bo" onClick={() => setStep("survey")} style={{ fontSize: 12, padding: "5px 12px" }}>
              ✏️ Regenerate
            </button>
          </div>

          {/* Custom slug */}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}` }}>
            <label className="sl" style={{ fontSize: 12, marginBottom: 4, display: "block" }}>Custom URL</label>
            <div className="row">
              <span className="dim" style={{ fontSize: 13, whiteSpace: "nowrap" }}>creedhm.com/s/</span>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                placeholder="your-business-name"
                style={{ flex: 1, fontSize: 12 }}
              />
              <button
                className="bb"
                onClick={saveSlug}
                disabled={slugSaving || !slug.trim()}
                style={{ fontSize: 12, padding: "5px 12px" }}
              >
                {slugSaving ? "..." : org?.site_slug ? "Update" : "Save"}
              </button>
            </div>
          </div>
        </div>

        {/* ── GALLERY ── */}
        <div className="cd mb">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h4 style={{ fontSize: 14 }}>📸 Work Gallery</h4>
            <button
              className="bb"
              onClick={() => galleryInput.current?.click()}
              disabled={uploading}
              style={{ fontSize: 12, padding: "4px 12px" }}
            >
              {uploading ? "Uploading..." : "+ Add Photos"}
            </button>
            <input
              ref={galleryInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => e.target.files?.length && uploadPhotos(e.target.files)}
            />
          </div>

          {photos.length === 0 ? (
            <div style={{ textAlign: "center", padding: 20, color: "#888", fontSize: 12 }}>
              No photos yet — upload completed work to show on your site
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {photos.map((p, i) => (
                <div key={i} style={{ position: "relative" }}>
                  <img
                    src={p.url}
                    alt={p.caption || ""}
                    style={{
                      width: "100%", aspectRatio: "1", objectFit: "cover",
                      borderRadius: 8, border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`,
                    }}
                  />
                  {/* Delete */}
                  <button
                    onClick={() => deletePhoto(i)}
                    style={{
                      position: "absolute", top: 4, right: 4,
                      background: "rgba(0,0,0,.7)", color: "#fff",
                      border: "none", borderRadius: "50%", width: 20, height: 20,
                      fontSize: 13, cursor: "pointer", display: "flex",
                      alignItems: "center", justifyContent: "center",
                    }}
                  >
                    ✕
                  </button>
                  {/* Caption */}
                  {editingCaption === i ? (
                    <div style={{ marginTop: 4 }}>
                      <input
                        value={captionText}
                        onChange={(e) => setCaptionText(e.target.value)}
                        placeholder="Caption..."
                        style={{ fontSize: 12, width: "100%", padding: 4 }}
                        onKeyDown={(e) => e.key === "Enter" && saveCaption(i)}
                        autoFocus
                      />
                      <div className="row" style={{ marginTop: 2 }}>
                        <button className="bb" onClick={() => saveCaption(i)} style={{ fontSize: 13, padding: "2px 6px" }}>Save</button>
                        <button className="bo" onClick={() => setEditingCaption(null)} style={{ fontSize: 13, padding: "2px 6px" }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => { setEditingCaption(i); setCaptionText(p.caption || ""); }}
                      style={{
                        fontSize: 12, color: p.caption ? (darkMode ? "#aaa" : "#555") : "#888",
                        marginTop: 3, cursor: "pointer", textAlign: "center",
                        fontStyle: p.caption ? "normal" : "italic",
                      }}
                    >
                      {p.caption || "Add caption"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── CUSTOMIZE SITE ── */}
        <div className="cd mb">
          <h4 style={{ fontSize: 14, marginBottom: 12 }}>🎨 Customize Site</h4>

          {/* Color */}
          <label className="sl" style={{ fontSize: 12, display: "block", marginBottom: 6 }}>Accent Color</label>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
            {COLOR_PRESETS.map((c) => (
              <button
                key={c.value}
                onClick={() => updateTheme("primaryColor", c.value)}
                style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: c.value,
                  border: localTheme.primaryColor === c.value ? "2px solid #fff" : "2px solid transparent",
                  cursor: "pointer",
                  boxShadow: localTheme.primaryColor === c.value ? `0 0 0 2px ${c.value}` : "none",
                  flexShrink: 0,
                }}
                title={c.label}
              />
            ))}
            <input
              type="color"
              value={localTheme.primaryColor}
              onChange={(e) => updateTheme("primaryColor", e.target.value)}
              style={{ width: 28, height: 28, borderRadius: "50%", cursor: "pointer", border: "none", padding: 0, flexShrink: 0 }}
              title="Custom color"
            />
          </div>

          {/* Section toggles */}
          <label className="sl" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>Sections</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
            {([
              ["showServices", "Services"],
              ["showWhyUs", "Why Choose Us"],
              ["showAbout", "About Us"],
              ["showGallery", "Photo Gallery"],
              ["showReviews", "Client Reviews"],
            ] as [keyof SiteTheme, string][]).map(([key, label]) => (
              <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={localTheme[key] as boolean}
                  onChange={(e) => updateTheme(key, e.target.checked)}
                  style={{ accentColor: localTheme.primaryColor }}
                />
                {label}
              </label>
            ))}
          </div>

          {themeDirty && (
            <button className="bb" onClick={saveTheme} style={{ marginTop: 10, fontSize: 13, padding: "6px 16px", width: "100%" }}>
              Save Changes
            </button>
          )}
        </div>

        {/* Quick links */}
        <div className="g2 mb">
          <div className="cd" style={{ cursor: "pointer" }} onClick={() => { navigator.clipboard.writeText(reviewUrl); alert("Review link copied!"); }}>
            <h4 style={{ fontSize: 13, color: "var(--color-highlight)" }}>⭐ Review Link</h4>
            <div className="dim" style={{ fontSize: 10 }}>Send to clients after jobs</div>
          </div>
          <div className="cd">
            <h4 style={{ fontSize: 13 }}>📊 Stats</h4>
            <div className="dim" style={{ fontSize: 10 }}>{reviews.length} reviews · {reviews.filter((r) => r.rating === 5).length} five-star</div>
          </div>
        </div>

        {/* AI Tips */}
        <div className="cd">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h4 style={{ fontSize: 13 }}>💡 AI Marketing Coach</h4>
            <button
              className="bo"
              onClick={loadTips}
              disabled={tipsLoading}
              style={{ fontSize: 12, padding: "3px 10px" }}
            >
              {tipsLoading ? "Thinking..." : "🔄 New Tips"}
            </button>
          </div>
          {tips.length > 0 ? (
            <div style={{ fontSize: 13, lineHeight: 1.9 }}>
              {tips.map((tip, i) => (
                <div key={i} style={{ marginBottom: 6 }}>{tip}</div>
              ))}
            </div>
          ) : tipsLoading ? (
            <div className="dim" style={{ textAlign: "center", padding: 16, fontSize: 13 }}>
              Analyzing your business and generating personalized tips...
            </div>
          ) : (
            <div className="dim" style={{ textAlign: "center", padding: 12, fontSize: 13 }}>
              Tap &quot;New Tips&quot; for AI-powered marketing advice tailored to your business
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── GENERATING ──
  if (step === "generating") {
    return (
      <div className="fi">
        <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 14 }}>📣 Marketing</h2>
        <div className="cd" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 12, animation: "pulse 1.5s ease-in-out infinite" }}>🤖</div>
          <style>{`@keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.1); } }`}</style>
          <h3 style={{ color: "var(--color-primary)", fontSize: 16, marginBottom: 8 }}>Building Your Website</h3>
          <div className="dim" style={{ fontSize: 12 }}>AI is writing your headline, services, and marketing copy...</div>
        </div>
      </div>
    );
  }

  // ── SURVEY ──
  return (
    <div className="fi">
      <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 14 }}>📣 Marketing</h2>

      <div className="cd mb">
        <h4 style={{ fontSize: 14, marginBottom: 4 }}>🌐 Build Your Website</h4>
        <div className="dim" style={{ fontSize: 13, marginBottom: 12 }}>Answer a few questions and AI will create a professional landing page for your business.</div>

        <div style={{ marginBottom: 10 }}>
          <label className="sl">What services do you offer? *</label>
          <textarea
            value={svcDesc}
            onChange={(e) => setSvcDesc(e.target.value)}
            placeholder="e.g. General repairs, plumbing, electrical, painting, flooring installation, property maintenance..."
            style={{ height: 70, marginTop: 4 }}
          />
        </div>

        <div className="g2" style={{ marginBottom: 10 }}>
          <div>
            <label className="sl">Service area</label>
            <input value={serviceArea} onChange={(e) => setServiceArea(e.target.value)} placeholder="e.g. Wichita, KS and surrounding" style={{ marginTop: 4 }} />
          </div>
          <div>
            <label className="sl">Years of experience</label>
            <input value={yearsExp} onChange={(e) => setYearsExp(e.target.value)} placeholder="e.g. 10" style={{ marginTop: 4 }} />
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label className="sl">Specialties</label>
          <input value={specialties} onChange={(e) => setSpecialties(e.target.value)} placeholder="e.g. Make-ready turns, kitchen remodels, property management" style={{ marginTop: 4 }} />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label className="sl">Who are your ideal clients?</label>
          <input value={targetClient} onChange={(e) => setTargetClient(e.target.value)} placeholder="e.g. Property managers, landlords, homeowners" style={{ marginTop: 4 }} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label className="sl">What makes you different?</label>
          <input value={uniqueSell} onChange={(e) => setUniqueSell(e.target.value)} placeholder="e.g. Same-day response, licensed and insured, no job too small" style={{ marginTop: 4 }} />
        </div>

        <button
          className="bb"
          onClick={generateSite}
          disabled={generating || !svcDesc.trim()}
          style={{ width: "100%", padding: 14, fontSize: 16, opacity: svcDesc.trim() ? 1 : 0.5 }}
        >
          🤖 Generate My Website
        </button>
      </div>
    </div>
  );
}
