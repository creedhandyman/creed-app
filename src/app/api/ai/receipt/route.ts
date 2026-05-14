import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Scan a receipt photo with OpenAI Vision (gpt-4o-mini) and return structured
// data (vendor, date, total, items). The client hands us a public image URL
// (Supabase storage); OpenAI fetches the URL directly so we don't have to
// shuttle the bytes through this route.
export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
  }

  try {
    const { imageUrl } = await req.json();
    if (!imageUrl) {
      return NextResponse.json({ error: "Missing imageUrl" }, { status: 400 });
    }

    const prompt = `Extract this receipt into JSON. Return ONLY valid JSON matching this exact shape:
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
- date: parse the transaction date; empty string if unreadable
- total: the GRAND TOTAL the customer paid (number, no currency symbol). Look for "TOTAL", "GRAND TOTAL", "AMOUNT DUE", "BALANCE". Include tax. If multiple totals appear, use the final one.
- tax: sales tax portion if listed, else 0
- items: every line item on the receipt; qty defaults to 1 if not shown
- price: per-line total (qty x unit price) as shown on receipt
- Return ONLY the JSON object, no prose, no code fences, no markdown.`;

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });

    const aiData = await aiRes.json();
    if (!aiRes.ok) {
      return NextResponse.json({ error: aiData?.error?.message || "AI request failed" }, { status: 502 });
    }

    const text = aiData?.choices?.[0]?.message?.content?.trim() || "";
    const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
    let parsed: { vendor?: string; date?: string; total?: number; tax?: number; items?: unknown[] };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: "AI returned invalid JSON", raw: text }, { status: 502 });
    }

    // Coerce total to a number in case the model emits "329.57" as a string.
    if (typeof parsed.total === "string") {
      const n = parseFloat((parsed.total as string).replace(/[^0-9.]/g, ""));
      parsed.total = isNaN(n) ? 0 : n;
    }

    return NextResponse.json({ ok: true, data: parsed });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("receipt scan error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
