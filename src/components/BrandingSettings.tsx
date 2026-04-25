"use client";
import { useStore } from "@/lib/store";
import { db, supabase } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";
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

  if (!isOwner || !org) return null;

  const refreshOrg = async () => {
    const orgs = await db.get<Organization>("organizations", { id: org.id });
    if (orgs.length) setOrg(orgs[0]);
  };

  return (
    <>
      {/* Logo */}
      <div className="cd mb" style={{ textAlign: "center", padding: 16 }}>
        <img
          src={org?.logo_url || "/CREED_LOGO.png"}
          alt="Logo"
          style={{ height: 60, display: "block", margin: "0 auto 8px", borderRadius: 8 }}
          onError={(e) => ((e.target as HTMLImageElement).src = "/CREED_LOGO.png")}
        />
        <input
          type="file"
          accept="image/*"
          id="logo-upload"
          style={{ display: "none" }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const ext = file.name.split(".").pop() || "png";
            const path = `logos/${org.id}.${ext}`;
            const { error } = await supabase.storage
              .from("receipts")
              .upload(path, file, { upsert: true });
            if (error) {
              useStore.getState().showToast("Upload failed: " + error.message, "error");
              return;
            }
            const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(path);
            await db.patch("organizations", org.id, { logo_url: urlData.publicUrl });
            await loadAll();
            await refreshOrg();
            useStore.getState().showToast("Logo updated", "success");
          }}
        />
        <button
          className="bo"
          onClick={() => document.getElementById("logo-upload")?.click()}
          style={{ fontSize: 12, padding: "5px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <Icon name="camera" size={13} />
          Change Logo
        </button>
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
    </>
  );
}
