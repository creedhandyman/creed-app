import { NextRequest } from "next/server";
import { GET as remindersGET } from "../route";

export const dynamic = "force-dynamic";

/**
 * Morning cron (14:00 UTC = 8 AM CST / 9 AM CDT): the same-day run of the
 * visit reminders. Its own path so vercel.json needs no query string; it just
 * calls /api/sms/reminders with `when=today` (same auth headers, `?dry=1`
 * passes through).
 */
function handle(req: NextRequest) {
  const url = new URL(req.url);
  url.pathname = "/api/sms/reminders";
  url.searchParams.set("when", "today");
  return remindersGET(new NextRequest(url, { headers: req.headers }));
}

export const GET = handle;
export const POST = handle;
