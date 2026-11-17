/**
 * Website lead → AI draft quote, server-side, right after the lead lands
 * (/api/leads runs it with `after()`). Same engine as QuoteForge's Quick Quote
 * — aiParsePdf with this org's learned pricing + labor calibration — fed the
 * customer's description and photos. The draft is NOT a quote yet: it's
 * stored on the lead's rooms blob as `leadDraft` ({v, rooms, estDays, total,
 * at}); "Build Quote" opens it in the editor instantly, and only Save/Send
 * turns the lead into a quote. Owners/managers get a "Grizz drafted a quote ·
 * $X" alert. Best-effort throughout: any failure just leaves the lead as it
 * was (Build Quote then runs the AI on the phone, like before).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Room } from "./types";
import { aiParsePdf, validateQuote, calculateCost, extractZip, type ParserDeps } from "./parser";
import { normalizeSpecItems, type SpecItem } from "./material-spec";
import { callClaude } from "./anthropic-server";
import { rateForRoom, billedMaterial, priceCascade, pricingInputs } from "./pricing";
import { materialTaxFor } from "./material-tax";
import { dispatchNotifications } from "./notify-server";
import { tryReadBlob } from "./job-blob";

/** Most AI drafts per business per day — a public form can't run up the bill.
 *  Counts ATTEMPTS (the `leadDraftTry` stamp written before the AI call), not
 *  finished drafts: a burst of leads used to all pass the check while their
 *  drafts were still running, and a failed draft never counted at all. */
export const DRAFTS_PER_DAY = 25;

export interface DraftOrg {
  default_rate?: number | null;
  trade_rates?: string | null;
  markup_pct?: number | null;
  tax_pct?: number | null;
  tax_mode?: string | null;
  trip_fee?: number | null;
  min_labor_hours?: number | null;
  material_tax_pct?: number | null;
  material_tax_by_zip?: unknown;
}

/**
 * The quote total QuoteForge would show for these rooms with the org's
 * defaults (no per-quote overrides yet): per-room rate, materials + purchase
 * tax + markup, then the shared min-labor → trip fee → tax cascade.
 */
export function draftTotal(rooms: Room[], org: DraftOrg, property: string): number {
  return draftTotals(rooms, org, property).total;
}

/** The same math, with the labor / materials / hours that make up the total
 *  (what the lead's Money card shows before the draft is saved as a quote). */
export function draftTotals(rooms: Room[], org: DraftOrg, property: string): { total: number; labor: number; materials: number; hours: number } {
  const p = pricingInputs(org); // same org-settings rules as QuoteForge + the printed quote
  const { defaultRate, markupPct } = p;
  const tradeRates = p.tradeRates ?? {};
  const materialTaxPct = materialTaxFor(org as Parameters<typeof materialTaxFor>[0], extractZip(property)).rate;
  let laborRaw = 0, hoursRaw = 0, materials = 0, subtotalRaw = 0;
  for (const r of rooms) {
    const rate = rateForRoom(r.name, { defaultRate, tradeRates });
    for (const it of r.items) {
      const c = calculateCost(it, rate);
      const mc = billedMaterial(c.mc, { materialTaxPct, markupPct });
      laborRaw += c.lc; hoursRaw += it.laborHrs; materials += mc;
      subtotalRaw += Math.round((c.lc + mc) * 100) / 100;
    }
  }
  const c = priceCascade({
    laborRaw, hoursRaw, materials, rate: defaultRate,
    minHrs: p.minHrs,
    tripFee: p.tripFee,
    discount: null,
    taxPct: p.taxPct,
    taxMode: p.taxMode,
    subtotalRaw,
  });
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { total: c.grandTotal, labor: r2(c.tl), materials: r2(materials), hours: r2(c.th) };
}

/** Active spec items of one customer, read with the service role. Silent:
 *  [] on no customer, no spec, or no tables yet. */
async function loadSpecForCustomer(supabase: SupabaseClient, orgId: string, customerId: string | null | undefined): Promise<SpecItem[]> {
  if (!customerId) return [];
  try {
    const { data: specs } = await supabase.from("material_specs").select("id")
      .eq("org_id", orgId).eq("customer_id", customerId).eq("active", true);
    const ids = (specs || []).map((s: { id: string }) => s.id);
    if (!ids.length) return [];
    const { data: items } = await supabase.from("material_spec_items").select("*")
      .eq("org_id", orgId).in("spec_id", ids).order("sort", { ascending: true }).limit(2000);
    return normalizeSpecItems(items || []);
  } catch {
    return [];
  }
}

export async function draftLeadQuote(supabase: SupabaseClient, lead: {
  orgId: string; jobId: string; description: string; photos: string[]; property: string; client: string;
}): Promise<{ ok: boolean; reason?: string; total?: number }> {
  const { orgId, jobId } = lead;
  const images = lead.photos.filter((p) => /^https:\/\//.test(p)).slice(0, 10);
  if (lead.description.trim().length < 8 && !images.length) return { ok: false, reason: "too little to quote" };

  const { data: org } = await supabase.from("organizations")
    .select("default_rate, trade_rates, licensed_trades, markup_pct, tax_pct, tax_mode, trip_fee, min_labor_hours, material_tax_pct, material_tax_by_zip")
    .eq("id", orgId).maybeSingle();
  if (!org) return { ok: false, reason: "no org" };

  // Only an untouched lead gets a draft — checked BEFORE the AI is paid for.
  const { data: first } = await supabase.from("jobs").select("status, rooms, customer_id").eq("id", jobId).maybeSingle();
  if (!first || first.status !== "lead") return { ok: false, reason: "lead moved on" };
  const firstBlob = tryReadBlob(first.rooms) || {};
  if (Array.isArray(firstBlob.rooms) && firstBlob.rooms.length) return { ok: false, reason: "already quoted" };

  // Daily cap per business. Stamp this attempt FIRST, then count every
  // attempt in the last day (this one included), so a burst of leads arriving
  // together can't all slip under the cap. `"leadDraft` also matches the
  // finished drafts made before the stamp existed.
  firstBlob.leadDraftTry = new Date().toISOString();
  await supabase.from("jobs").update({ rooms: JSON.stringify(firstBlob) }).eq("id", jobId).eq("status", "lead");
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await supabase.from("jobs").select("id", { count: "exact", head: true })
    .eq("org_id", orgId).gte("created_at", since).like("rooms", "%\"leadDraft%");
  if ((count || 0) > DRAFTS_PER_DAY) return { ok: false, reason: "daily cap" };

  let licensedTrades: string[] = [];
  try { licensedTrades = org.licensed_trades ? JSON.parse(org.licensed_trades) : []; } catch { /* */ }

  const text = lead.description.trim()
    ? `Customer's request from the website quote form:\n${lead.description.trim()}`
    : "Analyze these photos and quote all repairs needed.";
  // The customer's material spec, when the lead is tied to a customer that
  // has one (service role: filtered by org + customer explicitly).
  const spec = await loadSpecForCustomer(supabase, orgId, (first as { customer_id?: string | null }).customer_id);
  const result = await aiParsePdf(text, images, org.default_rate || 55, licensedTrades, extractZip(lead.property), undefined, {
    getCorrections: async () => {
      // Newest first, like the app's own read — the calibration and the
      // grounding both treat the first row seen as the latest word.
      const { data } = await supabase.from("price_corrections").select("*").eq("org_id", orgId)
        .order("created_at", { ascending: false }).limit(2000);
      return (data || []) as Awaited<ReturnType<NonNullable<ParserDeps["getCorrections"]>>>;
    },
    getJobStatuses: async (ids) => {
      const { data } = await supabase.from("jobs").select("id, status").eq("org_id", orgId).in("id", ids.slice(0, 500));
      return Object.fromEntries((data || []).map((j: { id: string; status: string }) => [j.id, j.status]));
    },
    getPriceBook: async () => {
      const { data } = await supabase.from("price_book")
        .select("item_name, labor_hours, labor_hours_low, labor_hours_high, unit, scope, active, meta")
        .eq("active", true).or(`org_id.is.null,org_id.eq.${orgId}`).limit(1000);
      return (data || []) as Awaited<ReturnType<NonNullable<ParserDeps["getPriceBook"]>>>;
    },
    getStorePrices: async () => {
      // Latest imported store prices (material_prices). Missing table → [].
      const { data, error } = await supabase.from("material_prices")
        .select("description, store, unit_price, purchased_on").eq("org_id", orgId)
        .order("purchased_on", { ascending: false, nullsFirst: false }).limit(1500);
      if (error || !Array.isArray(data)) return [];
      return (data as Array<{ description: string; store: string | null; unit_price: number | string; purchased_on: string | null }>)
        .map((r) => ({ ...r, unit_price: Number(r.unit_price) }))
        .filter((r) => Number.isFinite(r.unit_price) && r.unit_price > 0);
    },
    callAi: async (body) => {
      // The lead route has already spent part of its 300s saving the lead.
      const { status, data } = await callClaude(body, { orgId, callType: "lead_draft" }, { deadlineMs: 230_000 });
      return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    },
  }, { spec, customerName: lead.client });
  if (!result?.rooms?.length) return { ok: false, reason: "AI returned nothing" };
  const rooms = validateQuote(result.rooms, { skipCaps: true });
  const totals = draftTotals(rooms, org, lead.property);
  const total = totals.total;

  // Write onto the lead — only while it's still an untouched lead (the owner
  // may already have built/sent a quote by hand while this ran).
  const { data: cur } = await supabase.from("jobs").select("status, rooms").eq("id", jobId).maybeSingle();
  if (!cur || cur.status !== "lead") return { ok: false, reason: "lead moved on" };
  let blob: Record<string, unknown> = {};
  try { blob = typeof cur.rooms === "string" ? JSON.parse(cur.rooms) : (cur.rooms || {}); } catch { /* */ }
  if (Array.isArray(blob.rooms) && blob.rooms.length) return { ok: false, reason: "already quoted" };
  blob.leadDraft = {
    v: 1, rooms, estDays: result.estDays > 0 ? result.estDays : null, total, at: new Date().toISOString(),
    // What makes up the total — the lead's Money card shows these instead of
    // $0 labor / $0 materials (the job row's own totals stay 0 until the
    // draft is saved as a quote).
    labor: totals.labor, materials: totals.materials, hours: totals.hours,
    // What the AI flagged (sub work, adjusted hours, possible double-charge)
    // — the editor shows it when the owner opens the draft.
    notes: (result.notes || []).slice(0, 12),
  };
  const { error } = await supabase.from("jobs").update({ rooms: JSON.stringify(blob) }).eq("id", jobId).eq("status", "lead");
  if (error) return { ok: false, reason: error.message };

  // "Draft quote ready" to the people who triage leads.
  try {
    const { data: admins } = await supabase.from("profiles")
      .select("id, phone, notify_sms, notify_leads, status")
      .eq("org_id", orgId).in("role", ["owner", "manager"]);
    const recipients = (admins || []).filter((p) => p.status !== "pending")
      .map((p) => ({ id: p.id, phone: p.phone, notify_sms: p.notify_sms, eventOptIn: p.notify_leads }));
    if (recipients.length) {
      const money = `$${Math.round(total).toLocaleString("en-US")}`;
      await dispatchNotifications(supabase, {
        orgId,
        type: "new_lead",
        title: `Grizz drafted a quote · ${money}`,
        body: `${lead.client ? `${lead.client} · ` : ""}${lead.property} — review it, then Send`,
        jobId,
        smsBody: `Grizz drafted a quote (${money}) for ${lead.client || "a new lead"} at ${lead.property}. Open Creed to review and send.`,
        recipients,
      });
    }
  } catch (e) {
    console.error("[lead-draft] notify failed (draft saved):", e);
  }
  return { ok: true, total };
}
