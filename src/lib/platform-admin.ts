// Creed's own operator accounts (the people who run the platform, not a
// customer business). Gates developer-only UI like the Beta preflight panel —
// customers should never see env-var names or migration checklists.
// UI gating only: the endpoints behind that UI enforce their own auth.

const PLATFORM_ADMIN_EMAILS = ["creedhandyman@gmail.com"];

export function isPlatformAdmin(email?: string | null): boolean {
  return !!email && PLATFORM_ADMIN_EMAILS.includes(email.trim().toLowerCase());
}
