/**
 * Agent API keys — the pure parts (no database). A key looks like
 * `creed_sk_<40 hex>`; only its SHA-256 hash is stored (api_keys.key_hash),
 * plus a short prefix so the owner can tell keys apart. The key itself is
 * shown once, when it is made (or replaced), and never again.
 */
import { createHash, randomBytes } from "crypto";

export const KEY_PREFIX = "creed_sk_";

export { AGENT_SCOPES, isScope, cleanScopes, type AgentScope } from "./scopes";

export function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** A fresh key + what gets stored for it. */
export function newKey(): { key: string; hash: string; prefix: string } {
  const key = KEY_PREFIX + randomBytes(20).toString("hex");
  return { key, hash: hashKey(key), prefix: key.slice(0, KEY_PREFIX.length + 6) };
}

/** Does this look like one of our keys (cheap check before any DB read)? */
export function looksLikeKey(v: string): boolean {
  return /^creed_sk_[0-9a-f]{40}$/.test(v);
}

/** A key name: trimmed, one line, 1–60 characters. "" = invalid. */
export function cleanKeyName(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 60) : "";
}
