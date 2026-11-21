/** Agent API scopes. No Node imports, so the settings screen can use it too. */
/** What a key may do. One scope per tool; nothing here sends to customers,
 *  takes payments, deletes or bulk-imports (left out on purpose). */
export const AGENT_SCOPES = [
  "customers:read",
  "jobs:read",
  "jobs:write",
  "work_orders:write",
  "quotes:draft",
  "billing:read",
  "schedule:read",
  "schedule:write",
] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

export function isScope(s: unknown): s is AgentScope {
  return typeof s === "string" && (AGENT_SCOPES as readonly string[]).includes(s);
}

/** Known scopes only, de-duplicated, in the canonical order. */
export function cleanScopes(raw: unknown): AgentScope[] {
  const set = new Set((Array.isArray(raw) ? raw : []).filter(isScope));
  return AGENT_SCOPES.filter((s) => set.has(s));
}
