/**
 * Supabase side of per-customer material specs (lib/material-spec.ts holds
 * the rules). Reads go through RLS (whole org can read); writes need
 * owner/manager (RLS enforces it). Until the migration
 * 20261117_customer_material_specs.sql has run, every read returns
 * "missing" quietly and quotes work exactly as before.
 */
import { supabase, getOrgId } from "./supabase";
import { normalizeSpecItems, type SpecItem } from "./material-spec";
import { draftToRow, type SpecDraft } from "./spec-import";
import { useStore } from "./store";

export interface MaterialSpec {
  id: string;
  org_id: string;
  customer_id: string;
  name: string;
  active: boolean;
  source: string | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Postgres / PostgREST "table not there yet". */
export function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "PGRST205" || /does not exist|could not find the table/i.test(err.message || "");
}

const toast = (msg: string) => useStore.getState().showToast(msg, "error");

/** A customer's specs (active and not), newest first. */
export async function listSpecs(customerId: string): Promise<{ specs: MaterialSpec[]; missing: boolean }> {
  const { data, error } = await supabase
    .from("material_specs").select("*").eq("customer_id", customerId).order("created_at", { ascending: false });
  if (error) return { specs: [], missing: isMissingTable(error) };
  return { specs: (data || []) as MaterialSpec[], missing: false };
}

/** Item counts per spec id. */
export async function specItemCounts(specIds: string[]): Promise<Record<string, number>> {
  if (!specIds.length) return {};
  const { data, error } = await supabase.from("material_spec_items").select("spec_id").in("spec_id", specIds);
  if (error || !Array.isArray(data)) return {};
  const out: Record<string, number> = {};
  for (const r of data as Array<{ spec_id: string }>) out[r.spec_id] = (out[r.spec_id] || 0) + 1;
  return out;
}

export async function loadSpecItems(specIds: string[]): Promise<SpecItem[]> {
  if (!specIds.length) return [];
  const { data, error } = await supabase
    .from("material_spec_items").select("*").in("spec_id", specIds)
    .order("sort", { ascending: true }).limit(2000);
  if (error || !Array.isArray(data)) return [];
  return normalizeSpecItems(data);
}

/** Every item of the customer's ACTIVE specs — what quoting uses. Never
 *  throws; [] when there is no customer, no spec, or no tables yet. */
export async function loadCustomerSpec(customerId: string | null | undefined): Promise<SpecItem[]> {
  if (!customerId) return [];
  try {
    const { data, error } = await supabase
      .from("material_specs").select("id").eq("customer_id", customerId).eq("active", true);
    if (error || !Array.isArray(data) || !data.length) return [];
    return await loadSpecItems((data as Array<{ id: string }>).map((s) => s.id));
  } catch {
    return [];
  }
}

export async function createSpec(customerId: string, name: string, source: string | null): Promise<MaterialSpec | null> {
  const orgId = getOrgId();
  if (!orgId) { toast("No business on this account."); return null; }
  const { data, error } = await supabase
    .from("material_specs")
    .insert({ org_id: orgId, customer_id: customerId, name: name.trim() || "Material spec", source, active: true })
    .select().maybeSingle();
  if (error || !data) { toast(isMissingTable(error) ? "Material specs aren't set up on the database yet." : `Couldn't create the spec: ${error?.message || "unknown error"}`); return null; }
  return data as MaterialSpec;
}

export async function updateSpec(id: string, patch: Partial<Pick<MaterialSpec, "name" | "active" | "notes" | "source">>): Promise<boolean> {
  const { error } = await supabase.from("material_specs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) { toast(`Couldn't save: ${error.message}`); return false; }
  return true;
}

export async function deleteSpec(id: string): Promise<boolean> {
  const { error } = await supabase.from("material_specs").delete().eq("id", id);
  if (error) { toast(`Couldn't delete: ${error.message}`); return false; }
  return true;
}

/**
 * Save reviewed drafts into a spec. mode "replace" removes the spec's
 * current items first. Inserts in chunks; resolves the number saved (a
 * failed chunk toasts and stops).
 */
export async function saveDrafts(spec: MaterialSpec, drafts: SpecDraft[], mode: "add" | "replace"): Promise<number> {
  if (mode === "replace") {
    const { error } = await supabase.from("material_spec_items").delete().eq("spec_id", spec.id);
    if (error) { toast(`Couldn't replace the old items: ${error.message}`); return 0; }
  }
  let start = 0;
  if (mode === "add") {
    const { count } = await supabase.from("material_spec_items").select("id", { count: "exact", head: true }).eq("spec_id", spec.id);
    start = count || 0;
  }
  let saved = 0;
  for (let i = 0; i < drafts.length; i += 200) {
    const rows = drafts.slice(i, i + 200).map((d, k) => draftToRow(d, spec.org_id, spec.id, start + i + k));
    const { error } = await supabase.from("material_spec_items").insert(rows);
    if (error) { toast(`Saved ${saved} items, then it failed: ${error.message}`); break; }
    saved += rows.length;
  }
  await updateSpec(spec.id, {});
  return saved;
}

/** Edit one item. Only the editable fields are sent. */
export async function updateSpecItem(id: string, d: Partial<SpecDraft>): Promise<boolean> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(d)) if (v !== undefined) patch[k] = v;
  const { error } = await supabase.from("material_spec_items").update(patch).eq("id", id);
  if (error) { toast(`Couldn't save the item: ${error.message}`); return false; }
  return true;
}

export async function deleteSpecItem(id: string): Promise<boolean> {
  const { error } = await supabase.from("material_spec_items").delete().eq("id", id);
  if (error) { toast(`Couldn't delete the item: ${error.message}`); return false; }
  return true;
}
