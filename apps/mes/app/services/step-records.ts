// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Rules for work-instruction step records (`jobOperationStepRecord`): one row
// per step and record set (`index`, the unit for a serial parent).

type StepWithRecords = {
  jobOperationStepRecord?: { index: number }[] | null;
};

/**
 * Every step has a record in this record set. An operation with no steps has
 * nothing missing. The Assembly view decides the same way per unit.
 */
export function allStepsRecordedAt(steps: StepWithRecords[], index: number) {
  return steps.every((step) =>
    (step.jobOperationStepRecord ?? []).some((r) => r.index === index)
  );
}

/**
 * The batch view's rows for one upsert at record set 0. A new record carries
 * the caller as its recorder. A step recorded again keeps its recorder
 * (`createdBy`; `createdAt` is left out, so the upsert keeps it) and gets
 * `updatedBy` / `updatedAt`.
 */
export function planBatchStepRecordRows<
  R extends { jobOperationStepId: string }
>(args: {
  records: R[];
  existing: { jobOperationStepId: string; createdBy: string }[];
  companyId: string;
  userId: string;
  now: string;
}) {
  const existingByStep = new Map(
    args.existing.map((r) => [r.jobOperationStepId, r])
  );
  const rows = args.records.map((record) => {
    const existing = existingByStep.get(record.jobOperationStepId);
    return {
      ...record,
      index: 0,
      companyId: args.companyId,
      createdBy: existing?.createdBy ?? args.userId,
      updatedBy: existing ? args.userId : null,
      updatedAt: existing ? args.now : null
    };
  });
  return { rows };
}
