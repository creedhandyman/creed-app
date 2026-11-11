/**
 * Sending a quote, an invoice or a job update to the customer BY HAND: the
 * rules shared by the Jobs send strip, Work mode's "Complete & invoice" step,
 * the On the way buttons, the customer page and the share card. PURE (tested
 * in job-send.test.ts).
 *
 * The rule (owner, 2026-11-10): Twilio sends only Creed's AUTOMATIC texts
 * (review requests, reminders, auto replies and other system texts). Anything
 * a business sends a customer by hand goes through the phone's own Messages
 * app, from the sender's own number, with the number and the text filled in.
 */

/** An `sms:` link that opens the phone's Messages app with the number and the
 *  text filled in. "?&body=" is the form that prefills the body on BOTH iOS
 *  and Android; the number is stripped to digits/+ so punctuation can't break
 *  it. No number = Messages opens with the text and the sender picks a contact. */
export function smsHref(phone: string | null | undefined, body: string): string {
  const to = (phone || "").replace(/[^\d+]/g, "");
  return `sms:${to}?&body=${encodeURIComponent(body)}`;
}

/** Paid-to-date and what the customer still owes, to the cent. */
export function balanceOf(job: { total?: number | null; amount_paid?: number | null }): { paid: number; due: number } {
  const paid = Math.round((Number(job.amount_paid) || 0) * 100) / 100;
  const due = Math.round(Math.max(0, (Number(job.total) || 0) - paid) * 100) / 100;
  return { paid, due };
}

/** Paid in full: a real total, money received, nothing left owing. On a job
 *  whose work isn't done yet this is a prepayment (the job keeps its status
 *  until it is completed, then goes straight to Paid). */
export function isPaidUp(job: { total?: number | null; amount_paid?: number | null }): boolean {
  const { paid, due } = balanceOf(job);
  return (Number(job.total) || 0) > 0 && paid > 0 && due <= 0.009;
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
