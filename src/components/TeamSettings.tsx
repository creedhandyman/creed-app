"use client";
import { useStore } from "@/lib/store";
import { db, supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/types";
import { Icon } from "./Icon";

/**
 * Reusable Team management panel — invite code, photo upload, role/rate
 * editing, removal. Used in both Settings (legacy spot) and Operations
 * (admin home for back-office tasks). Owners can edit anyone; non-owners
 * see a read-only roster.
 */
export default function TeamSettings() {
  const user = useStore((s) => s.user)!;
  const profiles = useStore((s) => s.profiles);
  const setUser = useStore((s) => s.setUser);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);
  const isOwner = user.role === "owner" || user.role === "manager";

  return (
    <div className="cd">
      {/* Invite code (admin only) */}
      {isOwner && user.org_id && (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            background: darkMode ? "#1a1a28" : "#f0f4f8",
            borderRadius: 8,
          }}
        >
          <div className="sl" style={{ marginBottom: 4 }}>
            Invite Code (share with team)
          </div>
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 13,
              color: "var(--color-primary)",
              wordBreak: "break-all",
            }}
          >
            {user.org_id}
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(user.org_id);
              useStore.getState().showToast("Copied!", "success");
            }}
            style={{
              fontSize: 12,
              marginTop: 4,
              background: "none",
              color: "var(--color-primary)",
              padding: 0,
              textDecoration: "underline",
            }}
          >
            Copy to clipboard
          </button>
        </div>
      )}

      <h4
        style={{
          fontSize: 14,
          marginBottom: 8,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Icon name="clients" size={15} color="var(--color-primary)" />
        Team ({profiles.length})
      </h4>

      {profiles.map((u: Profile) => (
        <div key={u.id} className="sep" style={{ fontSize: 13 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="row" style={{ gap: 8 }}>
              {/* Avatar (click to upload, owner-or-self) */}
              <label
                title={isOwner || u.id === user.id ? "Click to change photo" : ""}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: u.photo_url
                    ? `url(${u.photo_url}) center/cover`
                    : "var(--color-primary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "Oswald",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: isOwner || u.id === user.id ? "pointer" : "default",
                  flexShrink: 0,
                  border: "2px solid var(--color-border-dark)",
                  overflow: "hidden",
                }}
              >
                {!u.photo_url &&
                  (u.name
                    ?.split(/\s+/)
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase() || "?")}
                {(isOwner || u.id === user.id) && (
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const ext = file.name.split(".").pop() || "jpg";
                      const path = `avatars/${u.id}_${Date.now()}.${ext}`;
                      const { error } = await supabase.storage
                        .from("receipts")
                        .upload(path, file);
                      if (error) {
                        useStore
                          .getState()
                          .showToast("Photo upload failed: " + error.message, "error");
                        return;
                      }
                      const { data } = supabase.storage.from("receipts").getPublicUrl(path);
                      await db.patch("profiles", u.id, { photo_url: data.publicUrl });
                      await loadAll();
                      if (u.id === user.id) setUser({ ...user, photo_url: data.publicUrl });
                      useStore.getState().showToast("Photo updated", "success");
                      e.target.value = "";
                    }}
                  />
                )}
              </label>
              <div>
                <b>{u.name}</b> <span className="dim">#{u.emp_num}</span>
              </div>
            </div>
            {isOwner ? (
              <div className="row">
                <select
                  defaultValue={u.role}
                  style={{ width: "auto", fontSize: 12, padding: "2px 4px" }}
                  onChange={async (e) => {
                    if (
                      u.id === user.id &&
                      (e.target.value === "tech" || e.target.value === "apprentice")
                    ) {
                      if (
                        !(await useStore
                          .getState()
                          .showConfirm(
                            "Warning",
                            "Demoting yourself will lock you out of admin settings. Are you sure?",
                          ))
                      ) {
                        e.target.value = u.role;
                        return;
                      }
                    }
                    await db.patch("profiles", u.id, { role: e.target.value });
                    if (u.id === user.id)
                      setUser({ ...user, role: e.target.value as Profile["role"] });
                    loadAll();
                  }}
                >
                  <option value="apprentice">Apprentice</option>
                  <option value="tech">Tech</option>
                  <option value="manager">Manager</option>
                  <option value="owner">Owner</option>
                </select>
                <span>$</span>
                <input
                  type="number"
                  defaultValue={u.rate}
                  style={{ width: 55, padding: "2px 4px", fontSize: 12 }}
                  onBlur={async (e) => {
                    const newRate = parseFloat(e.target.value) || 0;
                    await db.patch("profiles", u.id, { rate: newRate });
                    await loadAll();
                    if (u.id === user.id) setUser({ ...user, rate: newRate });
                  }}
                />
                <span style={{ fontSize: 11 }}>/hr</span>
                {u.id !== user.id && (
                  <button
                    onClick={async () => {
                      if (
                        !(await useStore
                          .getState()
                          .showConfirm(
                            "Remove Team Member",
                            `Remove ${u.name} from the team?`,
                          ))
                      )
                        return;
                      await db.del("profiles", u.id);
                      loadAll();
                    }}
                    aria-label={`Remove ${u.name}`}
                    style={{
                      background: "none",
                      color: "var(--color-accent-red)",
                      padding: "0 4px",
                      display: "inline-flex",
                      alignItems: "center",
                    }}
                  >
                    <Icon name="close" size={14} />
                  </button>
                )}
              </div>
            ) : (
              <span>${u.id === user.id ? user.rate : "—"}/hr</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
