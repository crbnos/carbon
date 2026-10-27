// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The Jobs table columns whose values the loader adds to each page's rows, by
 * column id. The table exports them with these, and the background CSV export
 * writes the same values (`jobsList.exportValues`).
 */
type Row = {
  batchReadableIds?: string[] | null;
  trackedEntityReadableId?: string | null;
};

export const JOB_LIST_EXPORT_VALUES = {
  batches: (row: Row) => (row.batchReadableIds ?? []).join(", "),
  trackedEntityId: (row: Row) => row.trackedEntityReadableId ?? null
} satisfies Record<string, (row: Row) => string | null>;
