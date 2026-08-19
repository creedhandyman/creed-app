import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";

/**
 * Server-only notification helpers. Shared by /api/notify (job assigned)
 * and /api/leads (new lead). Two responsibilities:
 *   1. Always write an in-app `notifications` row per recipient (the
 *      dashboard-bell feed is the source of truth).
 *   2. Best-effort SMS to recipients who've opted in — gated by the
 *      NOTIFY_SMS_ENABLED env flag so we can ship the feed first and flip
 *      texting on later (set NOTIFY_SMS_ENABLED=1 on Vercel) with no code
 *      deploy. Twilio creds are the same ones /api/sms already uses.
 *
 * SMS sends are fire-and-forget: a Twilio failure (or missing config)
 * never blocks the in-app notification or the caller's main flow.
 */

// Master switch for the SMS channel. The in-app feed always writes; this
// only gates whether we also send texts. Off until the fast-follow.
const SMS_ENABLED = process.env.NOTIFY_SMS_ENABLED === "1";

// Web push runs whenever VAPID keys are configured — independent of the SMS
// flag. The in-app feed always writes; push + SMS are additive channels.
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:creedhandyman@gmail.com";
const PUSH_ENABLED = !!(VAPID_PUBLIC && VAPID_PRIVATE);

export type NotificationType = "job_assigned" | "new_lead" | "payment_received";

export interface NotifyRecipient {
  /** Recipient profile id. */
  id: string;
  phone?: string | null;
  /** Master "text me" switch. Defaults to opted-in when null/undefined. */
  notify_sms?: boolean | null;
  /** Per-event toggle for THIS notification (notify_assigned /
   *  notify_leads). Defaults to opted-in when null/undefined. */
  eventOptIn?: boolean | null;
}

/** Loose-US → E.164. Mirrors normalizePhone in /api/sms + reviews/dispatch. */
export function normalizePhone(raw: string | null | undefined): string {
  const v = (raw || "").trim();
  if (!v) return "";
  if (v.startsWith("+")) return "+" + v.slice(1).replace(/\D/g, "");
  const digits = v.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

async function sendSms(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { ok: false, error: "Twilio not configured" };
  const phone = normalizePhone(to);
  if (!phone) return { ok: false, error: "No valid phone" };

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const form = new URLSearchParams({ To: phone, From: from, Body: body });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      return { ok: false, error: data.message || `Twilio ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Best-effort Web Push to a set of user ids. Only runs when VAPID is
 * configured. Prunes subscriptions the push service reports as gone (404/410).
 * Never throws — a push failure must not block the in-app feed or the caller.
 */
async function sendPush(
  supabase: SupabaseClient,
  userIds: string[],
  payload: { title: string; body: string; url: string },
): Promise<number> {
  if (!PUSH_ENABLED || !userIds.length) return 0;
  try {
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", userIds);
    if (!subs?.length) return 0;

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC as string, VAPID_PRIVATE as string);
    const data = JSON.stringify(payload);
    let sent = 0;
    const stale: string[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            data,
          );
          sent++;
        } catch (e: unknown) {
          const code = (e as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) stale.push(s.id as string);
        }
      }),
    );
    if (stale.length) await supabase.from("push_subscriptions").delete().in("id", stale);
    return sent;
  } catch {
    return 0;
  }
}

/**
 * Write one in-app notification per recipient (respecting the per-event
 * opt-in), then — if SMS is enabled — text those who also have the master
 * SMS switch on and a phone on file. Returns counts for logging/response.
 */
export async function dispatchNotifications(
  supabase: SupabaseClient,
  params: {
    orgId: string;
    type: NotificationType;
    title: string;
    body: string;
    jobId?: string | null;
    /** Optional distinct SMS text. Falls back to `${title} — ${body}`. */
    smsBody?: string;
    recipients: NotifyRecipient[];
  },
): Promise<{ created: number; texted: number; pushed: number; failures: number }> {
  const { orgId, type, title, body, jobId, smsBody, recipients } = params;

  // De-dup recipients by id, drop anyone opted out of this event.
  const seen = new Set<string>();
  const targets = recipients.filter((r) => {
    if (!r.id || seen.has(r.id)) return false;
    seen.add(r.id);
    return r.eventOptIn !== false; // null/undefined/true = opted in
  });
  if (!targets.length) return { created: 0, texted: 0, pushed: 0, failures: 0 };

  // In-app rows — one batch insert.
  const rows = targets.map((r) => ({
    org_id: orgId,
    user_id: r.id,
    type,
    title,
    body,
    job_id: jobId || null,
  }));
  const { error } = await supabase.from("notifications").insert(rows);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[notify] notifications insert failed:", error.message);
    return { created: 0, texted: 0, pushed: 0, failures: targets.length };
  }

  // Web push — best-effort, independent of the SMS channel.
  const pushed = await sendPush(
    supabase,
    targets.map((t) => t.id),
    { title, body, url: "/" },
  );

  if (!SMS_ENABLED) return { created: targets.length, texted: 0, pushed, failures: 0 };

  // SMS — best-effort, in parallel.
  const text = (smsBody || `${title} — ${body}`).slice(0, 600);
  const sendable = targets.filter((r) => r.notify_sms !== false && normalizePhone(r.phone));
  const results = await Promise.all(sendable.map((r) => sendSms(r.phone as string, text)));
  const texted = results.filter((x) => x.ok).length;
  return { created: targets.length, texted, pushed, failures: results.length - texted };
}

/**
 * Notify the org's owners/managers that a customer payment landed on a job.
 * Called from BOTH the Stripe webhook and /api/verify-payment right after a
 * charge is recorded. Gate the CALL SITE on `!result.alreadyRecorded` — the
 * UNIQUE stripe_session_id ledger insert makes that race-proof when the
 * payments table exists (only the path that inserts first sees
 * alreadyRecorded === false). A second, in-body backstop below covers the
 * degraded mode where that gate can't (no payments table → the insert fails
 * with 42P01 not 23505, so alreadyRecorded stays false on BOTH paths).
 *
 * Best-effort: always writes the in-app feed row, plus push/SMS on the same
 * NOTIFY_SMS_ENABLED / VAPID gates as every other notification. NEVER throws —
 * a notification failure must not affect payment recording. Fires on any
 * recorded customer charge (deposit or balance); the copy distinguishes a
 * partial payment from paid-in-full. Requires the `payment_received` value in
 * the notifications.type CHECK constraint (see the migration in CLAUDE.md);
 * until that runs the in-app insert fails and this degrades to a logged no-op.
 */
export async function notifyJobPaid(
  supabase: SupabaseClient,
  p: {
    jobId: string;
    orgId: string;
    paidNow: number;      // dollars charged in THIS payment
    amountPaid: number;   // paid-to-date after this charge
    total: number;        // job total
    fullyPaid: boolean;
  },
): Promise<void> {
  try {
    if (!p.orgId || !p.jobId) return;

    const { data: jobRows } = await supabase
      .from("jobs").select("property, client").eq("id", p.jobId).limit(1);
    const job = jobRows?.[0] as { property?: string | null; client?: string | null } | undefined;
    const property = job?.property || "a job";
    const who = job?.client ? ` from ${job.client}` : "";

    // Owners + managers get the money-in alert (the crew doesn't need it).
    const { data: admins } = await supabase
      .from("profiles")
      .select("id, phone, notify_sms")
      .eq("org_id", p.orgId)
      .in("role", ["owner", "manager"]);
    const recipients: NotifyRecipient[] = (admins || []).map((a) => ({
      id: a.id as string,
      phone: (a.phone as string | null) ?? null,
      notify_sms: (a.notify_sms as boolean | null) ?? null,
      // No per-event opt-out column for payments yet → everyone opted in.
      eventOptIn: null,
    }));
    if (!recipients.length) return;

    const amt = `$${(Number(p.paidNow) || 0).toFixed(2)}`;
    const balance = Math.max(0, (Number(p.total) || 0) - (Number(p.amountPaid) || 0));
    const title = p.fullyPaid ? "Paid in full" : "Payment received";
    const body = p.fullyPaid
      ? `${amt} for ${property}${who} — paid in full.`
      : `${amt} for ${property}${who} · balance $${balance.toFixed(2)}.`;

    // Idempotency backstop for the degraded / transient case the call-site
    // !alreadyRecorded gate can't cover (see the function doc). Both fulfillment
    // paths for ONE charge fire within seconds and produce a byte-identical
    // body, so skip if a matching alert for this job was written in the last 10
    // minutes. A genuinely separate later payment has a different amount/balance
    // body, so it still comes through. Best-effort — a failed check just proceeds.
    try {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: dupe } = await supabase
        .from("notifications")
        .select("id")
        .eq("org_id", p.orgId)
        .eq("job_id", p.jobId)
        .eq("type", "payment_received")
        .eq("body", body)
        .gte("created_at", since)
        .limit(1);
      if (dupe && dupe.length) return;
    } catch { /* proceed on check failure */ }

    await dispatchNotifications(supabase, {
      orgId: p.orgId,
      type: "payment_received",
      title,
      body,
      jobId: p.jobId,
      smsBody: `${title}: ${amt} for ${property}${who}.`,
      recipients,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[notify] job-paid notification failed:", e);
  }
}
