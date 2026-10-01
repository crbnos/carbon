// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure helpers for the planning grid's Actions column / "Assigned to me" scope.
// No JSX, no lingui — unit-tested by apps/erp/test/planning-action-scope.test.ts.

/** Column id of the planning grid's Actions column — also the `filter=` key
 *  its static type filter writes (`planningActions:eq:Expedite`, or `:in:` for
 *  several). It is not a column of the grid RPC: the loader strips it with
 *  `resolvePlanningActionScope` and hands it to the RPC as an argument, which
 *  evaluates it in the database against each item's planning horizon. */
export const PLANNING_ACTIONS_COLUMN = "planningActions";
/** Bare URL param for the grid's "Assigned to me" quick filter: `?actions=mine`. */
export const PLANNING_ACTIONS_SCOPE_PARAM = "actions";
export const PLANNING_ACTIONS_SCOPE_MINE = "mine";

type GridFilter = { column: string; operator: string; value?: string };

/**
 * Splits the grid's URL filters into the ones the planning RPC can apply as
 * column filters and the Actions-column filter / "mine" scope, which become RPC
 * ARGUMENTS: the grid keeps the items with at least one OPEN action, inside the
 * item's planning horizon, that matches every requested predicate on the SAME
 * action. `undefined` means "no restriction of that kind".
 *
 * The RPC does the matching (not this function, and not an item-id list) so the
 * filter is complete at any volume and sees the horizon: an earlier version
 * resolved item ids from the first 500 loaded actions and silently dropped
 * items beyond that.
 */
export function resolvePlanningActionScope(args: {
  filters?: GridFilter[];
  scope: string | null;
  userId: string;
}): {
  gridFilters: GridFilter[];
  actionTypes: string[] | undefined;
  actionAssignee: string | undefined;
} {
  const all = args.filters ?? [];
  const gridFilters = all.filter((f) => f.column !== PLANNING_ACTIONS_COLUMN);
  const types = [
    ...new Set(
      all
        .filter((f) => f.column === PLANNING_ACTIONS_COLUMN)
        .flatMap((f) => (f.value ?? "").split(",").filter(Boolean))
    )
  ];

  return {
    gridFilters,
    actionTypes: types.length > 0 ? types : undefined,
    actionAssignee:
      args.scope === PLANNING_ACTIONS_SCOPE_MINE ? args.userId : undefined
  };
}
