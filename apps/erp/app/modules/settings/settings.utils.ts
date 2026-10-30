// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** DISTINCT rows per table. The ONLY shape a user-facing total may be summed from. */
export type RowsByTable = { table: string; rows: number };

/**
 * How many ROWS a skip or purge affects. `violations`/`excludedRows` are per FK
 * EDGE — a row escaping scope through three of its foreign keys appears three
 * times there — so totals must come from the per-table distinct counts.
 */
export function totalScopeRows(rowsByTable: RowsByTable[]): number {
  return rowsByTable.reduce((sum, t) => sum + t.rows, 0);
}

/**
 * The last refusal, unless an exchange succeeded after it. The rule id is
 * public, so a refusal alone may be someone else's noise.
 */
export function currentRefusal(rule: {
  lastFailureReason: string | null;
  lastFailureAt: string | null;
  lastExchangeAt: string | null;
}): string | null {
  if (!rule.lastFailureReason || !rule.lastFailureAt) return null;
  if (
    rule.lastExchangeAt &&
    Date.parse(rule.lastExchangeAt) > Date.parse(rule.lastFailureAt)
  ) {
    return null;
  }
  return rule.lastFailureReason;
}
