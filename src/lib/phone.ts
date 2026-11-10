/**
 * Loose US phone -> E.164. "+" prefixes are kept; bare 10/11-digit US numbers
 * get +1. No imports and no Node APIs, so client components can use it too
 * (lib/sms.ts re-exports it for the server texting paths).
 */
export function normalizePhone(raw: string | null | undefined): string {
  const v = (raw || "").trim();
  if (!v) return "";
  if (v.startsWith("+")) return "+" + v.slice(1).replace(/\D/g, "");
  const digits = v.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}
