import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";

/**
 * Transcribe an audio blob via OpenAI Whisper.
 *
 * The Voice Walk feature uses MediaRecorder to capture one continuous
 * audio file per room (no Web-Speech restart cycle, no mic chimes).
 * That blob is posted here and we proxy it to OpenAI's audio API. We
 * stay on OpenAI for now because Anthropic doesn't have an audio
 * transcription endpoint as of writing.
 *
 * If OPENAI_API_KEY isn't set, the client falls back to whatever
 * Web Speech happened to capture in parallel (incomplete on iOS
 * Safari but better than nothing).
 *
 * Request: multipart/form-data with `audio` field (Blob, <25MB).
 * Response: { text: string } on success, { error: string } on failure.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 503 }
    );
  }

  try {
    const formData = await req.formData();
    const audio = formData.get("audio");
    if (!audio || !(audio instanceof Blob)) {
      return NextResponse.json(
        { error: "Missing 'audio' field" },
        { status: 400 }
      );
    }

    // Whisper accepts up to 25MB. Reject early on oversize so we don't
    // burn time uploading something the API will refuse.
    if (audio.size > 25 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Audio file exceeds 25MB Whisper limit" },
        { status: 413 }
      );
    }
    if (audio.size < 100) {
      return NextResponse.json(
        { error: "Audio too short to transcribe" },
        { status: 400 }
      );
    }

    // Forward to OpenAI as multipart. We re-build the form on the
    // server side because formidable-style uploads don't pass cleanly
    // through next/server's NextRequest in all runtimes.
    const fwd = new FormData();
    // Whisper requires a filename; the extension hints the codec.
    const ext = audio.type.includes("webm")
      ? "webm"
      : audio.type.includes("mp4") || audio.type.includes("m4a")
        ? "m4a"
        : audio.type.includes("ogg")
          ? "ogg"
          : audio.type.includes("wav")
            ? "wav"
            : "webm";
    fwd.append("file", audio, `voicewalk.${ext}`);
    fwd.append("model", "whisper-1");
    fwd.append("response_format", "json");
    // Bias the recognizer toward inspection vocabulary so common terms
    // ("caulking", "GFCI", "drywall", "vanity") land cleanly.
    // Voice Walk's live passes add the room's checklist as `hint` so its
    // words come back spelled the way the auto-tick matcher looks for them.
    // Plain text only, capped (Whisper's prompt window is ~224 tokens).
    const rawHint = formData.get("hint");
    const hint = typeof rawHint === "string"
      ? rawHint.replace(/[^\w\s,/()'-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 400)
      : "";
    fwd.append(
      "prompt",
      "Property inspection narration. Common terms: flooring, walls, ceiling, drywall, caulking, vanity, faucet, toilet, garbage disposal, exhaust fan, GFCI outlet, breaker panel, water heater, HVAC, condenser, smoke detector, carbon monoxide, baseboard, doorknob, deadbolt, blind, screen, window, gutter, downspout." +
        (hint ? ` Checklist: ${hint}.` : "")
    );

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fwd,
    });

    const text = await res.text();
    if (!res.ok) {
      console.error("Whisper error:", res.status, text);
      return NextResponse.json(
        { error: `Whisper ${res.status}: ${text.slice(0, 200)}` },
        { status: res.status >= 500 ? 502 : res.status }
      );
    }
    let parsed: { text?: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { text };
    }
    let out = parsed.text || "";
    // On a silent stretch Whisper tends to echo its prompt back. Live passes
    // (the ones sending a hint) are short and often land on a pause, and an
    // echoed checklist would tick items nobody mentioned — so drop any pass
    // that reads like the prompt: its header words, or mostly prompt terms.
    if (hint && out) {
      const lc = out.toLowerCase();
      const promptWords = new Set(
        ("property inspection narration common terms checklist " + hint + " flooring walls ceiling drywall caulking vanity faucet toilet garbage disposal exhaust fan gfci outlet breaker panel water heater hvac condenser smoke detector carbon monoxide baseboard doorknob deadbolt blind screen window gutter downspout")
          .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
      );
      const words = lc.split(/[^a-z0-9]+/).filter(Boolean);
      const fromPrompt = words.filter((w) => promptWords.has(w)).length;
      if (/inspection narration|common terms|checklist:/.test(lc) || (words.length >= 5 && fromPrompt / words.length >= 0.8)) {
        out = "";
      }
    }
    return NextResponse.json({ text: out });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("transcribe error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
