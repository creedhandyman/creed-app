/**
 * Which photo tag to start on for a job (pure; tested in photo-tag.test.ts).
 * Shared by Work mode and the Jobs tab's photo section:
 *   - the job is finished (complete / invoiced / paid) → "after";
 *   - nothing shot as "before" and no work-order task ticked → "before";
 *   - every task done → "after";
 *   - otherwise null = keep whatever is selected.
 */
export type PhotoTag = "before" | "work" | "after";

const DONE = new Set(["complete", "invoiced", "paid"]);

export function defaultPhotoTag(
  photos: { type?: string }[] | null | undefined,
  workOrder: { done?: boolean }[] | null | undefined,
  status?: string | null,
): PhotoTag | null {
  if (status && DONE.has(status)) return "after";
  const p = Array.isArray(photos) ? photos : [];
  const wo = Array.isArray(workOrder) ? workOrder : [];
  if (!p.some((x) => x?.type === "before") && !wo.some((w) => w?.done)) return "before";
  if (wo.length > 0 && wo.every((w) => w?.done)) return "after";
  return null;
}
