// Pure helpers for the planning grid's Actions column / "Assigned to me" scope.
// No JSX, no lingui — unit-tested by apps/erp/test/planning-action-scope.test.ts.

/** Column id of the planning grid's Actions column — also the `filter=` key
 *  its static type filter writes (`planningActions:eq:Expedite`, or `:in:` for
 *  several). The grid RPC has no such column, so the loader resolves it to an
 *  item-id restriction with `resolvePlanningActionScope` instead of passing it
 *  through. */
export const PLANNING_ACTIONS_COLUMN = "planningActions";
/** Bare URL param for the grid's "Assigned to me" quick filter: `?actions=mine`. */
export const PLANNING_ACTIONS_SCOPE_PARAM = "actions";
export const PLANNING_ACTIONS_SCOPE_MINE = "mine";

type PlanningActionScopeRow = {
  itemId: string;
  type: string;
  status: string;
  assignee: string | null;
};

/**
 * Splits the grid's URL filters into the ones the planning RPC understands and
 * the Actions-column filter / "mine" scope, which become `itemIds`: the items
 * with at least one OPEN action matching every requested predicate. Returns
 * `itemIds: undefined` when nothing restricts the grid, and `[]` (no rows)
 * when a restriction matched nothing.
 */
export function resolvePlanningActionScope<
  A extends PlanningActionScopeRow
>(args: {
  filters?: { column: string; operator: string; value?: string }[];
  scope: string | null;
  userId: string;
  actions: A[];
}): {
  gridFilters: { column: string; operator: string; value?: string }[];
  itemIds: string[] | undefined;
} {
  const all = args.filters ?? [];
  const gridFilters = all.filter((f) => f.column !== PLANNING_ACTIONS_COLUMN);
  const types = all
    .filter((f) => f.column === PLANNING_ACTIONS_COLUMN)
    .flatMap((f) => (f.value ?? "").split(",").filter(Boolean));
  const mine = args.scope === PLANNING_ACTIONS_SCOPE_MINE;

  if (!mine && types.length === 0) {
    return { gridFilters, itemIds: undefined };
  }

  const itemIds = [
    ...new Set(
      args.actions
        .filter(
          (a) =>
            a.status === "Open" &&
            (!mine || a.assignee === args.userId) &&
            (types.length === 0 || types.includes(a.type))
        )
        .map((a) => a.itemId)
    )
  ];
  return { gridFilters, itemIds };
}
