import { type SupabaseClient } from "@supabase/supabase-js";
import { dispatchNotifications, resolveRecipients } from "@/lib/notify-server";

/**
 * Owner/manager alerts for bank transfer (ACH) payments, which settle days
 * after the customer finishes checkout:
 *  - "started": the customer authorized a bank payment; nothing is recorded on
 *    the job yet (it lands when Stripe says the money cleared).
 *  - "failed":  the bank payment didn't go through; the job still owes it.
 * The "cleared" case is the ordinary payment-received alert from
 * fulfillJobPayment.
 *
 * Uses the existing payment_received notification type (already allowed by the
 * notifications CHECK constraint). Best-effort and never throws: an alert must
 * not affect payment handling or make Stripe retry the webhook.
 */
export async function notifyBankPayment(
  supabase: SupabaseClient,
  p: { jobId: string; orgId: string; amount: number; stage: "started" | "failed" },
): Promise<void> {
  try {
    if (!p.jobId || !p.orgId) return;
    const { data: jobRows } = await supabase
      .from("jobs").select("property, client").eq("id", p.jobId).eq("org_id", p.orgId).limit(1);
    const job = jobRows?.[0] as { property?: string | null; client?: string | null } | undefined;
    if (!job) return;
    const property = job.property || "a job";
    const who = job.client ? ` from ${job.client}` : "";
    const amt = `$${(Number(p.amount) || 0).toFixed(2)}`;

    const title = p.stage === "started" ? "Bank payment on its way" : "Bank payment failed";
    const body = p.stage === "started"
      ? `${amt} for ${property}${who} by bank transfer. It usually clears in about 4 business days; the job updates when it does.`
      : `The ${amt} bank transfer for ${property}${who} didn't go through. The balance is still owed.`;

    // Stripe can resend a webhook event: skip a byte-identical alert for this
    // job from the last 10 minutes. Best-effort.
    try {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: dupe } = await supabase
        .from("notifications").select("id")
        .eq("org_id", p.orgId).eq("job_id", p.jobId).eq("body", body)
        .gte("created_at", since).limit(1);
      if (dupe && dupe.length) return;
    } catch { /* proceed */ }

    const recipients = await resolveRecipients(supabase, p.orgId, { managers: true, event: "none" });
    if (!recipients.length) return;
    await dispatchNotifications(supabase, {
      orgId: p.orgId,
      type: "payment_received",
      title,
      body,
      jobId: p.jobId,
      recipients,
    });
  } catch (e) {
    console.error("[bank-payment] notification failed:", e);
  }
}
