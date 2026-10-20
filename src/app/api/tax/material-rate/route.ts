import { NextRequest, NextResponse } from "next/server";
import { getAuthedProfile, serviceClient } from "@/lib/api-auth";
import { zipTaxMap, parseRateReply } from "@/lib/material-tax";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/tax/material-rate  { zip }
 *
 * The combined sales tax rate (state + county + city + district) for a ZIP —
 * what the business pays buying materials for a job there. Cached per org in
 * organizations.material_tax_by_zip, so each ZIP is looked up once; the owner
 * can override any entry in Ops → Settings (an owner entry is never replaced).
 * Lookup = Claude with the web search tool (current rates, not the model's
 * memory). Any signed-in member of the org can trigger it — the write is
 * server-side, scoped to their own org.
 */
export async function POST(req: NextRequest) {
  const prof = await getAuthedProfile(req);
  if (!prof) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!prof.orgId) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const { zip } = (await req.json().catch(() => ({}))) as { zip?: string };
  if (!zip || !/^\d{5}$/.test(zip)) return NextResponse.json({ error: "Enter a 5-digit ZIP" }, { status: 400 });

  const sb = serviceClient();
  const { data: org, error: orgErr } = await sb
    .from("organizations").select("id, material_tax_by_zip").eq("id", prof.orgId).single();
  if (orgErr || !org) {
    // Column missing (migration not run) or no org — nothing to cache into.
    return NextResponse.json({ error: orgErr?.message || "Business not found" }, { status: 500 });
  }
  const map = zipTaxMap(org.material_tax_by_zip);
  if (map[zip]) return NextResponse.json({ zip, ...map[zip], cached: true });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-5-5",
      max_tokens: 2048,
      thinking: { type: "between_tools" },
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      messages: [{
        role: "user",
        content:
          `What is the current total combined sales tax rate (state + county + city + any special district) ` +
          `for retail purchases in US ZIP code ${zip}? Search the web for the current rate. ` +
          `If the ZIP spans several rates, use the rate for its main city. ` +
          `Reply with ONLY this JSON and nothing else: {"rate": <percent as a number, e.g. 7.5>, "place": "<City, ST>"}`,
      }],
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    return NextResponse.json({ error: data?.error?.message || `Lookup failed (${res.status})` }, { status: 502 });
  }
  const text = (Array.isArray(data.content) ? data.content : [])
    .filter((b: { type?: string }) => b?.type === "text")
    .map((b: { text?: string }) => b.text || "")
    .join("\n");
  const found = parseRateReply(text);
  if (!found) return NextResponse.json({ error: "Couldn't find a rate for that ZIP" }, { status: 422 });

  const entry = { rate: found.rate, place: found.place, source: "lookup" as const, at: new Date().toISOString() };
  // Re-read so a concurrent lookup / owner edit isn't overwritten.
  const { data: fresh } = await sb.from("organizations").select("material_tax_by_zip").eq("id", prof.orgId).single();
  const next = { ...zipTaxMap(fresh?.material_tax_by_zip) };
  if (!next[zip]) next[zip] = entry;
  await sb.from("organizations").update({ material_tax_by_zip: next }).eq("id", prof.orgId);
  return NextResponse.json({ zip, ...next[zip], cached: false });
}
