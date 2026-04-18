import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Scan a receipt photo and return structured data (vendor, date, items, total).
// The client hands us a public image URL (Supabase storage); we fetch it,
// base64-encode, and send to Claude as a vision request.
export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  try {
    const { imageUrl } = await req.json();
    if (!imageUrl) {
      return NextResponse.json({ error: "Missing imageUrl" }, { status: 400 });
    }

    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      return NextResponse.json({ error: `Could not fetch image: ${imgRes.status}` }, { status: 400 });
    }
    const mediaType = imgRes.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const base64 = buf.toString("base64");

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
- vendor: the store or service name on the receipt
- date: parse the transaction date; empty string if unreadable
- total: the grand total including tax (number, no currency symbol)
- tax: sales tax portion if listed, else 0
- items: every line item; qty defaults to 1 if not shown
- price: per-line total (qty x unit price) as shown on receipt
- Return ONLY the JSON object, no prose, no code fences.`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    const aiData = await aiRes.json();
    if (!aiRes.ok) {
      return NextResponse.json({ error: aiData?.error?.message || "AI request failed" }, { status: 502 });
    }

    const text = aiData?.content?.[0]?.text?.trim() || "";
    // Strip optional code fences defensively
    const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: "AI returned invalid JSON", raw: text }, { status: 502 });
    }

    return NextResponse.json({ ok: true, data: parsed });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("receipt scan error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
