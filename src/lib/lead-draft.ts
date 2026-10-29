/**
 * Website lead → AI draft quote, server-side, right after the lead lands
 * (/api/leads runs it with `after()`). Same engine as QuoteForge's Quick Quote
 * — aiParsePdf with this org's learned pricing + labor calibration — fed the
 * customer's description and photos. The draft is NOT a quote yet: it's
 * stored on the lead's rooms blob as `leadDraft` ({v, rooms, estDays, total,
 * at}); "Build Quote" opens it in the editor instantly, and only Save/Send
 * turns the lead into a quote. Owners/managers get a "Draft quote ready ·
 * $X" alert. Best-effort throughout: any failure just leaves the lead as it
 * was (Build Quote then runs the AI on the phone, like before).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Room } from "./types";
import { aiParsePdf, validateQuote, calculateCost, extractZip, type ParserDeps } from "./parser";
import { callClaude } from "./anthropic-server";
import { rateForRoom, billedMaterial, priceCascade, pricingInputs } from "./pricing";
import { materialTaxFor } from "./material-tax";
import { dispatchNotifications } from "./notify-server";

/** Most AI drafts per business per day — a public form can't run up the bill. */
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
  return priceCascade({
    laborRaw, hoursRaw, materials, rate: defaultRate,
    minHrs: p.minHrs,
    tripFee: p.tripFee,
    discount: null,
    taxPct: p.taxPct,
    taxMode: p.taxMode,
    subtotalRaw,
  }).grandTotal;
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

  // Daily cap per business (counts drafts stamped today).
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await supabase.from("jobs").select("id", { count: "exact", head: true })
    .eq("org_id", orgId).gte("created_at", since).like("rooms", "%\"leadDraft\"%");
  if ((count || 0) >= DRAFTS_PER_DAY) return { ok: false, reason: "daily cap" };

  let licensedTrades: string[] = [];
  try { licensedTrades = org.licensed_trades ? JSON.parse(org.licensed_trades) : []; } catch { /* */ }

  const text = lead.description.trim()
    ? `Customer's request from the website quote form:\n${lead.description.trim()}`
    : "Analyze these photos and quote all repairs needed.";
  const result = await aiParsePdf(text, images, org.default_rate || 55, licensedTrades, extractZip(lead.property), undefined, {
    getCorrections: async () => {
      const { data } = await supabase.from("price_corrections").select("*").eq("org_id", orgId).limit(2000);
      return (data || []) as Awaited<ReturnType<NonNullable<ParserDeps["getCorrections"]>>>;
    },
    callAi: async (body) => {
      const { status, data } = await callClaude(body, { orgId, callType: "lead_draft" });
      return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    },
  });
  if (!result?.rooms?.length) return { ok: false, reason: "AI returned nothing" };
  const rooms = validateQuote(result.rooms, { skipCaps: true });
  const total = draftTotal(rooms, org, lead.property);

  // Write onto the lead — only while it's still an untouched lead (the owner
  // may already have built/sent a quote by hand while this ran).
  const { data: cur } = await supabase.from("jobs").select("status, rooms").eq("id", jobId).maybeSingle();
  if (!cur || cur.status !== "lead") return { ok: false, reason: "lead moved on" };
  let blob: Record<string, unknown> = {};
  try { blob = typeof cur.rooms === "string" ? JSON.parse(cur.rooms) : (cur.rooms || {}); } catch { /* */ }
  if (Array.isArray(blob.rooms) && blob.rooms.length) return { ok: false, reason: "already quoted" };
  blob.leadDraft = { v: 1, rooms, estDays: result.estDays > 0 ? result.estDays : null, total, at: new Date().toISOString() };
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
        title: `Draft quote ready · ${money}`,
        body: `${lead.client ? `${lead.client} · ` : ""}${lead.property} — review it, then Send`,
        jobId,
        smsBody: `Draft quote ready (${money}) for ${lead.client || "a new lead"} at ${lead.property}. Open Creed to review and send.`,
        recipients,
      });
    }
  } catch (e) {
    console.error("[lead-draft] notify failed (draft saved):", e);
  }
  return { ok: true, total };
}
