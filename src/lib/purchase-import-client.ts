/**
 * Supabase side of the store purchase price import (lib/purchase-import.ts
 * has the rules). Reads: the org's current prices for the products in a file,
 * and every customer spec item (to match). Writes, only after the owner
 * confirms the review: price history (append, de-duplicated by line_hash),
 * current prices (upsert per product), and the matched spec items' prices.
 * Until 20261119_store_purchase_prices.sql has run, `missing` is true and the
 * review says it can't save yet.
 */
import { supabase, getOrgId } from "./supabase";
import { useStore } from "./store";
import { isMissingTable } from "./material-spec-client";
import type { SpecPriceTarget, StoredPrice } from "./purchase-import";

const toast = (msg: string) => useStore.getState().showToast(msg, "error");
const missingColumn = (err: { code?: string; message?: string } | null) =>
  !!err && (err.code === "42703" || err.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(err.message || ""));

/** Current prices on file for these products. */
export async function loadStoredPrices(keys: string[]): Promise<{ prices: StoredPrice[]; missing: boolean }> {
  const prices: StoredPrice[] = [];
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await supabase
      .from("material_prices").select("product_key, unit_price, purchased_on").in("product_key", keys.slice(i, i + 200));
    if (error) return { prices: [], missing: isMissingTable(error) };
    for (const r of (data || []) as Array<{ product_key: string; unit_price: number | string; purchased_on: string | null }>) {
      prices.push({ product_key: r.product_key, unit_price: Number(r.unit_price), purchased_on: r.purchased_on });
    }
  }
  return { prices, missing: false };
}

/** Every spec item in the org, with its spec + customer name for the review.
 *  [] when specs aren't set up. Works before the price columns exist (then
 *  no item has a price date). */
export async function loadSpecTargets(): Promise<SpecPriceTarget[]> {
  try {
    const { data: specs, error: e1 } = await supabase.from("material_specs").select("id, name, customer_id");
    if (e1 || !Array.isArray(specs) || !specs.length) return [];
    const specRows = specs as Array<{ id: string; name: string; customer_id: string }>;
    const cols = "id, spec_id, name, brand, model, sku, store, unit, unit_price";
    const ids = specRows.map((s) => s.id);
    const read = async (select: string) => {
      const r = await supabase.from("material_spec_items").select(select).in("spec_id", ids).limit(5000);
      return { data: r.data as unknown, error: r.error };
    };
    let res = await read(`${cols}, price_updated_at`);
    if (res.error && missingColumn(res.error)) res = await read(cols);
    if (res.error || !Array.isArray(res.data)) return [];
    const customers = new Map(useStore.getState().customers.map((c) => [c.id, c.name]));
    const specById = new Map(specRows.map((s) => [s.id, s]));
    return (res.data as Array<Record<string, unknown>>).map((r) => {
      const spec = specById.get(String(r.spec_id));
      const price = r.unit_price === null || r.unit_price === undefined ? null : Number(r.unit_price);
      return {
        id: String(r.id),
        name: String(r.name || ""),
        brand: (r.brand as string) || null,
        model: (r.model as string) || null,
        sku: (r.sku as string) || null,
        store: (r.store as string) || null,
        unit: (r.unit as string) || null,
        unit_price: price !== null && Number.isFinite(price) ? price : null,
        price_updated_at: (r.price_updated_at as string) || null,
        spec_name: spec?.name,
        customer_name: spec ? customers.get(spec.customer_id) : undefined,
      };
    });
  } catch {
    return [];
  }
}

export interface SaveResult { history: number; prices: number; specItems: number; ok: boolean }

/**
 * Write a confirmed import. Order: history, then current prices, then spec
 * items. Stops (and toasts) at the first failure; returns what landed.
 */
export async function savePurchaseImport(input: {
  history: Record<string, unknown>[];
  prices: Record<string, unknown>[];
  spec: Array<{ id: string; patch: Record<string, unknown> }>;
}): Promise<SaveResult> {
  const out: SaveResult = { history: 0, prices: 0, specItems: 0, ok: false };
  const orgId = getOrgId();
  if (!orgId) { toast("No business on this account."); return out; }

  for (let i = 0; i < input.history.length; i += 300) {
    const chunk = input.history.slice(i, i + 300).map((r) => ({ ...r, org_id: orgId }));
    const { error } = await supabase.from("material_price_history").upsert(chunk, { onConflict: "org_id,line_hash", ignoreDuplicates: true });
    if (error) { toast(`Couldn't save the purchase history: ${error.message}`); return out; }
    out.history += chunk.length;
  }
  for (let i = 0; i < input.prices.length; i += 300) {
    const chunk = input.prices.slice(i, i + 300).map((r) => ({ ...r, org_id: orgId }));
    const { error } = await supabase.from("material_prices").upsert(chunk, { onConflict: "org_id,product_key" });
    if (error) { toast(`Saved the history, then the prices failed: ${error.message}`); return out; }
    out.prices += chunk.length;
  }
  for (const s of input.spec) {
    let { error } = await supabase.from("material_spec_items").update(s.patch).eq("id", s.id);
    if (error && missingColumn(error)) {
      // Price-date columns not there yet: still refresh the price itself.
      const { price_updated_at: _a, price_source: _b, ...rest } = s.patch;
      void _a; void _b;
      ({ error } = await supabase.from("material_spec_items").update(rest).eq("id", s.id));
    }
    if (error) { toast(`Couldn't update a spec item: ${error.message}`); return out; }
    out.specItems += 1;
  }
  out.ok = true;
  return out;
}

/** Latest store prices for quoting (newest purchase first). Never throws. */
export async function loadLatestStorePrices(limit = 1500): Promise<Array<{
  description: string; store: string | null; unit_price: number; purchased_on: string | null;
}>> {
  try {
    const { data, error } = await supabase
      .from("material_prices").select("description, store, unit_price, purchased_on")
      .order("purchased_on", { ascending: false, nullsFirst: false }).limit(limit);
    if (error || !Array.isArray(data)) return [];
    return (data as Array<{ description: string; store: string | null; unit_price: number | string; purchased_on: string | null }>)
      .map((r) => ({ ...r, unit_price: Number(r.unit_price) }))
      .filter((r) => Number.isFinite(r.unit_price) && r.unit_price > 0);
  } catch {
    return [];
  }
}
