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

export type NotificationType = "job_assigned" | "new_lead";

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
