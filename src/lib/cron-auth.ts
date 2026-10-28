import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Shared auth for the cron endpoints (payroll/auto-run, recurring/fire,
 * reviews/dispatch). Accepts exactly two credentials:
 *   - `Authorization: Bearer <CRON_SECRET>` — what Vercel cron sends once
 *     CRON_SECRET is set (cron_log shows every scheduled run uses it);
 *   - `x-admin-token: <ADMIN_PASSWORD>` — manual / test triggers.
 * Returns which one matched (for cron_log.auth_via), or null.
 *
 * The bare `x-vercel-cron: 1` header is deliberately NOT accepted: any
 * caller can set it, and with `?force=1` it ran payroll / fired recurring
 * jobs on demand. An unset env var never matches.
 */
export type CronAuthVia = "cron_secret" | "admin_token";

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function cronAuth(req: NextRequest): CronAuthVia | null {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (cronSecret && same(auth, `Bearer ${cronSecret}`)) return "cron_secret";
  const adminPw = process.env.ADMIN_PASSWORD;
  const adminToken = req.headers.get("x-admin-token");
  if (adminPw && adminToken && same(adminToken, adminPw)) return "admin_token";
  return null;
}
