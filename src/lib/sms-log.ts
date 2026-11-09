import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone, sendSms, type SmsResult } from "@/lib/sms";
import { siteOrigin } from "@/lib/site-url";
import type { RecipientRole, SmsKind } from "@/lib/sms-recipient";

/**
 * Server-only: send ONE automatic customer text and keep a record of it.
 *   1. Skips any number in sms_opt_outs (they replied STOP).
 *   2. Sends through lib/sms.ts, asking Twilio to report delivery to
 *      /api/sms/status.
 *   3. Writes a row to sms_messages, sent or failed.
 * The opt-out read and the log write are best-effort: before the migration
 * runs (tables missing) the text still goes out, it just isn't logged.
 */
export const OPT_OUT_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"];
export const OPT_IN_WORDS = ["START", "UNSTOP", "YES"];
export const HELP_WORDS = ["HELP", "INFO"];

/** Twilio error: the number has opted out of this sender. */
export const TWILIO_UNSUBSCRIBED = 21610;

export async function isOptedOut(supabase: SupabaseClient, phone: string): Promise<boolean> {
  const p = normalizePhone(phone);
  if (!p) return false;
  try {
    const { data, error } = await supabase.from("sms_opt_outs").select("id").eq("phone", p).limit(1);
    if (error) return false;
    return !!data?.length;
  } catch {
    return false;
  }
}

export async function recordOptOut(supabase: SupabaseClient, phone: string, source: string, orgId?: string | null) {
  const p = normalizePhone(phone);
  if (!p) return;
  try {
    await supabase
      .from("sms_opt_outs")
      .upsert({ phone: p, source, org_id: orgId || null, opted_out_at: new Date().toISOString() }, { onConflict: "phone" });
  } catch {
    /* best-effort */
  }
}

export async function clearOptOut(supabase: SupabaseClient, phone: string) {
  const p = normalizePhone(phone);
  if (!p) return;
  try {
    await supabase.from("sms_opt_outs").delete().eq("phone", p);
  } catch {
    /* best-effort */
  }
}

export interface LoggedSmsInput {
  orgId: string;
  jobId?: string | null;
  to: string;
  body: string;
  kind: SmsKind;
  role: RecipientRole;
  /** Profile id of the person who tapped send (null for the timers). */
  sentBy?: string | null;
}

export type LoggedSmsResult = (SmsResult & { skipped?: undefined }) | { ok: false; skipped: "opted_out"; status: 409; error: string };

export async function sendLoggedSms(supabase: SupabaseClient, m: LoggedSmsInput): Promise<LoggedSmsResult> {
  const to = normalizePhone(m.to);
  if (await isOptedOut(supabase, to)) {
    await log(supabase, m, to, { status: "skipped", error: "Number replied STOP" });
    return { ok: false, skipped: "opted_out", status: 409, error: "This number replied STOP, so it won't get texts." };
  }
  let r: SmsResult;
  try {
    r = await sendSms(to, m.body, { statusCallback: `${siteOrigin()}/api/sms/status` });
  } catch (e) {
    r = { ok: false, error: e instanceof Error ? e.message : String(e), status: 500 };
  }
  if (!r.ok && r.code === TWILIO_UNSUBSCRIBED) await recordOptOut(supabase, to, "twilio_21610", m.orgId);
  await log(supabase, m, to, r.ok ? { status: "sent", sid: r.sid } : { status: "failed", error: r.error });
  return r;
}

async function log(
  supabase: SupabaseClient,
  m: LoggedSmsInput,
  to: string,
  r: { status: string; sid?: string; error?: string },
) {
  try {
    await supabase.from("sms_messages").insert({
      org_id: m.orgId,
      job_id: m.jobId || null,
      to_phone: to,
      recipient_role: m.role,
      kind: m.kind,
      body: m.body.slice(0, 1600),
      twilio_sid: r.sid || null,
      status: r.status,
      error: r.error ? r.error.slice(0, 500) : null,
      sent_by: m.sentBy || null,
    });
  } catch {
    /* best-effort */
  }
}
