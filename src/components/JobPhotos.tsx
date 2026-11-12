"use client";
/**
 * A job's photos on the Jobs tab: the same Before / Work / After picker as
 * Work mode (PhotoTypePicker), Camera + Upload buttons that save through the
 * same path (lib/job-photo-upload), and the photo grid with each photo's tag
 * and the X to remove it (owner / manager — the parent passes onRemove).
 * Used on the job's detail card and on its Receipts & photos screen.
 */
import { useState } from "react";
import { readBlob } from "@/lib/job-blob";
import { t } from "@/lib/i18n";
import { uploadJobPhoto, type JobPhotoTag } from "@/lib/job-photo-upload";
import { defaultPhotoTag } from "@/lib/photo-tag";
import PhotoTypePicker, { photoTagTint } from "./PhotoTypePicker";
import CameraModal from "./CameraModal";
import { Icon } from "./Icon";

interface Props {
  jobId: string;
  rooms: unknown;
  status?: string | null;
  /** Owner / manager: show the X on each photo. */
  onRemove?: (url: string) => void;
  onView: (url: string) => void;
}

const tagLabel = (type?: string) =>
  type === "before" ? t("wv.before") : type === "work" ? t("wv.work") : type === "after" ? t("wv.after") : type || "";

export default function JobPhotos({ jobId, rooms, status, onRemove, onView }: Props) {
  const blob = readBlob(rooms);
  const photos: { url: string; label?: string; type?: string }[] = Array.isArray(blob.photos)
    ? (blob.photos as { url: string; type?: string }[]).filter((p) => p && typeof p.url === "string")
    : [];
  const [tag, setTag] = useState<JobPhotoTag>(() =>
    defaultPhotoTag(photos, Array.isArray(blob.workOrder) ? (blob.workOrder as { done?: boolean }[]) : [], status) ?? "after");
  const [cam, setCam] = useState(false);
  const [uploading, setUploading] = useState(0);

  const upload = async (files: File[]) => {
    const pinned = tag; // a shot keeps the tag it was taken under
    setUploading((n) => n + files.length);
    for (const f of files) {
      try { await uploadJobPhoto(jobId, f, pinned); } finally { setUploading((n) => n - 1); }
    }
  };
  const pickFromLibrary = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*"; input.multiple = true;
    input.onchange = () => { if (input.files?.length) void upload(Array.from(input.files)); };
    input.click();
  };
  const camTitle = t(tag === "after" ? "jobs.photoAfter" : tag === "before" ? "jobs.photoBefore" : "jobs.photoWork");
  const btn: React.CSSProperties = {
    flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    fontSize: 14, padding: "9px 6px",
  };

  return (
    <div className="section">
      <div className="seclabel">
        <Icon name="camera" size={13} /> {t("jobs.photosHeading").replace("{n}", String(photos.length))}
        {uploading > 0 && <span className="dim" style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0 }}>{t("jobs.photosUploading")}</span>}
      </div>
      <div style={{ marginTop: 8 }}>
        <PhotoTypePicker value={tag} onChange={setTag} />
        <div style={{ display: "flex", gap: 7, marginBottom: photos.length ? 10 : 0 }}>
          <button type="button" className="bb" style={btn} onClick={() => setCam(true)}>
            <Icon name="camera" size={15} /> {t("jobs.takePhoto")}
          </button>
          <button type="button" className="bo" style={btn} onClick={pickFromLibrary}>
            <Icon name="upload" size={15} /> {t("common.upload")}
          </button>
        </div>
        {photos.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
            {photos.map((p, i) => {
              const tint = photoTagTint(p.type);
              return (
                <div
                  key={p.url || i}
                  onClick={() => onView(p.url)}
                  style={{ position: "relative", aspectRatio: "1", borderRadius: 8, overflow: "hidden", border: "1px solid var(--color-border-dark)", cursor: "pointer" }}
                >
                  <img src={p.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  {/* Remove this photo (owner / manager): written through
                      patchBlob onto the server's copy, so it stays removed. */}
                  {onRemove && (
                    <button
                      type="button"
                      aria-label={t("jobs.removePhoto")}
                      title={t("jobs.removePhoto")}
                      onClick={(e) => { e.stopPropagation(); onRemove(p.url); }}
                      style={{ position: "absolute", top: 3, right: 3, width: 24, height: 24, minHeight: 0, padding: 0, borderRadius: "50%", background: "rgba(0,0,0,.68)", border: "1px solid rgba(255,255,255,.35)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                    >
                      <Icon name="close" size={13} color="#fff" />
                    </button>
                  )}
                  {p.type && (
                    <span style={{ position: "absolute", bottom: 3, left: 3, fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: tint.bg, color: tint.fg, textTransform: "capitalize" }}>
                      {tagLabel(p.type)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <CameraModal open={cam} onClose={() => setCam(false)} onCapture={(fs) => void upload(fs)} multiple title={camTitle} />
    </div>
  );
}
