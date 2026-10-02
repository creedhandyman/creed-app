import { createClient } from "@supabase/supabase-js";
import { isPlatformAdmin } from "./platform-admin";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

// Tables that don't have a created_at column
const NO_CREATED_AT = new Set(["time_entries"]);

// Tables that should NOT have org_id auto-injected
const NO_ORG_ID = new Set(["organizations", "profiles"]);

// Get current org_id from localStorage (avoids circular import with store)
function getOrgId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const user = JSON.parse(localStorage.getItem("c_user") || "null");
    return user?.org_id || null;
  } catch (err) {
    // Corrupted c_user entry — wipe it so login can rehydrate fresh.
    // eslint-disable-next-line no-console
    console.warn("[supabase] c_user localStorage corrupted, clearing:", err);
    try { localStorage.removeItem("c_user"); } catch { /* */ }
    return null;
  }
}

// Surface DB errors to the UI via a toast callback registered from the store.
// Using a window hook avoids a circular import between supabase.ts <-> store.ts.
function formatDbError(err: unknown): string {
  // PostgrestError extends Error in supabase-js v2 and carries extra fields
  // (code, hint, details). Surface those — without them the toast sometimes
  // collapses to a single generic line that doesn't help diagnose.
  if (err && typeof err === "object") {
    const e = err as { message?: string; details?: string | null; hint?: string | null; code?: string };
    if (e.message) {
      const parts = [e.message];
      if (e.code) parts.push(`(${e.code})`);
      if (e.hint) parts.push(`— hint: ${e.hint}`);
      if (e.details) parts.push(`— details: ${e.details}`);
      return parts.join(" ");
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Transient network errors fire when the browser aborts a request — most
 * commonly because the tab was backgrounded, the device went to sleep, or
 * there was a brief connectivity blip. They recover automatically on the
 * next interaction (which triggers loadAll again). Bernard hit the case
 * where coming back from app-switching surfaced a wall of red "TypeError:
 * Failed to fetch" toasts, one per parallel db.get call in loadAll. Those
 * aren't actionable — the user can't do anything except wait and the data
 * loads itself moments later.
 *
 * Real database errors (RLS denials, constraint violations, missing
 * columns) come back as PostgrestError with a `code` field — they're NOT
 * transient and SHOULD still toast loudly so Bernard catches them.
 */
function isTransientNetworkError(err: unknown): boolean {
  if (!err) return false;
  // PostgrestError has a code; if it does, this is a real server response,
  // not a transport failure.
  if (typeof err === "object" && err !== null && "code" in (err as object)) {
    const code = (err as { code?: string }).code;
    if (code) return false;
  }
  // Fetch's transport failure throws a TypeError with a small set of well-
  // known messages across browsers. AbortError fires when the request was
  // cancelled (background tab, page nav).
  if (err instanceof TypeError) {
    const msg = err.message || "";
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) return true;
  }
  if (err && typeof err === "object") {
    const e = err as { name?: string; message?: string };
    if (e.name === "AbortError") return true;
    if (e.message && /failed to fetch|networkerror|load failed|network request failed/i.test(e.message)) return true;
  }
  return false;
}

/**
 * Supabase auth-token expiry. While the app is backgrounded the access token
 * can lapse; supabase-js refreshes it when the tab becomes visible again, but
 * loadAll's parallel reads (the 15s poll + the resume refresh) can race AHEAD
 * of that refresh and come back 401 / "JWT expired" (PostgREST code PGRST301).
 * For READS this is transient — the next poll, after the refresh lands,
 * succeeds — so we treat it like a network blip (a quiet "Syncing…") instead
 * of a wall of red "load addresses failed" toasts on every return-to-app.
 * Writes still surface loudly: a failed save is real and the user must retry.
 */
function isAuthExpiryError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; status?: number; __isAuthError?: boolean };
  if (e.code === "PGRST301") return true;       // PostgREST: JWT expired / invalid
  if (e.status === 401) return true;
  if (e.__isAuthError) return true;             // supabase-js GoTrue errors
  const m = (e.message || "").toLowerCase();
  return /jwt (expired|is expired|invalid)|token (has )?expired|expired.*token|invalid (jwt|token|claim)/.test(m);
}

// Debounce the "Syncing data…" indicator so the parallel db.get calls
// in loadAll don't fire a toast each when the whole batch fails together.
let lastSyncToastAt = 0;

function reportDbError(table: string, op: string, err: unknown) {
  // Auth-token expiry on the resume poll is transient for READS only — it
  // self-heals once supabase-js refreshes the session. Failed writes still
  // toast loudly so the user knows their action didn't save.
  const transient = isTransientNetworkError(err) || (op === "load" && isAuthExpiryError(err));
  // eslint-disable-next-line no-console
  console[transient ? "warn" : "error"](`[db] ${op} ${table} failed${transient ? " (transient — will retry on next interaction)" : ""}:`, err);
  if (typeof window === "undefined") return;
  const toast = (window as unknown as { __dbToast?: (m: string, t: "error" | "info") => void }).__dbToast;
  if (!toast) return;
  // A WRITE that dies on the network did not save — say so plainly. (The
  // quiet "Syncing…" below is only true for reads, which the next poll
  // retries; nothing retries a lost write except the user.)
  if (op !== "load" && isTransientNetworkError(err)) {
    toast("No connection — that change didn't save. Try again when you have signal.", "error");
    return;
  }
  if (transient) {
    const now = Date.now();
    if (now - lastSyncToastAt < 5000) return; // debounce
    lastSyncToastAt = now;
    toast("Syncing data…", "info");
    return;
  }
  // Customers get plain words; the platform operator keeps the full Postgres
  // detail (that's how a missing migration — "column … does not exist" — gets
  // noticed). The raw error is always in the console either way.
  const msg = formatDbError(err);
  if (isOperator()) {
    toast(`${op} ${table} failed: ${msg}`, "error");
    return;
  }
  const code = (err as { code?: string } | null)?.code;
  toast(
    op === "load"
      ? "Couldn't load some of your data — it'll retry on its own in a few seconds."
      : `Couldn't save that change — please try again.${code ? ` If it keeps happening, contact support (code ${code}).` : ""}`,
    "error",
  );
}

/** The signed-in user is a Creed platform operator (reads the persisted
 *  profile — this module can't import the store without a cycle). */
function isOperator(): boolean {
  try {
    const u = JSON.parse(localStorage.getItem("c_user") || "null") as { email?: string } | null;
    return isPlatformAdmin(u?.email);
  } catch {
    return false;
  }
}

export const db = {
  get: async <T = Record<string, unknown>>(
    table: string,
    filters?: Record<string, unknown>,
    // `strict` rethrows on error (no toast) so a caller like loadAll can tell a
    // FAILED fetch apart from a genuinely empty table — the default swallows
    // and returns [] as before.
    options?: { limit?: number; strict?: boolean }
  ): Promise<T[]> => {
    try {
      let query = supabase.from(table).select("*");
      if (!NO_CREATED_AT.has(table)) {
        query = query.order("created_at", { ascending: false });
      }
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          query = query.eq(key, value);
        }
      }
      if (options?.limit) query = query.limit(options.limit);
      const { data, error } = await query;
      if (error) throw error;
      return (data as T[]) || [];
    } catch (err) {
      if (options?.strict) throw err;
      reportDbError(table, "load", err);
      return [];
    }
  },

  post: async <T = Record<string, unknown>>(
    table: string,
    row: Record<string, unknown>
  ): Promise<T[] | null> => {
    try {
      // Strip explicit `undefined` keys so the request body is clean — most
      // dialects ignore them, but it removes noise from network traces and
      // avoids any chance of an undefined-vs-null mismatch downstream.
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        if (v !== undefined) data[k] = v;
      }
      // Auto-inject org_id if not already set.
      if (!NO_ORG_ID.has(table) && !data.org_id) {
        const orgId = getOrgId();
        if (orgId) data.org_id = orgId;
      }
      const { data: result, error } = await supabase.from(table).insert(data as never).select();
      if (error) throw error;
      // Some RLS configs let inserts succeed but return an empty result from
      // the trailing SELECT (no SELECT policy for the anon role). Return an
      // empty array in that case so callers can decide whether to refetch
      // — null is reserved for actual errors.
      return (result as T[]) ?? [];
    } catch (err) {
      reportDbError(table, "insert", err);
      return null;
    }
  },

  /** Resolves true when the write landed, false when it failed (already
   *  toasted). Callers that move on after saving (clear a draft, navigate,
   *  show success) must check it. */
  patch: async (
    table: string,
    id: string,
    updates: Record<string, unknown>
  ): Promise<boolean> => {
    try {
      const { error } = await supabase.from(table).update(updates).eq("id", id);
      if (error) throw error;
      return true;
    } catch (err) {
      reportDbError(table, "update", err);
      return false;
    }
  },

  del: async (table: string, id: string): Promise<void> => {
    try {
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
    } catch (err) {
      reportDbError(table, "delete", err);
    }
  },
};
