import { NextRequest, NextResponse, after } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { emailFromIdToken, exchangeCode, GCAL_SCOPES } from "@/lib/gcal/google";
import { encrypt, readState, safeEqual } from "@/lib/gcal/crypto";
import { syncOrgById } from "@/lib/gcal/server";
import { siteOrigin } from "@/lib/site-url";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

function page(ok: boolean, title: string, text: string): NextResponse {
  const home = siteOrigin() + "/";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${ok ? `<meta http-equiv="refresh" content="3;url=${esc(home)}">` : ""}<title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c0f14;color:#e9edf3;font:17px/1.5 system-ui,sans-serif}
.c{max-width:420px;margin:16px;padding:28px;border-radius:16px;background:#151a22;border:1px solid #263041;text-align:center}
h1{font-size:22px;margin:0 0 8px;color:${ok ? "#3ee08f" : "#ff6b6b"}}a{display:inline-block;margin-top:16px;padding:12px 20px;border-radius:10px;background:#2E75B6;color:#fff;text-decoration:none;font-weight:600}</style>
</head><body><div class="c"><h1>${esc(title)}</h1><p>${esc(text)}</p><a href="${esc(home)}">Back to Creed</a></div></body></html>`;
  const res = new NextResponse(html, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  res.cookies.set("gcal_nonce", "", { httpOnly: true, secure: true, sameSite: "lax", path: "/api/gcal", maxAge: 0 });
  return res;
}

/** Google sends the person back here after they approve (or cancel). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (q.get("error")) return page(false, "Not connected", "Google sign-in was cancelled. You can try again from Settings.");
  const st = readState(q.get("state"));
  const cookie = req.cookies.get("gcal_nonce")?.value || "";
  if (!st || !cookie || !safeEqual(cookie, st.nonce)) {
    return page(false, "Link expired", "Start again from Operations → Settings → Google Calendar, in the same browser.");
  }
  const sb = serviceClient();
  const { data: prof } = await sb.from("profiles").select("org_id, role, status").eq("id", st.userId).maybeSingle();
  if (!prof || prof.org_id !== st.orgId || prof.status === "pending" || (prof.role !== "owner" && prof.role !== "manager")) {
    return page(false, "Not allowed", "Only an owner or manager of the business can connect Google Calendar.");
  }
  let tok;
  try { tok = await exchangeCode(q.get("code") || ""); } catch {
    return page(false, "Not connected", "Google did not accept the sign-in. Please try again.");
  }
  const granted = (tok.scope || "").split(" ");
  if (!tok.refresh_token || !granted.includes(GCAL_SCOPES[2])) {
    return page(false, "Calendar access needed", "Please allow Creed to manage the calendars it creates, then try again.");
  }
  const email = emailFromIdToken(tok.id_token);
  const { data: old } = await sb.from("google_calendar_links").select("google_email").eq("org_id", st.orgId).maybeSingle();
  const sameAccount = !!old && !!email && old.google_email === email;
  if (old && !sameAccount) await sb.from("google_calendar_events").delete().eq("org_id", st.orgId);
  const now = new Date();
  const row: Record<string, unknown> = {
    org_id: st.orgId, connected_by: st.userId, google_email: email,
    refresh_token_enc: encrypt(tok.refresh_token),
    access_token_enc: tok.access_token ? encrypt(tok.access_token) : null,
    access_expires_at: new Date(now.getTime() + (tok.expires_in || 3600) * 1000).toISOString(),
    status: "active", last_error: null, sync_lock_until: null, updated_at: now.toISOString(),
  };
  // A different Google account starts fresh (its own calendar); the same one keeps its calendar + links.
  if (!sameAccount) {
    Object.assign(row, { calendar_id: null, sync_token: null, channel_id: null, channel_resource_id: null, channel_token_hash: null, channel_expires_at: null });
  }
  const { error } = await sb.from("google_calendar_links").upsert(row, { onConflict: "org_id" });
  if (error) return page(false, "Not connected", "Creed could not save the connection. The Google Calendar setup may not be finished yet.");
  after(() => syncOrgById(st.orgId).then(() => undefined));
  return page(true, "Google Calendar connected", `Your jobs will appear in the "Creed jobs" calendar${email ? ` in ${email}` : ""} in a minute or two.`);
}
