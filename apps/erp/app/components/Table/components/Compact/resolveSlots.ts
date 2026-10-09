// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Column } from "@tanstack/react-table";

/** Columns the Table adds itself; they never fill a compact row slot. */
const STRUCTURAL_COLUMN_IDS = new Set(["Select", "Actions", "Expand"]);

const MAX_PILLS = 2;

export type CompactSlots<T> = {
  /** Line 1, leading: the record identity. */
  p1: Column<T, unknown>;
  /** Line 1, trailing: the primary metric (amount, quantity, date). */
  p2?: Column<T, unknown>;
  /** Line 2: the most useful context. */
  p3?: Column<T, unknown>;
  /** Line 3: status pills (enumerated P2 columns), at most two. */
  pills: Column<T, unknown>[];
  /** Trailing: the row's one action button. */
  action?: Column<T, unknown>;
};

/**
 * A P2 column filtered by a fixed option list is a status, shown as a pill;
 * `meta.mobilePill` marks a status column that has no such filter.
 */
function isStatusColumn<T>(column: Column<T, unknown>) {
  const meta = column.columnDef.meta;
  return Boolean(meta?.mobilePill) || meta?.filter?.type === "static";
}

/**
 * Map a table's visible columns onto the compact row from their
 * `meta.mobile` priorities. Without a P1, the first data column stands in and
 * a dev warning names the table, so a forgotten annotation never renders blank.
 * Returns null when the table has no data column at all.
 */
export function resolveSlots<T>(
  columns: Column<T, unknown>[],
  tableName = "table"
): CompactSlots<T> | null {
  const data = columns.filter((c) => !STRUCTURAL_COLUMN_IDS.has(c.id));
  if (data.length === 0) return null;

  const byPriority = (p: "P1" | "P2" | "P3" | "action") =>
    data.filter((c) => c.columnDef.meta?.mobile === p);

  let p1 = byPriority("P1")[0];
  if (!p1) {
    p1 = data[0];
    if (process.env.NODE_ENV !== "production") {
      // biome-ignore lint/suspicious/noConsole: dev-only authoring warning
      console.warn(
        `[CompactList] no P1 column in ${tableName}; using "${p1.id}". Add meta.mobile to its columns.`
      );
    }
  }

  const p2Columns = byPriority("P2").filter((c) => c !== p1);
  const p2 = p2Columns.find((c) => !isStatusColumn(c));
  const pills = p2Columns.filter(isStatusColumn).slice(0, MAX_PILLS);
  const p3 = byPriority("P3").find((c) => c !== p1);
  const action = byPriority("action").find((c) => c !== p1);

  return { p1, p2, p3, pills, action };
}
