import { residentContact } from "./resident";
import { normalizePhone } from "./phone";

/**
 * Who gets an automatic text for a job. PURE (tested in sms-recipient.test.ts)
 * so the Jobs screen, the one-tap buttons, /api/sms and both timers agree.
 *
 * The rule:
 *   - Visit texts (on the way, running late, job done, day-before reminder):
 *     on a PROPERTY MANAGER job they go to the RESIDENT on file (job rooms
 *     blob, lib/resident). The property manager is never texted for a visit.
 *     No resident number = nothing is sent and the caller warns the owner.
 *     Every other job texts the customer.
 *   - Money texts (invoice + unpaid reminders): always whoever PAYS, i.e. the
 *     linked customer (the property manager on a PM job). Never the resident.
 */
export type SmsKind = "enroute" | "late" | "complete" | "reminder" | "invoice";
export const VISIT_KINDS: SmsKind[] = ["enroute", "late", "complete", "reminder"];
export const SMS_KINDS: SmsKind[] = [...VISIT_KINDS, "invoice"];

export type RecipientRole = "customer" | "resident" | "property_manager";

export interface RecipientCustomer {
  type?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

export type Recipient =
  | { ok: true; phone: string; name: string; role: RecipientRole }
  | { ok: false; reason: "no_resident_phone" | "no_customer_phone"; message: string };

export function isPropertyManager(customer: RecipientCustomer | null | undefined): boolean {
  return (customer?.type || "").trim().toLowerCase() === "property_manager";
}

export function isVisitKind(kind: SmsKind): boolean {
  return VISIT_KINDS.includes(kind);
}

export function textRecipient(
  kind: SmsKind,
  job: { rooms: unknown; client?: string | null },
  customer: RecipientCustomer | null | undefined,
): Recipient {
  const pm = isPropertyManager(customer);
  if (isVisitKind(kind) && pm) {
    const res = residentContact(job.rooms);
    if (!normalizePhone(res.phone)) {
      return {
        ok: false,
        reason: "no_resident_phone",
        message: "No resident number on this job. Add it on the job, or text them yourself.",
      };
    }
    return { ok: true, phone: normalizePhone(res.phone), name: res.name, role: "resident" };
  }
  const phone = normalizePhone(customer?.phone);
  if (!phone) {
    return {
      ok: false,
      reason: "no_customer_phone",
      message: "No phone number on this customer.",
    };
  }
  return {
    ok: true,
    phone,
    name: (pm ? customer?.name : customer?.name || job.client) || "",
    role: pm ? "property_manager" : "customer",
  };
}
