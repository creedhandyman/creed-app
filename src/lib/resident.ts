/**
 * Resident (tenant) contact for a job — the person LIVING at the property,
 * distinct from the paying client (often a property manager). Stored on the
 * job's rooms JSON blob, no schema change:
 *   - residentName / residentPhone / residentEmail — set by hand on the
 *     Jobs detail screen.
 *   - tenantName / tenantPhone / tenantEmail — stamped automatically by the
 *     AppFolio work-order import.
 * Manual fields win; import fields are the fallback.
 *
 * Review requests (both the automated cron and the manual modal) send to
 * the resident when one is on file — otherwise a PM client would be asked
 * to review their own work order after every job at every property.
 */
export function residentContact(roomsBlob: unknown): { name: string; phone: string; email: string } {
  try {
    const d = (typeof roomsBlob === "string" ? JSON.parse(roomsBlob) : (roomsBlob || {})) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    return {
      name: s(d.residentName) || s(d.tenantName),
      phone: s(d.residentPhone) || s(d.tenantPhone),
      email: s(d.residentEmail) || s(d.tenantEmail),
    };
  } catch {
    return { name: "", phone: "", email: "" };
  }
}
