/**
 * Unpaid invoice reminders: the rules for /api/invoices/reminders. PURE
 * (tested in invoice-reminder.test.ts).
 *
 * A job is reminded while it sits in "invoiced" with a balance due. Reminder
 * #1 goes 3 days after the invoice went out (jobs.invoice_sent_at, stamped by
 * a DB trigger when the status flips to invoiced), #2 at 7 days, #3 at 14,
 * then it stops. A payment that clears the balance, or any status change,
 * stops it too.
 */
export const INVOICE_REMINDER_DAYS = [3, 7, 14] as const;
export const MAX_INVOICE_REMINDERS = INVOICE_REMINDER_DAYS.length;
/** The cron runs once a day; a few hours of slack keeps an afternoon invoice
 *  from slipping a whole day. */
export const INVOICE_REMINDER_SLACK_HOURS = 6;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface InvoiceReminderJob {
  status?: string | null;
  archived?: boolean | null;
  total?: number | string | null;
  amount_paid?: number | string | null;
  invoice_sent_at?: string | null;
  invoice_reminder_count?: number | null;
}

/** What's still owed, rounded to cents (never negative). */
export function balanceDue(j: Pick<InvoiceReminderJob, "total" | "amount_paid">): number {
  const due = (Number(j.total) || 0) - (Number(j.amount_paid) || 0);
  return Math.max(0, Math.round(due * 100) / 100);
}

/** The reminder step (1-based) due now, or null. */
export function invoiceReminderDue(j: InvoiceReminderJob, now: number): number | null {
  if (j.status !== "invoiced" || j.archived === true) return null;
  if (balanceDue(j) <= 0) return null;
  const sent = Date.parse(j.invoice_sent_at || "");
  if (!Number.isFinite(sent)) return null;
  const done = Math.max(0, Math.floor(Number(j.invoice_reminder_count) || 0));
  if (done >= MAX_INVOICE_REMINDERS) return null;
  const dueAt = sent + INVOICE_REMINDER_DAYS[done] * DAY_MS - INVOICE_REMINDER_SLACK_HOURS * HOUR_MS;
  return now >= dueAt ? done + 1 : null;
}

export type InvoiceChannel = "sms" | "email" | "owner";

/**
 * How a reminder goes out. Property managers get an email (they pay through
 * their own portals and a text per unit is noise); a text needs the
 * customer's recorded text opt-in (same rule as quote follow-ups); otherwise
 * email; with neither, the owner is alerted to reach out.
 */
export function invoiceChannel(p: {
  propertyManager: boolean;
  consent: boolean;
  phone?: string | null;
  email?: string | null;
}): InvoiceChannel {
  const hasEmail = (p.email || "").includes("@");
  const hasPhone = (p.phone || "").replace(/\D/g, "").length >= 10;
  if (p.propertyManager) return hasEmail ? "email" : "owner";
  if (p.consent && hasPhone) return "sms";
  return hasEmail ? "email" : "owner";
}
