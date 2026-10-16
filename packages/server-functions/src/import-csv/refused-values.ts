// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** Per field, the label to name it by and the cell values its caller could not match. */
export type RefusedValues = Record<string, { label: string; values: string[] }>;

/**
 * Splits parsed rows into the ones to import and the ones holding a refused
 * value, each refused row with its reason. Values compare trimmed, as the
 * caller matched them. Without refused values every row is kept.
 */
export function rowsWithoutRefusedValues(
  rows: Record<string, string>[],
  columnMappings: Record<string, string>,
  refusedValues: RefusedValues = {}
): { kept: number[]; refused: Array<{ row: number; reason: string }> } {
  const checks = Object.entries(refusedValues).flatMap(([key, refusal]) => {
    const column = columnMappings[key];
    return column
      ? [{ column, label: refusal.label, values: new Set(refusal.values) }]
      : [];
  });
  const kept: number[] = [];
  const refused: Array<{ row: number; reason: string }> = [];
  for (const [rowIndex, row] of rows.entries()) {
    const reasons = checks.flatMap((check) => {
      const value = row[check.column]?.trim() ?? "";
      return check.values.has(value)
        ? [`${check.label} "${value}" matches no option`]
        : [];
    });
    if (reasons.length > 0)
      refused.push({ row: rowIndex, reason: reasons.join("; ") });
    else kept.push(rowIndex);
  }
  return { kept, refused };
}
