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
