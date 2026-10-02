// Records that a quote actually went out to the customer (Text / Email /
// Copy / Share from QuoteForge's send sheet or the Jobs send strip). Drives
// "Sent 3d ago" on job cards and the dashboard's To send vs Waiting split.
// Top-level column (not the rooms blob) so it can't race blob writes.
import { db } from "@/lib/supabase";

export async function markQuoteSent(jobId: string): Promise<void> {
  await db.patch("jobs", jobId, { quote_sent_at: new Date().toISOString() });
}

/** "today" / "1d ago" / "5d ago" for a sent timestamp. */
export function sentAgo(iso?: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? "today" : `${days}d ago`;
}
