import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/api-auth";
import { callClaude } from "@/lib/anthropic-server";
import { salvageJson } from "@/lib/json-salvage";
import { cleanDrafts, imageBlocks, SPEC_EXTRACT_PROMPT } from "@/lib/spec-import";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Largest PDF accepted inline (base64 inflates by a third; Vercel caps a
 *  request body at 4.5 MB). Bigger PDFs: the client sends their text. */
const MAX_PDF_BYTES = 3_000_000;
const MAX_TEXT = 80_000;
/**
 * Turn a client's material spec (a PDF, photos of a spec sheet, or pasted /
 * spreadsheet text) into reviewable items (docs/claude/customer-material-specs.md).
 * Owner/manager only. Saves nothing: the app shows the items for review and
 * writes the approved ones itself (RLS-scoped). A long document arrives as
 * several calls (`part` says which pages); the app merges the results.
 *
 * Body: { text?: string, pdfBase64?: string, images?: [{data, media_type}],
 *         fileName?: string, part?: string }
 * Reply: { ok: true, items: SpecDraft[], notes: string[], cut: boolean }
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
  if (!text && !pdf && !imgs.blocks.length) return NextResponse.json({ error: "Nothing to read — upload a file or paste the spec." }, { status: 400 });
  if (pdf && pdf.length * 0.75 > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "That PDF is too big to send. Paste its text instead, or split it." }, { status: 413 });
  }
  const fileName = typeof body.fileName === "string" ? body.fileName.slice(0, 120) : "";
  const part = typeof body.part === "string" ? body.part.slice(0, 80) : "";

  const content: Array<Record<string, unknown>> = [];
  if (pdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf } });
  content.push(...imgs.blocks);
  content.push({
    type: "text",
    text: `${fileName ? `File: ${fileName}\n` : ""}${part ? `This is ${part} of the spec; other parts are read separately, so list only the products shown here.\n` : ""}${imgs.blocks.length ? "The images are photos or pages of the spec sheet. Read every product row in them; if a row is cut off or unreadable, say so in notes.\n" : ""}${text ? `Spec text:\n${text}\n\n` : ""}Extract every product from this material spec as JSON.`,
  });

  const { status, data } = await callClaude(
    {
      model: "claude-sonnet-5-5",
      max_tokens: 32000,
      output_config: { effort: "medium" },
      system: SPEC_EXTRACT_PROMPT,
      messages: [{ role: "user", content }],
    },
    { orgId: auth.orgId, userId: auth.userId, callType: "spec_import" },
    { deadlineMs: 270_000 },
  );
  if (status < 200 || status >= 300) {
    const err = data?.error as { message?: string } | undefined;
    return NextResponse.json({ error: err?.message || "The AI could not read this spec." }, { status: 502 });
  }
  if (data?.stop_reason === "refusal") {
    return NextResponse.json({ error: "The AI declined to read this file." }, { status: 502 });
  }
  const blocks = Array.isArray(data?.content) ? (data.content as Array<{ type?: string; text?: string }>) : [];
  const reply = blocks.filter((b) => b?.type === "text").map((b) => b.text || "").join("");
  const salvaged = salvageJson(reply);
  const value = salvaged?.value as { items?: unknown; notes?: unknown } | undefined;
  const items = cleanDrafts(value?.items);
  if (!items.length) {
    return NextResponse.json({ error: "No products found in this spec. Check the file, or paste the product list." }, { status: 422 });
  }
  const notes = Array.isArray(value?.notes) ? value!.notes.filter((n): n is string => typeof n === "string").slice(0, 10) : [];
  const cut = salvaged?.truncated === true || data?.stop_reason === "max_tokens";
  if (cut) notes.push("The spec was long and the AI stopped early — the last products may be missing. Check the end of the list.");
  return NextResponse.json({ ok: true, items, notes, cut });
}
