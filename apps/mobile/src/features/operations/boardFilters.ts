// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationCard, WorkCenterColumn } from "@carbon/mes-core";

/**
 * The board's filters.
 *
 * Web MES filters the board on Work Center, Process, Tag and Assignee
 * (`apps/mes/app/routes/x+/operations.tsx`). This covers the two whose option
 * lists arrive with their display NAMES already — work centres are the
 * columns, tags are `availableTags`. Process and assignee come over the wire
 * as bare ids, so offering them would mean a picker of uuids; they need the
 * server to send names first.
 *
 * Applied client-side rather than by refetching. Every operation for the
 * location is already in hand, so filtering is instant and a shop floor's
 * Wi-Fi is not involved — and unlike the server's `filter` params, clearing a
 * filter cannot leave the operator looking at a spinner.
 */

export type BoardFilters = {
  workCenterIds: string[];
  tags: string[];
};

export const EMPTY_FILTERS: BoardFilters = { workCenterIds: [], tags: [] };

export function activeFilterCount(filters: BoardFilters) {
  return filters.workCenterIds.length + filters.tags.length;
}

/** Toggles one value in one of the lists, which is what each row does. */
export function toggleFilter(
  filters: BoardFilters,
  key: keyof BoardFilters,
  value: string
): BoardFilters {
  const current = filters[key];
  return {
    ...filters,
    [key]: current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
  };
}

/** A tag filter matches when the operation carries ANY of the chosen tags. */
function matchesTags(operation: OperationCard, tags: string[]) {
  if (tags.length === 0) return true;
  const own = (operation as { tags?: string[] | null }).tags ?? [];
  return own.some((tag) => tags.includes(tag));
}

export function filterOperations(
  operations: OperationCard[],
  filters: BoardFilters
) {
  return operations.filter((operation) => matchesTags(operation, filters.tags));
}

/**
 * The columns to show.
 *
 * A work-centre filter hides the OTHER columns rather than emptying them —
 * an empty column still occupies a screen width on a phone, and the point of
 * choosing two work centres is to stop swiping past the other five.
 */
export function filterColumns(
  columns: WorkCenterColumn[],
  filters: BoardFilters
) {
  if (filters.workCenterIds.length === 0) return columns;
  return columns.filter((column) => filters.workCenterIds.includes(column.id));
}
