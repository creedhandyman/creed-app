/**
 * Escape the LIKE wildcards in a value a stranger typed, so `.ilike(col, v)`
 * is a case-insensitive EXACT match. Without it an email of "%" matched every
 * customer: a public lead attached itself to someone else's customer record,
 * and the portal sign-in form emailed links to customers of every business.
 */
export function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => "\\" + c);
}
