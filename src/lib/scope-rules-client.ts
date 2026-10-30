import { supabase } from "./supabase";
import type { ScopeRule } from "./scope-rules";

/** Loads the shared + own-org scope rules once per page load. Silent on any
 *  failure (table missing, offline): the scope check is a helper, so quotes
 *  must work exactly as before without it. Reads go through RLS — shared
 *  defaults plus this org's own rules. */
let cached: Promise<ScopeRule[]> | null = null;

export function loadScopeRules(): Promise<ScopeRule[]> {
  if (!cached) {
    cached = (async () => {
      try {
        const { data, error } = await supabase.from("scope_rules").select("*").eq("active", true);
        if (error || !Array.isArray(data)) { cached = null; return []; }
        // numeric columns can arrive as strings — the card calls toFixed on these
        return (data as ScopeRule[]).map((r) => ({ ...r, labor_hours: Number(r.labor_hours) || 0 }));
      } catch {
        cached = null;
        return [];
      }
    })();
  }
  return cached;
}
