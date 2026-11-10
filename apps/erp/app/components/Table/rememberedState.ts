// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  ColumnOrderState,
  ColumnPinningState,
  VisibilityState
} from "@tanstack/react-table";

export type TableColumnsState = {
  columnVisibility: VisibilityState;
  columnOrder: ColumnOrderState;
  columnPinning: ColumnPinningState;
};

export type RememberedTableState = TableColumnsState & {
  filters: string[];
  sorts: string[];
};

export function tableStateKey(
  userId: string,
  companyId: string,
  tableName: string
) {
  return `carbon:table:${userId}:${companyId}:${tableName}`;
}

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const optionalStrings = (value: unknown) =>
  value === undefined || strings(value);

export function parseRememberedTableState(value: string | null) {
  if (!value) return null;
  try {
    const state: unknown = JSON.parse(value);
    if (!state || typeof state !== "object") return null;
    const candidate = state as Record<string, unknown>;
    if (
      !candidate.columnVisibility ||
      typeof candidate.columnVisibility !== "object" ||
      Array.isArray(candidate.columnVisibility) ||
      !Object.values(candidate.columnVisibility).every(
        (visibility) => typeof visibility === "boolean"
      ) ||
      !strings(candidate.columnOrder) ||
      !candidate.columnPinning ||
      typeof candidate.columnPinning !== "object" ||
      !optionalStrings((candidate.columnPinning as ColumnPinningState).left) ||
      !optionalStrings((candidate.columnPinning as ColumnPinningState).right) ||
      !strings(candidate.filters) ||
      !strings(candidate.sorts)
    ) {
      return null;
    }
    return candidate as RememberedTableState;
  } catch {
    return null;
  }
}

export function columnsForTable(
  savedView: TableColumnsState | null,
  remembered: RememberedTableState | null,
  defaults: TableColumnsState
): TableColumnsState {
  if (savedView) return savedView;
  if (!remembered) return defaults;
  return {
    ...remembered,
    columnVisibility: {
      ...defaults.columnVisibility,
      ...remembered.columnVisibility
    },
    columnOrder: remembered.columnOrder.length
      ? remembered.columnOrder
      : defaults.columnOrder
  };
}

/** Explicit URL values always win; a selected view never borrows local state. */
export function rememberedQuery(
  params: URLSearchParams,
  remembered: RememberedTableState | null,
  hasView: boolean
): URLSearchParams | null {
  if (hasView || !remembered) return null;
  const next = new URLSearchParams(params);
  if (!params.has("filter")) {
    for (const filter of remembered.filters) next.append("filter", filter);
  }
  if (!params.has("sort")) {
    for (const sort of remembered.sorts) next.append("sort", sort);
  }
  return next.toString() === params.toString() ? null : next;
}

export function columnsDiffer(
  current: TableColumnsState,
  defaults: TableColumnsState
) {
  const columnIds = new Set([
    ...Object.keys(current.columnVisibility),
    ...Object.keys(defaults.columnVisibility)
  ]);
  for (const id of columnIds) {
    if (
      (current.columnVisibility[id] ?? true) !==
      (defaults.columnVisibility[id] ?? true)
    ) {
      return true;
    }
  }
  return (
    JSON.stringify(current.columnOrder) !==
      JSON.stringify(defaults.columnOrder) ||
    JSON.stringify(current.columnPinning.left ?? []) !==
      JSON.stringify(defaults.columnPinning.left ?? []) ||
    JSON.stringify(current.columnPinning.right ?? []) !==
      JSON.stringify(defaults.columnPinning.right ?? [])
  );
}
