"use client";
import { useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/image";
import { t } from "@/lib/i18n";
import { patchBlob, addPhoto } from "@/lib/job-write-client";
import { enqueueUpload, isNetworkError } from "@/lib/offline-uploads";

/** The tags a crew picks before snapping (the Before / Work / After toggle). */
export type JobPhotoTag = "before" | "work" | "after";
export const JOB_PHOTO_TAGS: JobPhotoTag[] = ["before", "work", "after"];

/**
 * Add one photo to a job — the ONE path for Work mode and the Jobs tab
 * (moved out of WorkVision, 2026-11-12):
 *   - a big library photo is shrunk to the in-app camera's size (1600px);
 *   - offline (or a transport failure while "online") → stashed and attached
 *     on reconnect (the pre-computed path makes the replay idempotent);
 *   - otherwise uploaded to the public bucket under gallery/{job}/ and
 *     appended to the job's photos through patchBlob (merged onto the
 *     server's blob, deduped by url) with its tag.
 * Toasts its own outcome. Resolves true when the photo is on the job or
 * queued to be.
 */
export async function uploadJobPhoto(jobId: string, picked: File, tag: JobPhotoTag): Promise<boolean> {
  const st = useStore.getState();
  const file = picked.size > 700_000 ? await compressImage(picked, 1600, 0.8) : picked;
  const ext = file.name.split(".").pop() || "jpg";
  const path = `gallery/${jobId}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;

  const queue = async (msg: string): Promise<boolean> => {
    const ok = await enqueueUpload("job-photo", file, { jobId, path, tag, ext });
    if (ok) { st.bumpPendingUploads(); useStore.getState().showToast(msg, "info"); }
    return ok;
  };

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    if (await queue("Photo saved offline — uploads when you reconnect")) return true;
    useStore.getState().showToast("Couldn't save photo offline (storage full)", "error");
    return false;
  }
  const { error } = await supabase.storage.from("receipts").upload(path, file);
  if (error) {
    if (isNetworkError(error) && await queue("Photo saved — uploads when you reconnect")) return true;
    console.error("[job-photo] upload failed:", error);
    useStore.getState().showToast(t("wv.photoUploadFailed"), "error");
    return false;
  }
  const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(path);
  if (!urlData?.publicUrl) return false;
  const wrote = await patchBlob(jobId, addPhoto({ url: urlData.publicUrl, label: "", type: tag }));
  if (!wrote.ok) {
    // A refused write was already toasted by db.patch; say so for the rest.
    if (wrote.reason !== "rejected") useStore.getState().showToast(t("wv.photoUploadFailed"), "error");
    return false;
  }
  await useStore.getState().loadAll();
  const tagLabel = tag === "after" ? "Completion" : tag === "before" ? "Before" : "Work";
  useStore.getState().showToast(`${tagLabel} photo saved`, "success");
  return true;
}
