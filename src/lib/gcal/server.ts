/**
 * Running a sync for one business (server only): one pass at a time per
 * business (a DB lock row), Google tokens refreshed + stored encrypted, the
 * push-notification channel kept alive, and a revoked / expired connection
 * marked "needs reconnect" with ONE alert to the owners. Called by the kick,
 * the Google webhook, the 10-minute cron and "Sync now".
 */
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "../api-auth";
import { siteOrigin } from "../site-url";
import { isValidTimeZone } from "../tz";
import { dispatchNotifications, resolveRecipients } from "../notify-server";
import { decrypt, encrypt, newNonce, sha256 } from "./crypto";
import { googleApi, refreshAccess, revokeToken, type GoogleApi } from "./google";
import { supabaseStore } from "./store";
import { AuthError, syncOrg, type SyncResult } from "./engine";

export interface LinkRow {
  org_id: string;
  google_email: string | null;
  refresh_token_enc: string | null;
  access_token_enc: string | null;
  access_expires_at: string | null;
  calendar_id: string | null;
  channel_id: string | null;
  channel_resource_id: string | null;
  channel_token_hash: string | null;
  channel_expires_at: string | null;
  status: "active" | "needs_reconnect";
  last_error: string | null;
  last_synced_at: string | null;
}

const LOCK_MS = 3 * 60000;
const WATCH_TTL_SEC = 7 * 86400;

/** Calendar API for a link, refreshing (and storing) the access token as needed. */
export function apiForLink(sb: SupabaseClient, link: LinkRow): GoogleApi {
  let token = decrypt(link.access_token_enc);
  let exp = Date.parse(link.access_expires_at || "") || 0;
  return googleApi(async (force) => {
    if (!force && token && exp > Date.now() + 60000) return token;
    const refresh = decrypt(link.refresh_token_enc);
    if (!refresh) throw new AuthError("No Google refresh token stored");
    const r = await refreshAccess(refresh);
    token = r.token; exp = r.expiresAt.getTime();
    await sb.from("google_calendar_links").update({ access_token_enc: encrypt(r.token), access_expires_at: r.expiresAt.toISOString() }).eq("org_id", link.org_id);
    return token;
  });
}

async function orgTz(sb: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await sb.from("organizations").select("booking_tz").eq("id", orgId).maybeSingle();
  return isValidTimeZone(data?.booking_tz) ? (data!.booking_tz as string) : "America/Chicago";
}

function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function markNeedsReconnect(sb: SupabaseClient, orgId: string, why: string): Promise<void> {
  const { data: flipped } = await sb.from("google_calendar_links")
    .update({ status: "needs_reconnect", last_error: why.slice(0, 300), sync_lock_until: null, updated_at: new Date().toISOString() })
    .eq("org_id", orgId).eq("status", "active").select("org_id");
  if (!flipped?.length) return; // already flagged: alert went out once
  try {
    const recipients = await resolveRecipients(sb, orgId, { managers: true, event: "none" });
    await dispatchNotifications(sb, {
      orgId, type: "job_scheduled", recipients, channels: { sms: false },
      title: "Google Calendar disconnected",
      body: "Google stopped letting Creed update your calendar. Reconnect it in Operations → Settings → Google Calendar.",
    });
  } catch { /* the Settings banner still shows it */ }
}

/** Keep a Google push channel open (renewed a day before it expires). Failing is fine: the cron still syncs every 10 minutes. */
async function ensureWatch(sb: SupabaseClient, link: LinkRow, api: GoogleApi, calendarId: string): Promise<void> {
  const origin = siteOrigin();
  if (!origin.startsWith("https://")) return;
  const exp = Date.parse(link.channel_expires_at || "") || 0;
  if (link.channel_id && link.calendar_id === calendarId && exp > Date.now() + 86400000) return;
  try {
    const id = randomUUID();
    const token = newNonce();
    const w = await api.watch(calendarId, id, token, `${origin}/api/gcal/webhook`, WATCH_TTL_SEC);
    await sb.from("google_calendar_links").update({
      channel_id: id, channel_resource_id: w.resourceId, channel_token_hash: sha256(token), channel_expires_at: new Date(w.expiration).toISOString(),
    }).eq("org_id", link.org_id);
    if (link.channel_id && link.channel_resource_id) await api.stopChannel(link.channel_id, link.channel_resource_id);
  } catch { /* cron fallback */ }
}

export type SyncOutcome =
  | { ok: true; result: SyncResult }
  | { ok: false; reason: "busy" | "not_connected" | "needs_reconnect" | "error"; message?: string };

export async function syncOrgById(orgId: string, sb: SupabaseClient = serviceClient()): Promise<SyncOutcome> {
  const now = new Date();
  const { data: locked, error: lockErr } = await sb.from("google_calendar_links")
    .update({ sync_lock_until: new Date(now.getTime() + LOCK_MS).toISOString() })
    .eq("org_id", orgId).eq("status", "active")
    .or(`sync_lock_until.is.null,sync_lock_until.lt.${now.toISOString()}`)
    .select("*");
  if (lockErr) return { ok: false, reason: "error", message: lockErr.message };
  const link = locked?.[0] as LinkRow | undefined;
  if (!link) {
    const { data } = await sb.from("google_calendar_links").select("status").eq("org_id", orgId).maybeSingle();
    if (!data) return { ok: false, reason: "not_connected" };
    return { ok: false, reason: data.status === "needs_reconnect" ? "needs_reconnect" : "busy" };
  }
  try {
    const tz = await orgTz(sb, orgId);
    const api = apiForLink(sb, link);
    const store = supabaseStore(sb, orgId);
    const result = await syncOrg({ orgId, store, api, tz, appUrl: siteOrigin(), today: todayIn(tz) });
    const cal = (await store.link()).calendar_id;
    if (cal) await ensureWatch(sb, link, api, cal);
    await sb.from("google_calendar_links").update({ last_synced_at: new Date().toISOString(), last_error: null, sync_lock_until: null }).eq("org_id", orgId);
    return { ok: true, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof AuthError) {
      await markNeedsReconnect(sb, orgId, msg);
      return { ok: false, reason: "needs_reconnect", message: msg };
    }
    await sb.from("google_calendar_links").update({ last_error: msg.slice(0, 300), sync_lock_until: null }).eq("org_id", orgId);
    return { ok: false, reason: "error", message: msg };
  }
}

/** Stop the push channel + revoke Google's grant + forget the link. The "Creed jobs" calendar stays in the person's Google account. */
export async function disconnectOrg(orgId: string, sb: SupabaseClient = serviceClient()): Promise<void> {
  const { data } = await sb.from("google_calendar_links").select("*").eq("org_id", orgId).maybeSingle();
  const link = data as LinkRow | null;
  if (link) {
    try {
      if (link.channel_id && link.channel_resource_id && link.status === "active") {
        await apiForLink(sb, link).stopChannel(link.channel_id, link.channel_resource_id);
      }
    } catch { /* */ }
    const refresh = decrypt(link.refresh_token_enc);
    if (refresh) await revokeToken(refresh);
  }
  await sb.from("google_calendar_events").delete().eq("org_id", orgId);
  await sb.from("google_calendar_links").delete().eq("org_id", orgId);
}

/** For the kick + webhook: sync now, and if a pass is already running, try again shortly so this change isn't left for the cron. */
export async function syncSoon(orgId: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const r = await syncOrgById(orgId);
    if (r.ok || r.reason !== "busy") return;
    await new Promise((res) => setTimeout(res, 8000));
  }
}
