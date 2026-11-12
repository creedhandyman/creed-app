import { residentContact } from "./resident";
import { normalizePhone } from "./phone";
import { autoTextConsent, residentTextConsent } from "./sms-consent";

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
  /** customers.sms_consent (lib/sms-consent.ts) — absent before the migration. */
  sms_consent?: unknown;
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

/**
 * A free-form job message (the job card's Text chip and the Message customer
 * button). The owner picks WHO in the send strip ("client" = the linked
 * customer, "resident" = the resident on file), but the number always comes
 * from the job itself, never from the screen, so a text can only reach a
 * contact already on that job.
 */
export type MessagePick = "client" | "resident";

export function pickedRecipient(
  pick: MessagePick,
  job: { rooms: unknown; client?: string | null },
  customer: RecipientCustomer | null | undefined,
): Recipient {
  if (pick === "resident") {
    const res = residentContact(job.rooms);
    const phone = normalizePhone(res.phone);
    if (!phone) {
      return { ok: false, reason: "no_resident_phone", message: "No resident number on this job." };
    }
    return { ok: true, phone, name: res.name, role: "resident" };
  }
  const pm = isPropertyManager(customer);
  const phone = normalizePhone(customer?.phone);
  if (!phone) {
    return { ok: false, reason: "no_customer_phone", message: "No phone number on this customer." };
  }
  return {
    ok: true,
    phone,
    name: (pm ? customer?.name : customer?.name || job.client) || "",
    role: pm ? "property_manager" : "customer",
  };
}

/**
 * Did the person this automatic text would go to agree to texts?
 *   - resident: their own answer on the job (residentSmsConsent), for that
 *     number. The customer's consent never covers a resident.
 *   - customer / property manager: autoTextConsent (customer row + this job).
 * Every automatic Twilio send asks this (or autoTextConsent) first.
 */
export function recipientConsent(
  role: RecipientRole,
  phone: string,
  job: { rooms: unknown },
  customer: RecipientCustomer | null | undefined,
): { ok: true } | { ok: false; message: string } {
  if (role === "resident") {
    return residentTextConsent(job.rooms, phone)
      ? { ok: true }
      : { ok: false, message: "The resident hasn't agreed to automatic texts. Mark it on the job if they have." };
  }
  const c = autoTextConsent(customer, job.rooms);
  return c.ok
    ? { ok: true }
    : { ok: false, message: `${c.reason || "No text consent on file."} Record it on the customer page if they agreed.` };
}
