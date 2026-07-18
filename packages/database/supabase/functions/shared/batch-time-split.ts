// Proportional time-splitting + completion planning for a job operation batch.
//
// Deno-side MIRROR of packages/utils/src/batch-time-split.ts. Deno edge functions
// cannot import workspace packages, so this pure logic is duplicated here. The
// canonical version (with the vitest coverage) is the @carbon/utils file — keep
// the two in sync. See .ai/specs/2026-07-03-job-operation-batching.md.

export interface BatchMemberWeight {
  id: string;
  weight: number;
}

export interface DurationShare {
  id: string;
  durationSeconds: number;
}

/**
 * Split `totalSeconds` across members proportionally to their weights using the
 * largest-remainder method, so the shares are whole seconds that sum EXACTLY to
 * `totalSeconds`. Weight Σ=0 falls back to an even split; negatives clamp to 0.
 */
export function splitSecondsByWeight(
  totalSeconds: number,
  members: BatchMemberWeight[]
): DurationShare[] {
  if (members.length === 0) return [];
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return members.map((m) => ({ id: m.id, durationSeconds: 0 }));
  }

  const total = Math.floor(totalSeconds);
  const weights = members.map((m) => (m.weight > 0 ? m.weight : 0));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const effective = weightSum > 0 ? weights : members.map(() => 1);
  const effectiveSum = weightSum > 0 ? weightSum : members.length;

  const raw = effective.map((w) => (total * w) / effectiveSum);
  const floors = raw.map((r) => Math.floor(r));
  let remaining = total - floors.reduce((a, b) => a + b, 0);

  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const shares = floors.slice();
  for (let k = 0; k < order.length && remaining > 0; k++) {
    const idx = order[k]!.i;
    shares[idx] = (shares[idx] ?? 0) + 1;
    remaining -= 1;
  }

  return members.map((m, i) => ({ id: m.id, durationSeconds: shares[i] ?? 0 }));
}

export interface EventWindow {
  id: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
}

/**
 * Slice a recorded event span [startTime, endTime) into contiguous per-member
 * sub-windows whose durations are the proportional split of the span.
 */
export function sliceEventByWeight(
  event: { startTime: string; endTime: string },
  members: BatchMemberWeight[]
): EventWindow[] {
  const startMs = Date.parse(event.startTime);
  const endMs = Date.parse(event.endTime);
  const totalSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));

  const shares = splitSecondsByWeight(totalSeconds, members);

  let cursorMs = startMs;
  return shares.map((share, i) => {
    const windowStartMs = cursorMs;
    const windowEndMs =
      i === shares.length - 1
        ? endMs
        : windowStartMs + share.durationSeconds * 1000;
    cursorMs = windowEndMs;
    return {
      id: share.id,
      startTime: new Date(windowStartMs).toISOString(),
      endTime: new Date(windowEndMs).toISOString(),
      durationSeconds: Math.round((windowEndMs - windowStartMs) / 1000)
    };
  });
}

export interface BatchCompletionMember {
  jobOperationId: string;
  operationQuantity: number;
  quantity: number;
  scrapQuantity?: number;
}

export interface RecordedBatchEvent {
  id: string;
  type: string | null;
  startTime: string;
  endTime: string;
  workCenterId: string | null;
  employeeId: string | null;
}

export interface PlannedMemberEvent {
  jobOperationId: string;
  sourceEventId: string;
  type: string | null;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  workCenterId: string | null;
  employeeId: string | null;
}

export interface PlannedProductionQuantity {
  jobOperationId: string;
  type: "Production" | "Scrap";
  quantity: number;
}

export interface BatchCompletionPlan {
  memberEvents: PlannedMemberEvent[];
  quantities: PlannedProductionQuantity[];
}

/**
 * Build the exact per-member `productionEvent` + `productionQuantity` rows a
 * batch completion must write. Each recorded batch event is sliced across the
 * members proportionally to their planned `operationQuantity`; every member
 * emits a Production row (plus a Scrap row when `scrapQuantity > 0`).
 */
export function buildBatchCompletionPlan(
  events: RecordedBatchEvent[],
  members: BatchCompletionMember[]
): BatchCompletionPlan {
  const weights: BatchMemberWeight[] = members.map((m) => ({
    id: m.jobOperationId,
    weight: m.operationQuantity
  }));

  const memberEvents: PlannedMemberEvent[] = [];
  for (const event of events) {
    const windows = sliceEventByWeight(event, weights);
    for (const w of windows) {
      memberEvents.push({
        jobOperationId: w.id,
        sourceEventId: event.id,
        type: event.type,
        startTime: w.startTime,
        endTime: w.endTime,
        durationSeconds: w.durationSeconds,
        workCenterId: event.workCenterId,
        employeeId: event.employeeId
      });
    }
  }

  const quantities: PlannedProductionQuantity[] = [];
  for (const m of members) {
    if (m.quantity > 0) {
      quantities.push({
        jobOperationId: m.jobOperationId,
        type: "Production",
        quantity: m.quantity
      });
    }
    if ((m.scrapQuantity ?? 0) > 0) {
      quantities.push({
        jobOperationId: m.jobOperationId,
        type: "Scrap",
        quantity: m.scrapQuantity as number
      });
    }
  }

  return { memberEvents, quantities };
}

/**
 * Validate the members submitted to complete a batch against the batch's ACTUAL
 * membership. The submitted list must match the real membership EXACTLY: a
 * duplicate would double-count quantity/issue, an unknown id would fabricate
 * output, and an omitted real member would silently under-complete the batch.
 * Throws on the first violation; returns nothing on success. Pure — keep in sync
 * with packages/utils/src/batch-time-split.ts (the vitest-covered canonical copy).
 */
export function assertBatchCompletionMembership(
  submittedIds: string[],
  actualMemberIds: string[]
): void {
  const submitted = new Set<string>();
  for (const id of submittedIds) {
    if (submitted.has(id)) {
      throw new Error(`Operation ${id} was submitted more than once`);
    }
    submitted.add(id);
  }

  const actual = new Set(actualMemberIds);
  for (const id of submitted) {
    if (!actual.has(id)) {
      throw new Error(`Operation ${id} is not a member of this batch`);
    }
  }
  for (const id of actual) {
    if (!submitted.has(id)) {
      throw new Error(
        `Operation ${id} is a member of this batch and must be included to complete it`
      );
    }
  }
}

/**
 * Postcondition guard for the atomic "claim" of operations into a batch. The
 * claim UPDATE carries `WHERE "jobOperationBatchId" IS NULL`, so a row already
 * grabbed by a concurrent create/add is skipped by the WHERE rather than
 * overwritten. If the number of rows actually updated falls short of the number
 * of distinct operations requested, another transaction won the race for at
 * least one operation — throw so the whole claim rolls back instead of silently
 * batching a subset. Pure — keep in sync with packages/utils/src/batch-time-split.ts.
 */
export function assertAllOperationsClaimed(
  requestedIds: string[],
  updatedRowCount: number
): void {
  const expected = new Set(requestedIds).size;
  if (updatedRowCount !== expected) {
    throw new Error(
      "One or more operations were already claimed by another batch — refresh and try again"
    );
  }
}

/**
 * Guard for mutating a batch's work center. A Completed or Cancelled batch is
 * terminal: its recorded production events are already attributed to a machine,
 * so re-pointing the work center would rewrite history. Only an Active batch may
 * be re-pointed — and the call site additionally blocks the change once any
 * production event exists (production has started). Pure; the production-event
 * check remains at the DB layer. Keep in sync with packages/utils/src/batch-time-split.ts.
 */
export function assertBatchWorkCenterMutable(status: string): void {
  if (status !== "Active") {
    throw new Error(
      "Cannot change the work center of a batch that is not active"
    );
  }
}

/**
 * The two phases of the resumable batch-completion workflow, chosen from the
 * batch's current status:
 *
 *  - `"slice"`  — the batch is `Active`. Runs ONCE: the completion transaction
 *                 slices the recorded batch timers into per-member events +
 *                 quantities and flips the batch `Active` -> `Completing`.
 *  - `"resume"` — the batch is already `Completing`, meaning a prior attempt
 *                 committed the slice but a post-commit effect (material issue,
 *                 member Done, or GL posting) failed. Re-run ONLY the idempotent
 *                 post-commit steps; the aggregate timers are already gone, so the
 *                 slice must NOT be repeated.
 *
 * A `Completed` batch is terminal (rejected), as is any other status (e.g.
 * `Cancelled`). Pure — keep in sync with packages/utils/src/batch-time-split.ts
 * (the vitest-covered canonical copy).
 */
export function planBatchCompletion(status: string): "slice" | "resume" {
  switch (status) {
    case "Active":
      return "slice";
    case "Completing":
      return "resume";
    case "Completed":
      throw new Error("This batch has already been completed");
    default:
      throw new Error("Only an active batch can be completed");
  }
}
