// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The Batches table columns that show a value computed from the row, by
 * column id. The table exports them with these, and the background CSV
 * export writes the same values (`operationBatchesList.exportValues`).
 */
type Row = {
  process?: { name: string | null } | null;
  workCenterName?: string | null;
};

export const BATCH_LIST_EXPORT_VALUES = {
  process: (row: Row) => row.process?.name ?? null,
  workCenter: (row: Row) => row.workCenterName ?? null
} satisfies Record<string, (row: Row) => string | null>;
