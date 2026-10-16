// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Columns every update writes, whatever the row holds.
const ALWAYS_WRITTEN = new Set(["updatedAt", "updatedBy", "companyId"]);

/**
 * An update that writes only the values the row holds: a field whose column
 * is missing, whose cell is empty, or that took its enum Default is left out,
 * so the record keeps its saved value. Inserts still take the defaults.
 * `sources` names the field a derived column is read from.
 */
export function withSavedValuesKept<T extends Record<string, unknown>>(
  data: T,
  held: ReadonlySet<string> | undefined,
  sources: Record<string, string> = {}
): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (ALWAYS_WRITTEN.has(key) || held?.has(sources[key] ?? key)) {
      out[key] = value;
    }
  }
  return out as T;
}
