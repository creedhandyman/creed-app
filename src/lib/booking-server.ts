// Server-side reads for online booking: the business behind a booking link
// and the visits already on its calendar. The slot math itself is pure and
// lives in lib/booking.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSchedTime } from "./day-plan";
import { addDays, readBookingSettings, visitFromRow, type BookingSettings, type BusyVisit } from "./booking";

export interface BookingOrg {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  brand_color: string | null;
  settings: BookingSettings;
}

/** The business for `slug`, only when online booking is switched on.
 *  null = unknown slug, booking off, or the booking columns aren't there yet
 *  (migration not run) — the public page shows "not available" for all. */
export async function loadBookingOrg(supabase: SupabaseClient, slug: string): Promise<BookingOrg | null> {
  if (!slug) return null;
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, phone, email, logo_url, brand_color, booking_enabled, booking_hours, booking_slot_min, booking_buffer_min, booking_min_notice_hours, booking_days_ahead, booking_tz")
    .eq("site_slug", slug)
    .limit(1);
  if (error || !data?.length) return null;
  const o = data[0] as Record<string, unknown>;
  if (o.booking_enabled !== true) return null;
  return {
    id: String(o.id),
    name: String(o.name || ""),
    phone: (o.phone as string) || null,
    email: (o.email as string) || null,
    logo_url: (o.logo_url as string) || null,
    brand_color: (o.brand_color as string) || null,
    settings: readBookingSettings(o),
  };
}

/** Every visit that could touch `fromDate`…`fromDate + daysAhead`. Looks back
 *  60 days for multi-day visits that started earlier. Throws on a read error
 *  (callers must not offer times they couldn't check). `excludeId` leaves one
 *  schedule row out (a just-inserted hold re-checking against the others). */
export async function loadBusyVisits(supabase: SupabaseClient, orgId: string, fromDate: string, daysAhead: number, excludeId?: string | number): Promise<BusyVisit[]> {
  const { data, error } = await supabase
    .from("schedule")
    .select("id, sched_date, end_date, note, start_time, duration_min, job_id")
    .eq("org_id", orgId)
    .gte("sched_date", addDays(fromDate, -60))
    .lte("sched_date", addDays(fromDate, daysAhead));
  if (error) throw new Error(error.message);
  const rows = ((data || []) as { id?: string | number; sched_date: string; end_date?: string | null; note?: string | null; start_time?: string | null; duration_min?: number | null; job_id?: string | null }[])
    .filter((r) => excludeId == null || String(r.id) !== String(excludeId));
  // Drop old single-day rows the look-back pulled in.
  const relevant = rows.filter((r) => (r.end_date && r.end_date > String(r.sched_date)) || String(r.sched_date) >= fromDate);

  const jobIds = [...new Set(relevant.filter((r) => r.job_id && !(r.duration_min && r.duration_min > 0)).map((r) => r.job_id as string))];
  const hours = new Map<string, number>();
  if (jobIds.length) {
    const { data: jobs, error: jErr } = await supabase.from("jobs").select("id, total_hrs").in("id", jobIds);
    if (jErr) throw new Error(jErr.message);
    for (const j of (jobs || []) as { id: string; total_hrs: number | null }[]) hours.set(j.id, Number(j.total_hrs) || 0);
  }
  return relevant.map((r) => visitFromRow(r, parseSchedTime, r.job_id ? hours.get(r.job_id) : null));
}
