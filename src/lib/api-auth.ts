// Server-only auth + safety helpers for API route handlers.
//
// The app authenticates users with Supabase Auth (store.ts signInWithPassword),
// so the client holds a real JWT (supabase.auth.getSession().access_token). These
// helpers let a route REQUIRE that JWT instead of being open to the internet —
// the same validation pattern payroll/auto-run's isOwnerSession already uses.
import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Anon client used ONLY to validate a caller's JWT via GoTrue (auth.getUser).
// No table data is read with it, so RLS/anon grants are irrelevant here.
const authClient: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export interface AuthedUser {
  userId: string;
  email: string | null;
}

function bearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  const tok = m ? m[1].trim() : null;
  if (!tok) return null;
  // The cron secret is a shared secret, not a user JWT — never accept it here.
  if (tok === process.env.CRON_SECRET) return null;
  return tok;
}

/** Validate the caller's Supabase session JWT. Returns null if missing/invalid. */
export async function getAuthedUser(req: NextRequest): Promise<AuthedUser | null> {
  const token = bearer(req);
  if (!token) return null;
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return null;
  return { userId: data.user.id, email: data.user.email ?? null };
}

/**
 * Guard for "must be a logged-in user" routes. Returns the user, or a 401
 * NextResponse the caller should return immediately:
 *   const auth = await requireAuth(req);
 *   if (auth instanceof NextResponse) return auth;
 *   // ...use auth.userId
 */
export async function requireAuth(req: NextRequest): Promise<AuthedUser | NextResponse> {
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return user;
}

export interface AuthedProfile extends AuthedUser {
  orgId: string | null;
  role: string | null;
}

/**
 * Like getAuthedUser but also resolves the caller's org + role from `profiles`
 * (via the service role, so it works regardless of RLS).
 */
export async function getAuthedProfile(req: NextRequest): Promise<AuthedProfile | null> {
  const user = await getAuthedUser(req);
  if (!user) return null;
  const { data } = await serviceClient()
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.userId)
    .maybeSingle();
  const p = data as { org_id?: string | null; role?: string | null } | null;
  return { ...user, orgId: p?.org_id ?? null, role: p?.role ?? null };
}

/**
 * Guard for owner/manager-only routes. Returns the profile (orgId guaranteed
 * present) or a 401/403 NextResponse to return immediately.
 */
export async function requireOwner(req: NextRequest): Promise<AuthedProfile | NextResponse> {
  const prof = await getAuthedProfile(req);
  if (!prof) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (prof.role !== "owner" && prof.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!prof.orgId) return NextResponse.json({ error: "No organization on profile" }, { status: 403 });
  return prof;
}

/**
 * Service-role client for routes that must bypass RLS (cron, customer-facing
 * flows, cross-org server work). Fails CLOSED — throws if the key is absent
 * rather than silently downgrading to the anon key.
 */
export function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
}

/**
 * SSRF guard for routes that fetch a client-supplied image URL. Only our own
 * Supabase Storage host over https is allowed — blocks cloud-metadata,
 * localhost, and arbitrary internal targets.
 */
export function isSupabaseStorageUrl(raw: unknown): boolean {
  if (typeof raw !== "string" || !raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    return u.host === new URL(SUPABASE_URL).host;
  } catch {
    return false;
  }
}
