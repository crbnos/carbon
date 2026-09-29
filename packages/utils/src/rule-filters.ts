// Item scoping for broadcast rules — which items a rule fires on.
//
// Split out of `rules.ts` (which is the AST compiler/evaluator) because this is
// a self-contained matcher with no dependency on the engine: both rule families
// use it to gate a broadcast rule against one item's type/posting group.

// Which items a broadcast rule fires on: optional type/group filters, empty =
// every item. Shared by BOTH rule families — storage rules and sales rules both
// scope their broadcasts this way, so the name carries no family.

export type ItemFilter = {
  filteredItemTypes?: string[];
  filteredItemGroupIds?: string[];
  /** false → OR across the two dimensions (any); true → AND (all). */
  filteredItemMatchAll?: boolean;
};

/**
 * Minimal item shape the filter matcher reads. The index signature keeps it
 * structurally compatible with the looser item-context records the evaluator
 * and loaders build (no cast needed at call sites).
 */
export type ItemCtx = Record<string, unknown> & {
  type?: unknown;
  itemPostingGroupId?: unknown;
};

export const ruleAppliesToItem = (item: ItemCtx, f: ItemFilter): boolean => {
  const types = f.filteredItemTypes ?? [];
  const groups = f.filteredItemGroupIds ?? [];
  if (types.length === 0 && groups.length === 0) return true; // empty = all
  // `null` = dimension not constrained; it drops out of the combination so a
  // single set dimension behaves identically under OR and AND.
  const typeMatch = types.length ? types.includes(item.type as string) : null;
  const groupMatch = groups.length
    ? item.itemPostingGroupId != null &&
      groups.includes(item.itemPostingGroupId as string)
    : null;
  return f.filteredItemMatchAll
    ? (typeMatch ?? true) && (groupMatch ?? true)
    : (typeMatch ?? false) || (groupMatch ?? false);
};

/** Normalize an `enforcementRule` row's nullable filter columns into a filter. */
export const toItemFilter = (row: {
  filteredItemTypes?: string[] | null;
  filteredItemGroupIds?: string[] | null;
  filteredItemMatchAll?: boolean | null;
}): ItemFilter => ({
  filteredItemTypes: row.filteredItemTypes ?? [],
  filteredItemGroupIds: row.filteredItemGroupIds ?? [],
  filteredItemMatchAll: row.filteredItemMatchAll ?? false
});

// Which root `FieldContext`s the evaluator builds per surface — a null value is
// a separate concern, handled by `isSet`/`isNotSet`. `"storage"` maps to the
// `storageUnit` root key. Locked by `packages/ee/src/rules/storage/context.test.ts`.
