/**
 * Sending a quote or an invoice to the customer: the rules shared by the Jobs
 * send strip, the quote editor's Send sheet and Work mode's "Complete &
 * invoice" step. PURE (tested in job-send.test.ts); the network call lives in
 * lib/job-text-client.ts.
 */

/** True when texts to the customer go out from the business number (Twilio):
 *  Ops is set to "business number" AND the business-number switch is on.
 *  Anything else (including the default) uses the phone's own Messages app. */
export function sendsFromBusiness(
  org: { job_text_via?: string | null; auto_sms_enroute?: boolean | null } | null | undefined,
): boolean {
  return org?.job_text_via === "business" && org?.auto_sms_enroute === true;
}

/** Paid-to-date and what the customer still owes, to the cent. */
export function balanceOf(job: { total?: number | null; amount_paid?: number | null }): { paid: number; due: number } {
  const paid = Math.round((Number(job.amount_paid) || 0) * 100) / 100;
  const due = Math.round(Math.max(0, (Number(job.total) || 0) - paid) * 100) / 100;
  return { paid, due };
}

/** The invoice text: the balance and the job link (the customer pays there). */
export function invoiceText(
  job: { client?: string | null; property?: string | null; total?: number | null; amount_paid?: number | null },
  o: { url: string; orgName?: string | null; payOnline?: boolean },
): string {
  const { paid, due } = balanceOf(job);
  const name = job.client || "there";
  const prop = job.property || "your property";
  const lines = [`Hi ${name}! Here's your invoice from ${o.orgName || "us"} for ${prop}.`, ""];
  lines.push(
    paid > 0
      ? `Balance due: $${due.toFixed(2)} (after the $${paid.toFixed(2)} you already paid)`
      : `Total due: $${due.toFixed(2)}`,
  );
  if (o.url) lines.push("", o.payOnline ? `View & pay online: ${o.url}` : `View your invoice: ${o.url}`);
  return lines.join("\n");
}

/** Longest text the server accepts for a job message (see /api/sms). */
export const MAX_JOB_MESSAGE = 1000;
