// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationCard, WorkCenterColumn } from "@carbon/mes-core";

/**
 * The board's filters: the same four web MES offers
 * (`apps/mes/app/routes/x+/operations.tsx`) — work centre, process, tag and
 * assignee.
 *
 * Each is a list of IDS, and each id's display name comes from somewhere
 * different: a work centre is a column, a tag is already its own label, a
 * process is named by the screen payload's `processes`, and an assignee is
 * named by a lookup (`useBoardPeople`) because the payload carries only the
 * user id. Keeping the filters as ids means this file never has to know
 * which of those four it is looking at.
 *
 * Applied client-side rather than by refetching. Every operation for the
 * location is already in hand, so filtering is instant and a shop floor's
 * Wi-Fi is not involved — and unlike the server's `filter` params, clearing a
 * filter cannot leave the operator looking at a spinner.
 */

export type BoardFilters = {
  workCenterIds: string[];
  processIds: string[];
  tags: string[];
  assignees: string[];
};

export const EMPTY_FILTERS: BoardFilters = {
  workCenterIds: [],
  processIds: [],
  tags: [],
  assignees: []
};

export function activeFilterCount(filters: BoardFilters) {
  return (
    filters.workCenterIds.length +
    filters.processIds.length +
    filters.tags.length +
    filters.assignees.length
  );
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

/**
 * A process filter matches the card's own process.
 *
 * The field is `columnType` — the board's columns are work centres and their
 * TYPE is the process, which is the name web has always sent it under.
 */
function matchesProcess(operation: OperationCard, processIds: string[]) {
  if (processIds.length === 0) return true;
  return processIds.includes(operation.columnType ?? "");
}

/**
 * An assignee filter matches the card's assignee.
 *
 * `UNASSIGNED` is a real choice rather than an omission: "what is nobody
 * working on" is the question a lead asks of a board, and leaving it out
 * would make the filter answer only half of it. The sentinel cannot collide
 * with a user id, which is a nanoid.
 */
export const UNASSIGNED = "__unassigned__";

function matchesAssignee(operation: OperationCard, assignees: string[]) {
  if (assignees.length === 0) return true;
  return assignees.includes(operation.assignee || UNASSIGNED);
}

export function filterOperations(
  operations: OperationCard[],
  filters: BoardFilters
) {
  return operations.filter(
    (operation) =>
      matchesTags(operation, filters.tags) &&
      matchesProcess(operation, filters.processIds) &&
      matchesAssignee(operation, filters.assignees)
  );
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

/**
 * Columns worth showing for a search.
 *
 * Searching the board is not the same as searching a list: the columns are
 * work centres, and a term that matches two operations would otherwise leave
 * the operator paging through a row of empty work centres to find them. So
 * while a search is active the board shows only the columns that still hold
 * something — and when it is cleared, every column comes back.
 *
 * Takes the ALREADY-searched operations, so the caller cannot apply the term
 * to the cards and the columns inconsistently.
 */
export function columnsWithResults<T extends { id: string }>(
  columns: T[],
  searched: OperationCard[],
  searchTerm: string
): T[] {
  if (searchTerm.trim() === "") return columns;
  const withResults = new Set(searched.map((item) => item.columnId ?? ""));
  return columns.filter((column) => withResults.has(column.id));
}
