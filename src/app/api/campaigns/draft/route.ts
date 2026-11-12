import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import { callClaude } from "@/lib/anthropic-server";
import { AUDIENCE_LABEL, isAudience } from "@/lib/campaigns";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/campaigns/draft { idea, audience }
 * → { subject, body } — a first draft the owner edits on the Campaigns
 * screen. Nothing is saved or sent here. Owner/manager only.
 */
export async function POST(req: NextRequest) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  const b = (await req.json().catch(() => ({}))) as { idea?: unknown; audience?: unknown };
  const idea = typeof b.idea === "string" ? b.idea.trim().slice(0, 1000) : "";
  if (!idea) return NextResponse.json({ error: "Say what the email is about." }, { status: 400 });
  const audience = isAudience(b.audience) ? b.audience : "all";
  const { data: org } = await serviceClient().from("organizations").select("name").eq("id", auth.orgId!).maybeSingle();
  const business = (org as { name?: string } | null)?.name || "the business";

  const res = await callClaude({
    model: "claude-sonnet-5-5",
    max_tokens: 1200,
    messages: [{
      role: "user",
      content:
        `Write a short marketing email for ${business}, a local handyman / home repair business, to send to its own past customers ` +
        `(${AUDIENCE_LABEL[audience].toLowerCase()}). What it's about: ${idea}\n\n` +
        `Rules: plain text, friendly and direct, 60-140 words, short paragraphs, one clear ask (reply to the email or call). ` +
        `Start with "Hi {first_name}," and sign off with "{business_name}". Don't invent prices, discounts, deadlines or phone numbers ` +
        `that weren't given. No emoji. You may use {referral_link} only if the idea is about referrals.\n` +
        `Reply with ONLY this JSON: {"subject": "...", "body": "..."}`,
    }],
  }, { orgId: auth.orgId!, userId: auth.userId, callType: "campaign" })
    .catch(() => ({ status: 0, data: null as Record<string, unknown> | null }));
  const data = res.data as { content?: unknown; error?: { message?: string } } | null;
  if (res.status < 200 || res.status >= 300 || !data) {
    return NextResponse.json({ error: data?.error?.message || "Couldn't write a draft just now." }, { status: 502 });
  }
  const text = (Array.isArray(data.content) ? data.content : [])
    .filter((x: { type?: string }) => x?.type === "text")
    .map((x: { text?: string }) => x.text || "")
    .join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  try {
    const j = JSON.parse(m ? m[0] : "") as { subject?: unknown; body?: unknown };
    if (typeof j.subject !== "string" || typeof j.body !== "string") throw new Error("shape");
    return NextResponse.json({ subject: j.subject.slice(0, 200), body: j.body.slice(0, 5000) });
  } catch {
    return NextResponse.json({ error: "Couldn't write a draft just now." }, { status: 502 });
  }
}
