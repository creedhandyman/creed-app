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
  } catch {
    return null;
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
    } catch {
      return [];
    }
  },

  post: async <T = Record<string, unknown>>(
    table: string,
    row: Record<string, unknown>
  ): Promise<T[] | null> => {
    try {
      // Auto-inject org_id if not already set
      const data = { ...row };
      if (!NO_ORG_ID.has(table) && !data.org_id) {
        const orgId = getOrgId();
        if (orgId) data.org_id = orgId;
      }
      const { data: result, error } = await supabase.from(table).insert(data as never).select();
      if (error) throw error;
      return result as T[];
    } catch {
      return null;
    }
  },

  patch: async (
    table: string,
    id: string,
    updates: Record<string, unknown>
  ): Promise<void> => {
    try {
      await supabase.from(table).update(updates).eq("id", id);
    } catch {
      // silent fail
    }
  },

  del: async (table: string, id: string): Promise<void> => {
    try {
      await supabase.from(table).delete().eq("id", id);
    } catch {
      // silent fail
    }
  },
};
