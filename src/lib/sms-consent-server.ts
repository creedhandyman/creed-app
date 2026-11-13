import type { SupabaseClient } from "@supabase/supabase-js";
import { nextCustomerSmsConsent, type SmsConsentEntry } from "@/lib/sms-consent";
import { normalizePhone } from "@/lib/phone";

/**
 * Server-only helpers for the per-customer text consent
 * (customers.sms_consent — migration 20261112_customer_text_consent.sql).
 * The rule itself is pure and lives in lib/sms-consent.ts.
 *
 * Everything here is safe to call before the migration runs: reads fall back
 * to the old column list (consent then comes from the job blob only, as
 * before), writes are best-effort and never throw.
 */

/**
 * Load customers by id with `sms_consent` added to `cols`. If that column
 * doesn't exist yet, retry without it.
 */
export async function loadCustomersWithConsent<T extends { id: string }>(
  supabase: SupabaseClient,
  ids: string[],
  cols: string,
): Promise<Map<string, T & { sms_consent?: unknown }>> {
  const out = new Map<string, T & { sms_consent?: unknown }>();
  if (!ids.length) return out;
  const withConsent: string = `${cols}, sms_consent`;
  const first = await supabase.from("customers").select(withConsent).in("id", ids);
  const data: unknown = first.error
    ? (await supabase.from("customers").select(cols as string).in("id", ids)).data
    : first.data;
  for (const row of ((data || []) as (T & { sms_consent?: unknown })[])) out.set(row.id, row);
  return out;
}

/**
 * Write a consent answer onto one customer (mode: see nextCustomerSmsConsent).
 * Org-scoped. Returns true when something was written.
 */
export async function recordCustomerSmsConsent(
  supabase: SupabaseClient,
  customerId: string | null | undefined,
  orgId: string,
  entry: SmsConsentEntry,
  mode: "form" | "set",
): Promise<boolean> {
  if (!customerId || !orgId) return false;
  try {
    const { data, error } = await supabase
      .from("customers").select("id, phone, sms_consent").eq("id", customerId).eq("org_id", orgId).maybeSingle();
    if (error || !data) return false;
    const row = data as { phone?: string | null; sms_consent?: unknown };
    const next = nextCustomerSmsConsent(row.sms_consent, { ...entry, phone: entry.phone || row.phone || undefined }, mode);
    if (!next) return false;
    const { error: upErr } = await supabase
      .from("customers").update({ sms_consent: next }).eq("id", customerId).eq("org_id", orgId);
    return !upErr;
  } catch {
    return false;
  }
}

/**
 * A STOP / START reply from a number: stamp every customer on file with that
 * number (every business shares the sending number, and Twilio's own block is
 * per number, so the answer applies everywhere it's on file).
 *   STOP  → "no", source "replied STOP".
 *   START → back to "yes", but ONLY for customers whose current answer is that
 *           STOP (START never opts in someone who never agreed).
 */
export async function stampConsentFromReply(
  supabase: SupabaseClient,
  phone: string,
  keyword: "stop" | "start",
): Promise<number> {
  const p = normalizePhone(phone);
  const ten = p.replace(/\D/g, "").slice(-10);
  if (ten.length !== 10) return 0;
  try {
    const { data: matches, error } = await supabase.rpc("sms_customers_by_phone", { p_last10: ten });
    if (error || !Array.isArray(matches) || !matches.length) return 0;
    const ids = (matches as { id: string }[]).map((m) => m.id);
    const { data: rows, error: rErr } = await supabase.from("customers").select("id, org_id, sms_consent").in("id", ids);
    if (rErr || !rows) return 0;
    const at = new Date().toISOString();
    let n = 0;
    for (const r of rows as { id: string; org_id: string; sms_consent?: unknown }[]) {
      const cur = r.sms_consent as { granted?: boolean; source?: string } | null | undefined;
      if (keyword === "start" && !(cur && cur.granted === false && cur.source === "replied STOP")) continue;
      const next = nextCustomerSmsConsent(r.sms_consent, {
        granted: keyword === "start",
        at,
        source: keyword === "start" ? "replied START" : "replied STOP",
        phone: ten,
      }, "set");
      if (!next) continue;
      const { error: uErr } = await supabase.from("customers").update({ sms_consent: next }).eq("id", r.id).eq("org_id", r.org_id);
      if (!uErr) n++;
    }
    return n;
  } catch {
    return 0;
  }
}
