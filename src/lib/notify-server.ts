import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { normalizePhone, sendSms } from "@/lib/sms";

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

// join_request rows are written by a DB trigger (profiles insert), not here.
export type NotificationType = "job_assigned" | "new_lead" | "payment_received" | "payroll_alert" | "join_request" | "quote_approved" | "job_scheduled";

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

// The phone normalizer + Twilio send live in lib/sms.ts (one copy for every
// server texting path). Re-exported so existing imports keep working.
export { normalizePhone };

/** Which per-event pref column gates a notification. "none" = no column for
 *  this event (payments, payroll, quote approved) → everyone opted in. */
export type RecipientEvent = "assigned" | "leads" | "none";

const EVENT_COLUMN: Record<RecipientEvent, string | null> = {
  assigned: "notify_assigned",
  leads: "notify_leads",
  none: null,
};

export interface ResolvedRecipient extends NotifyRecipient {
  name: string | null;
}

/**
 * Build a dispatchNotifications recipient list from the org's profiles. The
 * audience is any mix of: the org's owners + managers (`managers`), specific
 * profile ids (`ids`), or crew names as the schedule note / requested_tech
 * store them (`names` — trimmed, case-insensitive; nameless profiles never
 * match). Always scoped to `orgId`; pending (not yet approved) members are
 * never notified. `event` picks the per-event pref (notify_assigned /
 * notify_leads) that becomes `eventOptIn` — null/undefined there still means
 * opted in (dispatchNotifications decides). De-duped by id. Throws on a
 * query error so each caller keeps its own error handling.
 */
export async function resolveRecipients(
  supabase: SupabaseClient,
  orgId: string,
  opts: { managers?: boolean; ids?: string[]; names?: string[]; event: RecipientEvent },
): Promise<ResolvedRecipient[]> {
  const ids = new Set((opts.ids || []).filter(Boolean));
  const names = new Set((opts.names || []).map((n) => (n || "").trim().toLowerCase()).filter(Boolean));
  if (!orgId || (!opts.managers && !ids.size && !names.size)) return [];

  const col = EVENT_COLUMN[opts.event];
  const { data, error } = await supabase
    .from("profiles")
    .select(`id, name, role, status, phone, notify_sms${col ? `, ${col}` : ""}`)
    .eq("org_id", orgId);
  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  const out: ResolvedRecipient[] = [];
  for (const raw of (data || []) as unknown as Record<string, unknown>[]) {
    const id = raw.id as string;
    if (!id || seen.has(id) || raw.status === "pending") continue;
    const name = typeof raw.name === "string" ? raw.name : null;
    const hit = (opts.managers && (raw.role === "owner" || raw.role === "manager"))
      || ids.has(id)
      || (!!name && names.has(name.trim().toLowerCase()));
    if (!hit) continue;
    seen.add(id);
    out.push({
      id,
      name,
      phone: (raw.phone as string | null) ?? null,
      notify_sms: (raw.notify_sms as boolean | null) ?? null,
      eventOptIn: col ? ((raw[col] as boolean | null) ?? null) : null,
    });
  }
  return out;
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
  // sendSms can throw on a network error — never let that sink the batch.
  const results = await Promise.all(sendable.map((r) =>
    sendSms(r.phone as string, text).catch(() => ({ ok: false }))));
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
    /** Skip this person (they recorded the payment themselves). */
    excludeUserId?: string | null;
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
    // No per-event opt-out column for payments yet → everyone opted in.
    const recipients = (await resolveRecipients(supabase, p.orgId, { managers: true, event: "none" }))
      .filter((r) => r.id !== p.excludeUserId);
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

/**
 * "Customer approved & signed" alert to owners/managers, deep-linked to the
 * job so the next tap is Schedule. Fired by /api/jobs/approve on the FIRST
 * approval only (quoted → accepted). Never throws.
 */
export async function notifyQuoteApproved(
  supabase: SupabaseClient,
  p: { jobId: string; orgId: string; total: number; property?: string | null; client?: string | null; option?: string | null },
): Promise<void> {
  try {
    if (!p.orgId || !p.jobId) return;
    const recipients = await resolveRecipients(supabase, p.orgId, { managers: true, event: "none" });
    if (!recipients.length) return;
    const who = p.client || "Your customer";
    const what = p.property || "their job";
    const amt = `$${(Number(p.total) || 0).toFixed(2)}`;
    const title = "Quote approved";
    const body = `${who} approved & signed ${what} — ${amt}${p.option ? ` (${p.option})` : ""}. Tap to schedule it.`;
    await dispatchNotifications(supabase, {
      orgId: p.orgId,
      type: "quote_approved",
      title,
      body,
      jobId: p.jobId,
      smsBody: `${title}: ${who} approved ${what} — ${amt}.`,
      recipients,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[notify] quote-approved notification failed:", e);
  }
}

/**
 * Payday visibility alert — owners/managers get ONE notification whenever a
 * SCHEDULED auto-payroll run actually attempts their payday: paid summary,
 * "nothing to pay", or "had problems". Called from /api/payroll/auto-run for
 * non-force runs only (manual Run-now/Process-all already toasts its summary
 * to the person tapping it). Exists because a skipped/failed payday used to
 * be silent — nobody knew until the crew asked (cron_log week of 2026-09-12).
 *
 * Same-day dedupe on (org, title, body): the 21:00 retry cron re-fires the
 * endpoint, and on a "nothing to pay" payday (last_run not stamped) BOTH
 * invocations reach this — the second identical alert is suppressed. NEVER
 * throws; requires 'payroll_alert' in the notifications.type CHECK (see
 * CLAUDE.md migration) — until that runs this degrades to a logged no-op.
 */
export async function notifyPayrollAlert(
  supabase: SupabaseClient,
  p: { orgId: string; title: string; body: string },
): Promise<void> {
  try {
    if (!p.orgId) return;

    // No per-event opt-out column for payroll alerts → always opted in.
    const recipients = await resolveRecipients(supabase, p.orgId, { managers: true, event: "none" });
    if (!recipients.length) return;

    // Same-UTC-day dedupe (17:00 + 21:00 invocations of a no-op payday).
    try {
      const dayStart = new Date().toISOString().split("T")[0] + "T00:00:00Z";
      const { data: dupe } = await supabase
        .from("notifications")
        .select("id")
        .eq("org_id", p.orgId)
        .eq("type", "payroll_alert")
        .eq("title", p.title)
        .eq("body", p.body)
        .gte("created_at", dayStart)
        .limit(1);
      if (dupe && dupe.length) return;
    } catch { /* proceed on check failure */ }

    await dispatchNotifications(supabase, {
      orgId: p.orgId,
      type: "payroll_alert",
      title: p.title,
      body: p.body,
      recipients,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[notify] payroll alert failed:", e);
  }
}
