"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { db, supabase } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";
import type { Organization } from "@/lib/types";

/**
 * Branding & Business Info — logo upload + the org's name/phone/email/
 * address/license number + the public URL slug. Org-level config;
 * admin-only. Lives in Operations → Settings.
 */
export default function BrandingSettings() {
  const user = useStore((s) => s.user)!;
  const org = useStore((s) => s.org);
  const setOrg = useStore((s) => s.setOrg);
  const loadAll = useStore((s) => s.loadAll);
  const isOwner = user.role === "owner" || user.role === "manager";
  const [uploading, setUploading] = useState(false);
  // Bumps when we successfully save a new logo so the inline preview
  // refetches the URL even though Supabase served it cached before.
  const [logoBust, setLogoBust] = useState(0);
  // Slug edit — mirrors onboarding's validation so a slug picked here
  // can't conflict with one picked there.
  const [slugDraft, setSlugDraft] = useState(org?.site_slug || "");
  const [savingSlug, setSavingSlug] = useState(false);

  // Keep the slug draft in sync if the org reloads from elsewhere (e.g.
  // after an onboarding edit, refresh, or another tab).
  useEffect(() => {
    setSlugDraft(org?.site_slug || "");
  }, [org?.site_slug]);

  // Public-card content — headline (tagline) + services list. Both live in
  // the org's `site_content` JSON (shared with the marketing site); the
  // /card/[slug] page reads them. Drafts resync if the org reloads.
  const [headlineDraft, setHeadlineDraft] = useState("");
  const [servicesDraft, setServicesDraft] = useState("");
  useEffect(() => {
    let c: { headline?: string; services?: string[] } = {};
    try { c = org?.site_content ? JSON.parse(org.site_content) : {}; } catch { /* */ }
    setHeadlineDraft(c.headline || "");
    setServicesDraft(Array.isArray(c.services) ? c.services.join("\n") : "");
  }, [org?.site_content]);

  if (!isOwner || !org) return null;

  const refreshOrg = async () => {
    const orgs = await db.get<Organization>("organizations", { id: org.id });
    if (orgs.length) setOrg(orgs[0]);
  };

  // Merge a patch into the org's site_content JSON without clobbering the
  // marketing-site fields (whyUs / about / cta / etc.) that live alongside.
  const saveCardContent = async (patch: { headline?: string; services?: string[] }) => {
    let current: Record<string, unknown> = {};
    try { current = org.site_content ? JSON.parse(org.site_content) : {}; } catch { /* */ }
    await db.patch("organizations", org.id, { site_content: JSON.stringify({ ...current, ...patch }) });
    await refreshOrg();
  };

  const normalizeSlug = (raw: string) =>
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

  const saveSlug = async () => {
    const normalized = normalizeSlug(slugDraft);
    if (normalized === (org.site_slug || "")) {
      // No change — but if the user typed garbage that normalized to the
      // same value, reflect that back so they see what actually saved.
      setSlugDraft(normalized);
      return;
    }
    if (!normalized) {
      useStore.getState().showToast("Pick a URL slug", "error");
      setSlugDraft(org.site_slug || "");
      return;
    }
    if (normalized.length < 3 || normalized.length > 32) {
      useStore.getState().showToast("Slug must be 3–32 characters", "error");
      setSlugDraft(org.site_slug || "");
      return;
    }
    setSavingSlug(true);
    try {
      // Uniqueness check — any other org claiming this slug blocks the save.
      const existing = await db.get<Organization>("organizations", { site_slug: normalized });
      const taken = existing.some((o) => o.id !== org.id);
      if (taken) {
        useStore.getState().showToast("That slug is taken, try another", "error");
        setSlugDraft(org.site_slug || "");
        return;
      }
      await db.patch("organizations", org.id, { site_slug: normalized });
      setSlugDraft(normalized);
      await refreshOrg();
      useStore.getState().showToast("Public URL updated", "success");
    } finally {
      setSavingSlug(false);
    }
  };

  const onLogoFile = async (file: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      // Timestamp the filename so every upload is a unique URL — avoids the
      // browser-cache "I uploaded a new logo but I still see the old one"
      // problem that comes with overwriting the same path.
      const path = `logos/${org.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("receipts")
        .upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (error) {
        useStore.getState().showToast("Upload failed: " + error.message, "error");
        return;
      }
      const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(path);
      await db.patch("organizations", org.id, { logo_url: urlData.publicUrl });
      await loadAll();
      await refreshOrg();
      setLogoBust(Date.now());
      useStore.getState().showToast("Logo updated", "success");
    } catch (err) {
      useStore
        .getState()
        .showToast("Logo upload error: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setUploading(false);
    }
  };

  // Cache-bust the inline preview so re-uploads show immediately.
  const previewSrc = org?.logo_url
    ? org.logo_url + (logoBust ? (org.logo_url.includes("?") ? "&" : "?") + "v=" + logoBust : "")
    : "/CREED_LOGO.png";

  return (
    <>
      {/* Logo — clicking the label opens the file picker (most reliable
          cross-browser pattern, including iOS Safari where programmatic
          .click() on a display:none input is flaky). */}
      <div className="cd mb" style={{ textAlign: "center", padding: 18 }}>
        <img
          src={previewSrc}
          alt="Logo"
          style={{
            height: 64,
            maxWidth: "100%",
            display: "block",
            margin: "0 auto 10px",
            borderRadius: 8,
            objectFit: "contain",
          }}
          onError={(e) => ((e.target as HTMLImageElement).src = "/CREED_LOGO.png")}
        />
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 16px",
            fontFamily: "Oswald, sans-serif",
            fontSize: 14,
            textTransform: "uppercase",
            letterSpacing: ".06em",
            border: "1px solid var(--color-border-dark)",
            borderRadius: 10,
            cursor: uploading ? "not-allowed" : "pointer",
            color: uploading ? "#888" : "var(--color-primary)",
            background: "transparent",
            opacity: uploading ? 0.6 : 1,
            transition: "all 200ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          <Icon name="camera" size={14} />
          {uploading ? "Uploading…" : org?.logo_url ? "Change Logo" : "Upload Logo"}
          <input
            type="file"
            accept="image/png, image/jpeg, image/webp, image/svg+xml"
            disabled={uploading}
            // Position off-screen instead of display:none so iOS Safari can
            // open the picker reliably when the label is tapped.
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              opacity: 0,
              overflow: "hidden",
              clipPath: "inset(50%)",
              pointerEvents: "none",
            }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onLogoFile(file);
              e.target.value = "";
            }}
          />
        </label>
        {org?.logo_url && (
          <button
            onClick={async () => {
              if (!await useStore.getState().showConfirm("Remove Logo", "Remove the logo? PDFs will fall back to the org name only."))
                return;
              await db.patch("organizations", org.id, { logo_url: null });
              await loadAll();
              await refreshOrg();
              setLogoBust(Date.now());
              useStore.getState().showToast("Logo removed", "success");
            }}
            style={{
              background: "none",
              color: "var(--color-accent-red)",
              fontSize: 13,
              padding: "6px 12px",
              marginLeft: 6,
              fontFamily: "Oswald, sans-serif",
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
          >
            Remove
          </button>
        )}
        <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>
          PNG, JPG, WEBP, or SVG · square or wide images work best
        </div>
      </div>

      {/* Editable business info */}
      <div className="cd mb">
        <h4
          style={{
            fontSize: 16,
            marginBottom: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="briefcase" size={16} color="var(--color-primary)" />
          {t("settings.businessInfo")}
        </h4>
        {[
          { label: "Business Name", field: "name", value: org.name },
          { label: "Phone", field: "phone", value: org.phone },
          { label: "Email", field: "email", value: org.email },
          { label: "Address", field: "address", value: org.address },
          { label: "License #", field: "license_num", value: org.license_num },
        ].map((f, i) => (
          <div key={f.field}>
            <div style={{ marginBottom: 6 }}>
              <label className="sl" style={{ fontSize: 14 }}>
                {f.label}
              </label>
              <input
                key={`${f.field}-${f.value}`}
                defaultValue={f.value || ""}
                onBlur={async (e) => {
                  const val = e.target.value.trim();
                  if (val !== (f.value || "")) {
                    await db.patch("organizations", org.id, { [f.field]: val });
                    await refreshOrg();
                    useStore.getState().showToast(`${f.label} updated`, "success");
                  }
                }}
                style={{ fontSize: 15 }}
              />
            </div>
            {/* Slug sits right under Business Name — it's the public-facing
                URL handle so it pairs with the business identity. */}
            {i === 0 && (
              <div style={{ marginBottom: 6 }}>
                <label className="sl" style={{ fontSize: 14 }}>
                  Public URL slug
                </label>
                <input
                  value={slugDraft}
                  onChange={(e) => setSlugDraft(e.target.value)}
                  onBlur={saveSlug}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  disabled={savingSlug}
                  placeholder="your-business"
                  style={{ fontSize: 15 }}
                />
                <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
                  Your card: www.creedhm.com/card/
                  <span style={{ color: "var(--color-primary)" }}>
                    {normalizeSlug(slugDraft) || "your-slug"}
                  </span>
                  {" · "}lowercase, letters/numbers/hyphens, 3–32 chars
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Public card content — headline + services shown on /card/[slug]. */}
      <div className="cd mb">
        <h4 style={{ fontSize: 16, marginBottom: 4, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="card" size={16} color="var(--color-primary)" />
          Public card
        </h4>
        <div className="dim" style={{ fontSize: 12.5, marginBottom: 12 }}>
          Headline &amp; services on your shareable business card
          {org.site_slug && (
            <>
              {" · "}
              <a href={`/card/${org.site_slug}`} target="_blank" rel="noreferrer" style={{ color: "var(--color-primary)" }}>
                preview
              </a>
            </>
          )}
        </div>

        <div style={{ marginBottom: 10 }}>
          <label className="sl" style={{ fontSize: 14 }}>Headline / tagline</label>
          <input
            value={headlineDraft}
            onChange={(e) => setHeadlineDraft(e.target.value)}
            onBlur={async () => {
              const v = headlineDraft.trim();
              let cur = "";
              try { cur = (org.site_content ? JSON.parse(org.site_content).headline : "") || ""; } catch { /* */ }
              if (v !== cur) {
                await saveCardContent({ headline: v });
                useStore.getState().showToast("Headline updated", "success");
              }
            }}
            placeholder="Serving the greater metro area"
            style={{ fontSize: 15 }}
          />
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
            Blank = &ldquo;Serving {"{city}"}&rdquo; from your address.
          </div>
        </div>

        <div>
          <label className="sl" style={{ fontSize: 14 }}>
            Services <span className="dim">· one per line</span>
          </label>
          <textarea
            value={servicesDraft}
            onChange={(e) => setServicesDraft(e.target.value)}
            onBlur={async () => {
              const arr = servicesDraft.split("\n").map((s) => s.trim()).filter(Boolean);
              let cur: string[] = [];
              try {
                const c = org.site_content ? JSON.parse(org.site_content) : {};
                cur = Array.isArray(c.services) ? c.services : [];
              } catch { /* */ }
              if (JSON.stringify(arr) !== JSON.stringify(cur)) {
                await saveCardContent({ services: arr });
                useStore.getState().showToast("Services updated", "success");
              }
            }}
            placeholder={"Repairs & maintenance\nRemodels & renovations\nInspections & estimates"}
            style={{ fontSize: 15, minHeight: 94, width: "100%" }}
          />
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
            Up to 6 show as colored chips. Blank = your licensed trades, then a default list.
          </div>
        </div>
      </div>
    </>
  );
}
