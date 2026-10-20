// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** A column's export value, computed from a row (`meta.exportValue`). */
export type ListExportValues<TRow> = Record<string, (row: TRow) => unknown>;

/**
 * Each row with `values` computed onto it, keyed by column: what a list's
 * `exportRows` hands the background export, which reads `row[key]`.
 */
export function withExportValues<TRow extends Record<string, unknown>>(
  rows: TRow[],
  values: ListExportValues<TRow>
): Record<string, unknown>[] {
  const entries = Object.entries(values);
  return rows.map((row) => ({
    ...row,
    ...Object.fromEntries(entries.map(([key, value]) => [key, value(row)]))
  }));
}
