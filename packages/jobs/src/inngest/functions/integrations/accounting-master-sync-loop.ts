// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The master-data push loop, lifted out of `accounting-master-sync.ts`.
 *
 * Import-light on purpose (same reason as `master-data-targets.ts` and
 * `reconcile.ts`): the Inngest-function module validates the server env at
 * import time, so the progress rule could not be unit-tested where it lived.
 */

export type PushLoopCounts = {
  succeeded: number;
  skipped: number;
  failed: number;
};

/**
 * Read a page of still-unmapped ids, push it, repeat — for one entity type.
 *
 * **It must never hand the same id to two batches.** `getUnsyncedEntityIds`
 * applies its `limit` with no `ORDER BY` (`@carbon/ee` `core/external-mapping`),
 * so two reads of an unchanged table may return the SAME page — and a batch
 * whose pushes all failed leaves every one of its records unmapped, so that page
 * is exactly what comes back. Re-enqueueing those ids resolves to the Failed
 * rows already on the ledger (same run scope → same idempotency key, and
 * `enqueueSyncOperation` returns the existing row), so nothing new is Pending,
 * the drain claims nothing, and the old `claimed === 0` break fired. Every
 * record BEHIND the failing page was then never attempted at all, while the run
 * returned "complete" — head-of-line blocking that a re-run reproduces, because
 * it reads the same page and fails the same way.
 *
 * So the loop owns its own progress: it remembers the ids it has already handed
 * to a batch, asks for enough candidates to cover them, and advances on what is
 * left. Termination no longer depends on the database's choice of plan, and
 * `maxBatches` remains the bound.
 */
export async function runUnmappedPushLoop(args: {
  batchSize: number;
  maxBatches: number;
  /**
   * Candidate unmapped ids, up to `limit`. Order is NOT guaranteed — the loop
   * asks for `batchSize + alreadyAttempted` and filters.
   */
  fetchCandidateIds: (limit: number, index: number) => Promise<string[]>;
  runBatch: (
    index: number,
    entityIds: string[]
  ) => Promise<PushLoopCounts & { claimed: number }>;
  delay: (index: number) => Promise<void>;
}): Promise<PushLoopCounts> {
  const counts: PushLoopCounts = { succeeded: 0, skipped: 0, failed: 0 };
  const attempted = new Set<string>();

  for (let index = 0; index < args.maxBatches; index++) {
    const candidateIds = await args.fetchCandidateIds(
      args.batchSize + attempted.size,
      index
    );

    const batchIds = candidateIds
      .filter((id) => !attempted.has(id))
      .slice(0, args.batchSize);
    if (batchIds.length === 0) break;
    for (const id of batchIds) attempted.add(id);

    const batchCounts = await args.runBatch(index, batchIds);
    counts.succeeded += batchCounts.succeeded;
    counts.skipped += batchCounts.skipped;
    counts.failed += batchCounts.failed;

    // A short page means the candidate pool is exhausted. `claimed` is
    // deliberately NOT a stop condition any more: it counts the drain's whole
    // company-wide claim, so an unrelated pending operation inflated it, and a
    // zero claim on a batch whose enqueues were absorbed is what truncated the
    // run described above.
    if (batchIds.length < args.batchSize) break;

    await args.delay(index);
  }

  return counts;
}
