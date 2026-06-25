// Pure per-row decision for supplier/customer CSV import. No DB, no I/O — so it
// is unit-testable with `deno test`. The driver loop owns the running `seenIds`
// / `seenNames` sets and applies the returned action.
//
// Root-cause fix: a blank CSV id must NEVER participate in in-file dedup. The
// previous loop added "" to a Set and then treated every later blank-id row as a
// duplicate, silently dropping them (1 of 58 imported). Here, dedup keys are the
// non-empty id and the (always-present) name.

export type RowDecision =
  | { action: "insert" }
  | { action: "update"; entityId: string }
  | { action: "skip"; reason: string; category: "error" | "skipped" };

export function classifyImportRow(params: {
  id: string;
  name: string;
  externalIdMap: Map<string, string>;
  nameMap: Map<string, string>;
  seenIds: Set<string>;
  seenNames: Set<string>;
}): RowDecision {
  const { id, name, externalIdMap, nameMap, seenIds, seenNames } = params;

  // `name` can be undefined at runtime when the CSV's Name column is unmapped.
  if (!name || name.trim() === "") {
    return { action: "skip", reason: "Missing required Name", category: "error" };
  }
  if (id && seenIds.has(id)) {
    return {
      action: "skip",
      reason: `Duplicate ID "${id}" in file`,
      category: "skipped",
    };
  }
  if (seenNames.has(name)) {
    return {
      action: "skip",
      reason: `Duplicate name "${name}" in file`,
      category: "skipped",
    };
  }

  // The CSV name is matched as-is. Whitespace/case normalization is intentionally
  // out of scope for this data-loss fix and is handled by the later identity redesign.
  const matchedById = id ? externalIdMap.get(id) : undefined;
  const matchedByName = matchedById === undefined ? nameMap.get(name) : undefined;
  const existingEntityId = matchedById ?? matchedByName;

  if (existingEntityId !== undefined) {
    return { action: "update", entityId: existingEntityId };
  }
  return { action: "insert" };
}
