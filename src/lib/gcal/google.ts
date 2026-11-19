/**
 * Google OAuth + Calendar API over plain fetch (server only). The scope is
 * calendar.app.created: Creed can make its own "Creed jobs" calendar and
 * manage the events on it, and sees nothing else in the person's Google
 * account. A refresh token Google refuses (revoked, expired, password
 * change) raises AuthError → the business is marked "needs reconnect".
 */
import { siteOrigin } from "../site-url";
import { AuthError, GoogleError, type Api } from "./engine";
import type { EventBody, GEvent } from "./core";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const CAL = "https://www.googleapis.com/calendar/v3";
export const GCAL_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.app.created"];

export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const redirectUri = () => `${siteOrigin()}/api/gcal/callback`;

export function authUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GCAL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // always hand back a refresh token, also on reconnect
    include_granted_scopes: "false",
    state,
  });
  return `${AUTH_URL}?${q}`;
}

interface TokenResponse { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; scope?: string; error?: string; error_description?: string }

async function tokenCall(params: Record<string, string>): Promise<TokenResponse> {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "", ...params }),
  });
  const j = (await r.json().catch(() => ({}))) as TokenResponse;
  if (!r.ok || j.error) {
    if (j.error === "invalid_grant" || j.error === "unauthorized_client" || j.error === "invalid_client") {
      throw new AuthError(`Google refused the connection (${j.error})`);
    }
    throw new GoogleError(r.status || 500, j.error_description || j.error || `token ${r.status}`);
  }
  return j;
}

export const exchangeCode = (code: string) => tokenCall({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });

export async function refreshAccess(refreshToken: string): Promise<{ token: string; expiresAt: Date }> {
  const j = await tokenCall({ grant_type: "refresh_token", refresh_token: refreshToken });
  if (!j.access_token) throw new AuthError("Google returned no access token");
  return { token: j.access_token, expiresAt: new Date(Date.now() + (j.expires_in || 3600) * 1000) };
}

/** The id_token came straight from Google's token endpoint over TLS, so its payload is read without a signature check. */
export function emailFromIdToken(idToken?: string): string | null {
  try {
    const p = JSON.parse(Buffer.from((idToken || "").split(".")[1] || "", "base64url").toString("utf8")) as { email?: string };
    return p.email || null;
  } catch {
    return null;
  }
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) }).catch(() => {});
}

export interface GoogleApi extends Api {
  watch(calendarId: string, channelId: string, token: string, address: string, ttlSec: number): Promise<{ resourceId: string; expiration: number }>;
  stopChannel(channelId: string, resourceId: string): Promise<void>;
}

/** Calendar API with a token supplier; `getToken(true)` forces a refresh after a 401. */
export function googleApi(getToken: (force?: boolean) => Promise<string>): GoogleApi {
  async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(`${CAL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${await getToken(attempt > 0)}`, ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.status === 401 && attempt === 0) continue;
      if (r.status === 204) return undefined as T;
      const j = (await r.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[]; status?: string } };
      if (r.ok) return j as T;
      const reason = j.error?.errors?.[0]?.reason || j.error?.status || "";
      if (r.status === 401 || /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|authError/i.test(reason)) {
        throw new AuthError(j.error?.message || "Google access was revoked");
      }
      throw new GoogleError(r.status, j.error?.message || `Google ${r.status}`);
    }
    throw new AuthError("Google access was revoked");
  }
  const cal = (id: string) => `/calendars/${encodeURIComponent(id)}`;

  return {
    async calendarExists(id) {
      try { await call("GET", cal(id)); return true; } catch (e) {
        if (e instanceof GoogleError && (e.status === 404 || e.status === 410)) return false;
        throw e;
      }
    },
    async createCalendar(name, tz) {
      const c = await call<{ id: string }>("POST", "/calendars", {
        summary: name, timeZone: tz,
        description: "Jobs from Creed. Move or delete an event here and Creed follows; edit the job itself in Creed.",
      });
      return c.id;
    },
    async listEvents(calendarId, syncToken) {
      const items: GEvent[] = [];
      let pageToken: string | undefined;
      let nextSyncToken: string | null = null;
      for (let i = 0; i < 40; i++) {
        const q = new URLSearchParams({ maxResults: "250", singleEvents: "false" });
        if (syncToken) q.set("syncToken", syncToken);
        if (pageToken) q.set("pageToken", pageToken);
        const page = await call<{ items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string }>("GET", `${cal(calendarId)}/events?${q}`);
        items.push(...(page.items || []));
        pageToken = page.nextPageToken;
        if (page.nextSyncToken) nextSyncToken = page.nextSyncToken;
        if (!pageToken) break;
      }
      return { items, nextSyncToken };
    },
    insertEvent: (calendarId, body) => call<GEvent>("POST", `${cal(calendarId)}/events`, body),
    patchEvent: (calendarId, eventId, body: EventBody, ifMatch) =>
      call<GEvent>("PATCH", `${cal(calendarId)}/events/${encodeURIComponent(eventId)}`, body, ifMatch ? { "If-Match": ifMatch } : {}),
    async deleteEvent(calendarId, eventId) {
      await call("DELETE", `${cal(calendarId)}/events/${encodeURIComponent(eventId)}`);
    },
    async watch(calendarId, channelId, token, address, ttlSec) {
      const r = await call<{ resourceId: string; expiration?: string }>("POST", `${cal(calendarId)}/events/watch`, {
        id: channelId, type: "web_hook", address, token, params: { ttl: String(ttlSec) },
      });
      return { resourceId: r.resourceId, expiration: Number(r.expiration) || Date.now() + ttlSec * 1000 };
    },
    async stopChannel(channelId, resourceId) {
      await call("POST", "/channels/stop", { id: channelId, resourceId }).catch(() => {});
    },
  };
}
