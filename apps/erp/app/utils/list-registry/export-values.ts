// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** A column's export value, computed from a row (`meta.exportValue`). A
 *  method type, so a list typed to its own rows still fits the registry's
 *  `ListDefinition`. */
type ExportValue<TRow> = { value(row: TRow): unknown }["value"];

export type ListExportValues<TRow> = Record<string, ExportValue<TRow>>;

/**
 * Each row with `values` computed onto it, keyed by column: what the
 * background export writes (`exportListRows`), reading `row[key]`.
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
