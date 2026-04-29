"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db, supabase } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";
import ShareCardPanel from "./ShareCardPanel";
import type { Organization } from "@/lib/types";

/**
 * Branding & Business Info — logo upload + the org's name/phone/email/
 * address/license number. Org-level config; admin-only. Lives in
 * Operations → Settings.
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

  if (!isOwner || !org) return null;

  const refreshOrg = async () => {
    const orgs = await db.get<Organization>("organizations", { id: org.id });
    if (orgs.length) setOrg(orgs[0]);
  };

  const onLogoFile = async (file: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      // Timestamp the filename so every upload is a unique URL — avoids the
      // browser-cache "I uploaded a new logo but I still see the old one"
      // problem that comes with overwriting the same path.
      const path = `logos/${org.id}_${Date.now()}.${ext}`;
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
            fontSize: 12,
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
              fontSize: 11,
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
        <div className="dim" style={{ fontSize: 10, marginTop: 8 }}>
          PNG, JPG, WEBP, or SVG · square or wide images work best
        </div>
      </div>

      {/* Editable business info */}
      <div className="cd mb">
        <h4
          style={{
            fontSize: 14,
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
        ].map((f) => (
          <div key={f.field} style={{ marginBottom: 6 }}>
            <label className="sl" style={{ fontSize: 12 }}>
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
              style={{ fontSize: 13 }}
            />
          </div>
        ))}
      </div>

      {/* Share-card / QR — surfaced here so the contractor sees it next
          to logo + business info. ShareCardPanel resolves the URL from
          org.site_slug and gracefully degrades to a "set your slug"
          message when the slug isn't configured yet. */}
      <ShareCardPanel />
    </>
  );
}
