// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JobOperationSummary } from "@carbon/mes-core";

/**
 * A job's operations in the order they actually run.
 *
 * Web draws them as a graph — nodes joined by dependency edges, which is the
 * honest shape, because a job can fan out and rejoin. A tablet held at a
 * machine gets a LIST instead: a graph there needs pan, zoom and fit before
 * an operator can read it, and the question they came with is "which
 * operation do I open", not "what is the topology".
 *
 * The list is still ordered BY the dependencies rather than by the `order`
 * column, so a fan-out reads top to bottom in a sequence that is at least
 * runnable. Where two operations are genuinely parallel the order between
 * them is arbitrary — that is information the list cannot carry, and the
 * honest reading of it is "either of these next", not "this one then that".
 */

type Dependency = { operationId: string; dependsOnId: string };

/**
 * Topological order, falling back to `order` then id for anything the
 * dependencies do not constrain.
 *
 * A CYCLE cannot hang this. Operations never reached by the walk are
 * appended in their fallback order, so a malformed job renders in full
 * rather than silently losing the operations inside the cycle — which is the
 * failure an operator would never diagnose.
 */
export function orderOperations(
  operations: JobOperationSummary[],
  dependencies: Dependency[]
): JobOperationSummary[] {
  const byId = new Map(
    operations.map((operation) => [operation.id, operation])
  );

  // Count only the dependencies whose BOTH ends are in this job. A dangling
  // id would otherwise give an operation a prerequisite that never arrives,
  // and it would never be emitted.
  const blockedBy = new Map<string, number>();
  const unlocks = new Map<string, string[]>();
  for (const operation of operations) {
    blockedBy.set(operation.id, 0);
    unlocks.set(operation.id, []);
  }
  for (const edge of dependencies) {
    if (!byId.has(edge.operationId) || !byId.has(edge.dependsOnId)) continue;
    blockedBy.set(edge.operationId, (blockedBy.get(edge.operationId) ?? 0) + 1);
    unlocks.get(edge.dependsOnId)?.push(edge.operationId);
  }

  const fallback = (a: JobOperationSummary, b: JobOperationSummary) =>
    (a.order ?? Number.MAX_SAFE_INTEGER) -
      (b.order ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id);

  // Ready operations are kept sorted, so a job with no dependencies at all
  // comes out in `order` — the sequence a planner typed.
  const ready = operations
    .filter((operation) => (blockedBy.get(operation.id) ?? 0) === 0)
    .sort(fallback);

  const out: JobOperationSummary[] = [];
  const emitted = new Set<string>();

  while (ready.length > 0) {
    const next = ready.shift() as JobOperationSummary;
    if (emitted.has(next.id)) continue;
    out.push(next);
    emitted.add(next.id);

    for (const unlockedId of unlocks.get(next.id) ?? []) {
      const remaining = (blockedBy.get(unlockedId) ?? 0) - 1;
      blockedBy.set(unlockedId, remaining);
      const unlocked = byId.get(unlockedId);
      if (remaining === 0 && unlocked && !emitted.has(unlockedId)) {
        ready.push(unlocked);
        ready.sort(fallback);
      }
    }
  }

  // Whatever the walk could not reach — a cycle, or an operation depending on
  // one outside this job.
  const stranded = operations
    .filter((operation) => !emitted.has(operation.id))
    .sort(fallback);

  return [...out, ...stranded];
}
