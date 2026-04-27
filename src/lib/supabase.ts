import { createClient } from "@supabase/supabase-js";

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

function reportDbError(table: string, op: string, err: unknown) {
  const msg = formatDbError(err);
  // eslint-disable-next-line no-console
  console.error(`[db] ${op} ${table} failed:`, err);
  if (typeof window !== "undefined") {
    const toast = (window as unknown as { __dbToast?: (m: string, t: "error") => void }).__dbToast;
    if (toast) toast(`${op} ${table} failed: ${msg}`, "error");
  }
}

export const db = {
  get: async <T = Record<string, unknown>>(
    table: string,
    filters?: Record<string, unknown>
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
      const { data, error } = await query;
      if (error) throw error;
      return (data as T[]) || [];
    } catch (err) {
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

  patch: async (
    table: string,
    id: string,
    updates: Record<string, unknown>
  ): Promise<void> => {
    try {
      const { error } = await supabase.from(table).update(updates).eq("id", id);
      if (error) throw error;
    } catch (err) {
      reportDbError(table, "update", err);
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
