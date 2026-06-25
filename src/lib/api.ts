// Client helper: same-origin fetch that attaches the logged-in user's Supabase
// JWT as `Authorization: Bearer <token>`. Use this (instead of bare fetch) for
// any POST to a protected /api/* route so the server can authenticate the call.
//
// Public/customer-facing pages that have no Supabase session (e.g. the /status
// pay page) should keep using plain fetch — those routes are secured
// server-side instead, not by a user JWT.
import { supabase } from "./supabase";

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let token: string | undefined;
  try {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token;
  } catch {
    // No session available — fall through; the server will reject with 401.
  }
  const headers = new Headers(init.headers || {});
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  // Best-effort org tag for server-side usage logging (ignored by other routes).
  if (!headers.has("x-creed-org")) {
    try {
      const orgId = JSON.parse(localStorage.getItem("c_user") || "{}")?.org_id;
      if (orgId) headers.set("x-creed-org", String(orgId));
    } catch {
      /* no localStorage / not logged in — skip */
    }
  }
  return fetch(input, { ...init, headers });
}

/**
 * Build a customer-facing /status link for a job, carrying a server-signed
 * approval token so only the customer who was sent the link can approve the
 * quote. Falls back to an untokenized link if the token can't be minted — the
 * link still works for viewing status; only the approve action needs the token.
 */
export async function getStatusLink(jobId: string): Promise<string> {
  const base = `${window.location.origin}/status?job=${jobId}`;
  try {
    const res = await apiFetch("/api/status-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.token) return `${base}&t=${encodeURIComponent(data.token)}`;
  } catch {
    // fall through to the plain link
  }
  return base;
}
