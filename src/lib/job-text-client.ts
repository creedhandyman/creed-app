"use client";
import { apiFetch } from "./api";
import type { MessagePick } from "./sms-recipient";

/**
 * Send a job message from the business number (Twilio) through /api/sms
 * (kind "message"). The SERVER picks the phone number from the job and the
 * chosen contact, skips anyone who replied STOP, and logs the text so it
 * shows in Texts. Resolves ok only when the server says the text went out,
 * so callers stamp "quote sent" / "invoiced" on a real send, never on a tap.
 */
export type JobMessageResult =
  | { ok: true; name: string }
  | { ok: false; error: string; offline: boolean };

export async function sendJobMessage(jobId: string, pick: MessagePick, body: string): Promise<JobMessageResult> {
  try {
    const r = await apiFetch("/api/sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, kind: "message", recipient: pick, body }),
    });
    const data = (await r.json().catch(() => ({}))) as { error?: string; name?: string };
    if (!r.ok) return { ok: false, error: String(data?.error || ""), offline: false };
    return { ok: true, name: String(data?.name || "") };
  } catch {
    return { ok: false, error: "", offline: true };
  }
}
