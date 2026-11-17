import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/api-auth";
import { callClaude } from "@/lib/anthropic-server";
import { salvageJson } from "@/lib/json-salvage";
import { imageBlocks } from "@/lib/spec-import";
import { cleanPurchaseLines, normStore, parseDate, PURCHASE_EXTRACT_PROMPT } from "@/lib/purchase-import";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PDF_BYTES = 3_000_000;
const MAX_TEXT = 80_000;

/**
 * Read a store receipt / invoice / purchase history that isn't a sheet we
 * can map (a PDF, photos, odd text) into purchase lines for review
 * (lib/purchase-import.ts). Owner/manager only. Saves nothing.
 *
 * Body: { text?, pdfBase64?, images?: [{data, media_type}], fileName?, part? }
 * Reply: { ok: true, lines: PurchaseLine[], notes: string[], cut: boolean }
 */
export async function POST(req: NextRequest) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;

  let body: { text?: unknown; pdfBase64?: unknown; images?: unknown; fileName?: unknown; part?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }

  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  const pdf = typeof body.pdfBase64 === "string" ? body.pdfBase64.replace(/^data:application\/pdf;base64,/, "") : "";
  const imgs = imageBlocks(body.images);
  if (imgs.error) return NextResponse.json({ error: imgs.error }, { status: 400 });
  if (!text && !pdf && !imgs.blocks.length) return NextResponse.json({ error: "Nothing to read — upload a file." }, { status: 400 });
  if (pdf && pdf.length * 0.75 > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "That PDF is too big to send in one piece." }, { status: 413 });
  }
  const fileName = typeof body.fileName === "string" ? body.fileName.slice(0, 120) : "";
  const part = typeof body.part === "string" ? body.part.slice(0, 80) : "";

  const content: Array<Record<string, unknown>> = [];
  if (pdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf } });
  content.push(...imgs.blocks);
  content.push({
    type: "text",
    text: `${fileName ? `File: ${fileName}\n` : ""}${part ? `This is ${part}; other parts are read separately, so list only the lines shown here.\n` : ""}${text ? `Text:\n${text}\n\n` : ""}List every purchased line item as JSON.`,
  });

  const { status, data } = await callClaude(
    {
      model: "claude-sonnet-5-5",
      max_tokens: 32000,
      output_config: { effort: "medium" },
      system: PURCHASE_EXTRACT_PROMPT,
      messages: [{ role: "user", content }],
    },
    { orgId: auth.orgId, userId: auth.userId, callType: "price_import" },
    { deadlineMs: 270_000 },
  );
  if (status < 200 || status >= 300) {
    const err = data?.error as { message?: string } | undefined;
    return NextResponse.json({ error: err?.message || "The AI could not read this file." }, { status: 502 });
  }
  if (data?.stop_reason === "refusal") {
    return NextResponse.json({ error: "The AI declined to read this file." }, { status: 502 });
  }
  const blocks = Array.isArray(data?.content) ? (data.content as Array<{ type?: string; text?: string }>) : [];
  const reply = blocks.filter((b) => b?.type === "text").map((b) => b.text || "").join("");
  const salvaged = salvageJson(reply);
  const value = salvaged?.value as { items?: unknown; notes?: unknown; store?: unknown; date?: unknown } | undefined;
  const lines = cleanPurchaseLines(value?.items, fileName || "upload", {
    date: parseDate(value?.date),
    store: normStore(value?.store),
  });
  if (!lines.length) {
    return NextResponse.json({ error: "No purchased items found in this file." }, { status: 422 });
  }
  const notes = Array.isArray(value?.notes) ? value!.notes.filter((n): n is string => typeof n === "string").slice(0, 10) : [];
  const cut = salvaged?.truncated === true || data?.stop_reason === "max_tokens";
  if (cut) notes.push("The file was long and the AI stopped early — the last lines may be missing.");
  return NextResponse.json({ ok: true, lines, notes, cut });
}
