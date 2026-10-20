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
