/**
 * Shared bootstrap used by both /signup (auto-confirm path) and
 * /onboarding (email-confirm round-trip path). Inserts the starter
 * `organizations` row + the owner's `profiles` row immediately after
 * a successful Supabase Auth signup.
 *
 * Idempotent: if the caller re-runs after the verify-link round-trip
 * and a profile already exists, returns the existing pair instead of
 * spinning up a duplicate org.
 */
import { db } from "./supabase";
import type { Organization, Profile } from "./types";

export async function bootstrapOrgAndProfile(
  userId: string,
  email: string,
  name: string,
): Promise<{ org: Organization; profile: Profile } | null> {
  const existing = await db.get<Profile>("profiles", { id: userId });
  if (existing.length && existing[0].org_id) {
    const orgs = await db.get<Organization>("organizations", { id: existing[0].org_id });
    if (orgs.length) return { org: orgs[0], profile: existing[0] };
  }

  const orgRows = await db.post<Organization>("organizations", {
    name: `${name}'s Business`,
    phone: "",
    email,
    license_num: "",
    address: "",
    default_rate: 55,
    trial_start: new Date().toISOString(),
    subscription_status: "trial",
  });
  if (!orgRows?.length) return null;
  const org = orgRows[0];

  const profileRows = await db.post<Profile>("profiles", {
    id: userId,
    email,
    name,
    role: "owner",
    rate: 55,
    start_date: new Date().toISOString().split("T")[0],
    emp_num: "001",
    org_id: org.id,
  });
  if (!profileRows?.length) return null;

  return { org, profile: profileRows[0] };
}
