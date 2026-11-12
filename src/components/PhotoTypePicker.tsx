"use client";
import { t } from "@/lib/i18n";
import type { JobPhotoTag } from "@/lib/job-photo-upload";

/**
 * Before / Work / After toggle — sets the type the next photo is saved as.
 * Shared by Work mode's Photos tab and the Jobs tab's job photos, so photos
 * are tagged the same way wherever they're added.
 */
const OPTS: { key: JobPhotoTag; label: string; bg: string; bd: string; fg: string }[] = [
  { key: "before", label: "wv.before", bg: "rgba(255,136,0,.16)", bd: "rgba(255,136,0,.5)", fg: "#ffb15e" },
  { key: "work", label: "wv.work", bg: "rgba(46,139,255,.16)", bd: "rgba(46,139,255,.5)", fg: "#9fc4ff" },
  { key: "after", label: "wv.after", bg: "rgba(0,204,102,.16)", bd: "rgba(0,204,102,.5)", fg: "#3ee08f" },
];

/** Tag colors for a photo's corner label (matches the toggle). */
export const photoTagTint = (type?: string) =>
  type === "before" ? { bg: "rgba(255,136,0,.3)", fg: "#ffb15e" }
  : type === "after" ? { bg: "rgba(0,204,102,.3)", fg: "#3ee08f" }
  : { bg: "rgba(46,139,255,.3)", fg: "#9fc4ff" };

export default function PhotoTypePicker({ value, onChange }: { value: JobPhotoTag; onChange: (v: JobPhotoTag) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
      {OPTS.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            aria-pressed={active}
            style={{
              flex: 1, textAlign: "center", fontFamily: "Oswald", fontWeight: 600, fontSize: 13, letterSpacing: ".04em",
              padding: 10, borderRadius: 9,
              background: active ? opt.bg : "var(--color-card-dark-3)",
              border: `1px solid ${active ? opt.bd : "var(--color-border-dark-2)"}`,
              color: active ? opt.fg : "var(--color-dim)",
              cursor: "pointer",
            }}
          >
            {t(opt.label)}
          </button>
        );
      })}
    </div>
  );
}
