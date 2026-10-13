// Records that a quote actually went out to the customer (Text / Email /
// Copy / Share from QuoteForge's send sheet or the Jobs send strip). Drives
// "Sent 3d ago" on job cards and the dashboard's To send vs Waiting split.
// Top-level column (not the rooms blob) so it can't race blob writes.
import { db } from "@/lib/supabase";
import { t } from "@/lib/i18n";

/** Resolves true when the stamp landed (false = db already toasted why), so
 *  callers only confirm "sent" when it really was recorded. */
export async function markQuoteSent(jobId: string): Promise<boolean> {
  return db.patch("jobs", jobId, { quote_sent_at: new Date().toISOString() });
}

/** "today" / "1d ago" / "5d ago" (es: "hoy" / "hace 5 d") for a sent timestamp. */
export function sentAgo(iso?: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? t("common.today") : t("common.daysAgo").replace("{n}", String(days));
}
