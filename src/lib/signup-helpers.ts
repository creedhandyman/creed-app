/**
 * Signup plumbing shared by /signin and onboarding.
 *
 * (The old bootstrapOrgAndProfile, which auto-created an org for any
 * confirmed user, is gone: it made crew members who signed up to join their
 * boss the OWNER of an empty business. Every account now goes through the
 * one onboarding flow — Create a business / Join a team.)
 */

/** localStorage key an invite link (/signin?join=<code>) leaves for onboarding,
 *  which renders at "/" after auth (the query string is gone by then). */
export const JOIN_CODE_KEY = "c_join_code";

/** Shareable invite link for an org — opens Create account, then lands the
 *  new user on "Join a team" with the code filled in. */
export function inviteLink(origin: string, orgId: string): string {
  return `${origin}/signin?mode=signup&join=${encodeURIComponent(orgId)}`;
}
