import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isSupabaseStorageUrl } from "@/lib/api-auth";
import { callClaude } from "@/lib/anthropic-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Scan a receipt photo with Claude vision (claude-sonnet-5-5 — the same model
// as every other AI call in the app; it reads long/faded thermal receipts far
// better than the gpt-4o-mini this route used before) and return structured
// data (vendor, date, total, tax, items). The client hands us signed Supabase
// Storage URLs; Anthropic fetches them directly so the bytes never pass
// through this route.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  try {
    const body = await req.json();
    // Accept a single imageUrl (legacy / WorkVision) OR imageUrls[] (a multi-page
    // receipt shot across several photos). Multi-page is sent together so the
    // model returns ONE combined result instead of being read as separate receipts.
    const urls: string[] = (
      Array.isArray(body.imageUrls) && body.imageUrls.length
        ? body.imageUrls
        : body.imageUrl
          ? [body.imageUrl]
          : []
    ).slice(0, 8);
    if (!urls.length) {
      return NextResponse.json({ error: "Missing imageUrl(s)" }, { status: 400 });
    }
    if (!urls.every((u: unknown) => isSupabaseStorageUrl(u))) {
      return NextResponse.json({ error: "image URLs must be Supabase Storage URLs" }, { status: 400 });
    }
    const multi = urls.length > 1;

    const prompt = `${multi ? `The ${urls.length} images above are pages of ONE single receipt — combine them: list EVERY line item across all pages, and report the ONE final grand total (usually on the last page). Do NOT add the pages' subtotals together.\n\n` : ""}Extract this receipt into JSON. Return ONLY valid JSON matching this exact shape:
{
  "vendor": "store name",
  "date": "YYYY-MM-DD or empty string",
  "total": 0,
  "tax": 0,
  "items": [
    { "name": "item description", "qty": 1, "price": 0 }
  ]
}

Rules:
- vendor: the store or service name on the receipt (e.g. "Home Depot", "Lowes")
- date: the TRANSACTION date printed on the receipt (not today); empty string if unreadable
- total: the GRAND TOTAL the customer paid (number, no currency symbol). Look for "TOTAL", "GRAND TOTAL", "AMOUNT DUE", "BALANCE". Include tax. If multiple totals appear, use the final one.
- tax: sales tax portion if listed, else 0
- items: every line item on the receipt; qty = the quantity purchased (default 1 if not shown)
- price: the LINE total as printed (qty x unit price), not the unit price
- discounts, coupons, refunds and returned items are line items with a NEGATIVE price
- REFUND / RETURN receipt (money given BACK to the customer — "REFUND", "RETURN", "CREDIT", "AMOUNT REFUNDED", a negative or parenthesized total): report total and tax as NEGATIVE numbers (e.g. -42.18). A normal purchase total is positive.
- transcribe item names as printed (abbreviations are fine); if a line is truly unreadable, skip it rather than guessing
- sanity-check yourself: the item prices plus tax should come close to the total — re-read any digits that don't add up
- Return ONLY the JSON object, no prose, no code fences, no markdown.`;

    const { status, data: aiData } = await callClaude(
      {
        model: "claude-sonnet-5-5",
        max_tokens: multi ? 3500 : 2000,
        messages: [
          {
            role: "user",
            content: [
              ...urls.map((u) => ({ type: "image", source: { type: "url", url: u } })),
              { type: "text", text: prompt },
            ],
          },
        ],
      },
      { orgId: req.headers.get("x-creed-org"), userId: auth.userId, callType: "receipt" },
    );
    if (status < 200 || status >= 300) {
      const err = aiData?.error as { message?: string } | undefined;
      return NextResponse.json({ error: err?.message || "AI request failed" }, { status: 502 });
    }

    const blocks: Array<{ type?: string; text?: string }> = Array.isArray(aiData?.content) ? aiData.content : [];
    const text = (blocks.find((b) => b?.type === "text")?.text || "").trim();
    const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
    let parsed: { vendor?: string; date?: string; total?: number; tax?: number; items?: unknown[] };
    try {
      // The model may wrap the JSON in a sentence — grab the outermost object.
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      parsed = JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
    } catch {
      return NextResponse.json({ error: "AI returned invalid JSON", raw: text }, { status: 502 });
    }

    // Coerce total/tax to numbers in case the model emits "329.57" as a string.
    for (const k of ["total", "tax"] as const) {
      if (typeof parsed[k] === "string") {
        const n = parseFloat((parsed[k] as unknown as string).replace(/[^0-9.-]/g, ""));
        parsed[k] = isNaN(n) ? 0 : n;
      }
    }

    return NextResponse.json({ ok: true, data: parsed });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("receipt scan error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
