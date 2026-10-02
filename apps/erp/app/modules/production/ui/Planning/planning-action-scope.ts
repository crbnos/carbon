// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure helpers for the planning grid's Actions and Assignee filters.
// No JSX, no lingui — unit-tested by apps/erp/test/planning-action-scope.test.ts.

/** Column id of the planning grid's Actions column — also the `filter=` key
 *  its static type filter writes (`planningActions:eq:Expedite`, or `:in:` for
 *  several). It is not a column of the grid RPC: the loader strips it with
 *  `resolvePlanningActionScope` and hands it to the RPC as an argument, which
 *  evaluates it in the database against each item's planning horizon. */
export const PLANNING_ACTIONS_COLUMN = "planningActions";
/** Column id of the grid's Assignee column, and the `filter=` key of its
 *  people filter (`planningAssignee:in:<userId>,<userId>`). Like the Actions
 *  filter it is not an RPC column: the loader turns it into the RPC's
 *  assignees argument. */
export const PLANNING_ASSIGNEE_COLUMN = "planningAssignee";

type GridFilter = { column: string; operator: string; value?: string };

/**
 * Splits the grid's URL filters into the ones the planning RPC can apply as
 * column filters and the Actions / Assignee filters, which become RPC
 * ARGUMENTS: the grid keeps the items with at least one OPEN action, inside the
 * item's planning horizon, that matches every requested predicate on the SAME
 * action (one of the types AND assigned to one of the people). `undefined` means "no restriction of that kind".
 *
 * The RPC does the matching (not this function, and not an item-id list) so the
 * filter is complete at any volume and sees the horizon: an earlier version
 * resolved item ids from the first 500 loaded actions and silently dropped
 * items beyond that.
 */
export function resolvePlanningActionScope(args: { filters?: GridFilter[] }): {
  gridFilters: GridFilter[];
  actionTypes: string[] | undefined;
  actionAssignees: string[] | undefined;
} {
  const all = args.filters ?? [];
  const valuesOf = (column: string) => [
    ...new Set(
      all
        .filter((f) => f.column === column)
        .flatMap((f) => (f.value ?? "").split(",").filter(Boolean))
    )
  ];
  const types = valuesOf(PLANNING_ACTIONS_COLUMN);
  const assignees = valuesOf(PLANNING_ASSIGNEE_COLUMN);

  return {
    gridFilters: all.filter(
      (f) =>
        f.column !== PLANNING_ACTIONS_COLUMN &&
        f.column !== PLANNING_ASSIGNEE_COLUMN
    ),
    actionTypes: types.length > 0 ? types : undefined,
    actionAssignees: assignees.length > 0 ? assignees : undefined
  };
}

/**
 * The actions a row SHOWS under the Actions-column filter: only the filtered
 * types. The RPC keeps an item when it has one matching action, but the item
 * usually carries others too — a grid filtered to Expedite that still listed
 * each row's Defer and Cancel read as an unfiltered grid. No types (no filter)
 * shows everything.
 */
export function actionsOfTypes<A extends { type: string }>(
  actions: A[],
  types: string[] | null | undefined
): A[] {
  if (!types || types.length === 0) return actions;
  return actions.filter((action) => types.includes(action.type));
}
