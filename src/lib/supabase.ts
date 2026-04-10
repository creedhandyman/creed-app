import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

export const db = {
  get: async <T = Record<string, unknown>>(
    table: string,
    filters?: Record<string, unknown>
  ): Promise<T[]> => {
    try {
      let query = supabase.from(table).select("*");
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          query = query.eq(key, value);
        }
      }
      // Try ordering by created_at; if it fails, retry without ordering
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) {
        const retry = supabase.from(table).select("*");
        if (filters) {
          for (const [key, value] of Object.entries(filters)) {
            retry.eq(key, value);
          }
        }
        const { data: d2 } = await retry;
        return (d2 as T[]) || [];
      }
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
      const { data, error } = await supabase.from(table).insert(row as never).select();
      if (error) throw error;
      return data as T[];
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
