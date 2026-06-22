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
  return fetch(input, { ...init, headers });
}
