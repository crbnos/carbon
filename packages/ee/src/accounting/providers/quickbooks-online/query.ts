/**
 * QBO query-string helpers.
 *
 * A leaf on purpose: `provider.ts` needs the escaper for its counterpart
 * search, and `entities/shared.ts` — where this used to live — imports
 * `../provider`. Importing shared from the provider would close that cycle.
 * Same shape as the Rillet `references.ts` extraction, for the same reason.
 */

/** Escape a string literal for a QBO query WHERE clause (single quotes). */
export function escapeQboQueryValue(value: string): string {
  return value.replace(/'/g, "\\'");
}
