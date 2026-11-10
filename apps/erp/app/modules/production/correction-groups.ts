// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

type Edge = { operationId: string; dependsOnId: string };

/**
 * Groups a correction's operations as the routing runs them: an operation
 * that is "After Previous" (or first) starts a group; "With Previous" joins
 * the group before it.
 */
export function correctionOperationGroups(
  operations: { id: string; operationOrder: string }[]
): string[][] {
  const groups: string[][] = [];
  operations.forEach((operation, i) => {
    if (i > 0 && operation.operationOrder === "With Previous") {
      groups[groups.length - 1]!.push(operation.id);
    } else {
      groups.push([operation.id]);
    }
  });
  return groups;
}

/**
 * The status each new correction operation starts with: every operation of
 * the first group is Ready, since nothing it depends on is inserted; the rest
 * wait for the group before them.
 */
export function correctionInitialStatuses(
  operations: { operationOrder: string }[]
): ("Ready" | "Waiting")[] {
  const groups = correctionOperationGroups(
    operations.map((operation, i) => ({
      id: String(i),
      operationOrder: operation.operationOrder
    }))
  );
  const firstGroup = new Set(groups[0] ?? []);
  return operations.map((_, i) =>
    firstGroup.has(String(i)) ? "Ready" : "Waiting"
  );
}

/**
 * The dependencies a correction adds: each group waits for the whole group
 * before it; the re-inspection copy (when there is one) waits for the last
 * group; and every operation that waited for the triggering operation also
 * waits for where the correction converges (the copy, else the last group).
 */
export function correctionDependencyEdges(args: {
  groups: string[][];
  reinspectOperationId: string | null;
  downstreamOperationIds: string[];
}): Edge[] {
  const { groups, reinspectOperationId } = args;
  const edges: Edge[] = [];
  for (let g = 1; g < groups.length; g++) {
    for (const operationId of groups[g]!) {
      for (const dependsOnId of groups[g - 1]!) {
        edges.push({ operationId, dependsOnId });
      }
    }
  }
  const lastGroup = groups[groups.length - 1] ?? [];
  if (reinspectOperationId) {
    for (const dependsOnId of lastGroup) {
      edges.push({ operationId: reinspectOperationId, dependsOnId });
    }
  }
  const convergence = reinspectOperationId ? [reinspectOperationId] : lastGroup;
  for (const operationId of args.downstreamOperationIds) {
    for (const dependsOnId of convergence) {
      edges.push({ operationId, dependsOnId });
    }
  }
  return edges;
}

export type MatchableStep = {
  id: string;
  operationOrder: number;
  name: string;
  type: string;
  sortOrder: number;
};

/**
 * Pairs steps of two routings that have no link to each other (a quote's
 * copy of a make method, or a routing copied over another item's): a step
 * matches the step with the same operation order, name and type. Steps that
 * share all three pair up in sort order; a step with no partner is left out.
 * Returns source step id -> target step id.
 */
export function matchStepsByName(
  source: MatchableStep[],
  target: MatchableStep[]
): Record<string, string> {
  const keyOf = (step: MatchableStep) =>
    [Number(step.operationOrder), step.name.trim(), step.type].join("\u001f");
  const bySortOrder = (a: MatchableStep, b: MatchableStep) =>
    a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);
  const targetsByKey = new Map<string, MatchableStep[]>();
  for (const step of [...target].sort(bySortOrder)) {
    const list = targetsByKey.get(keyOf(step)) ?? [];
    list.push(step);
    targetsByKey.set(keyOf(step), list);
  }
  const map: Record<string, string> = {};
  for (const step of [...source].sort(bySortOrder)) {
    const next = targetsByKey.get(keyOf(step))?.shift();
    if (next) map[step.id] = next.id;
  }
  return map;
}
