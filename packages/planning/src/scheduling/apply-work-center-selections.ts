// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { businessDay } from "./date-utils.ts";
import type { ScheduledOperation, WorkCenterSelection } from "./types.ts";

/**
 * Apply work center selections to scheduled operations.
 *
 * Pure module (no provider/database imports).
 *
 * `timeZone` is the job location's IANA zone: the placed start is recorded
 * onto the date-only `startDate` column as the FACTORY's calendar day (an op
 * starting 03:04 local on the 21st must not be stored as starting the 20th).
 * The placed end keeps its exact instant on `projectedCompletionAt`;
 * `dueDate` is the backward need-by target and is NEVER written here
 * (spec 2026-08-15 dual dates).
 */
/**
 * True when an operation already has a non-empty work center assignment
 * (user drag on ops board, method default, prior schedule, etc.).
 */
export function hasPreassignedWorkCenter(
  workCenterId: string | null | undefined
): boolean {
  return workCenterId != null && workCenterId !== "";
}

/**
 * True once an operation has begun on the floor. A started op stays on its
 * machine (setups, fixtures and operators live there); an unstarted op may be
 * balanced onto another work center that runs its process.
 */
export function isOperationStarted(op: {
  status?: string | null;
  quantityComplete?: number | null;
}): boolean {
  return (
    op.status === "In Progress" ||
    op.status === "Paused" ||
    (op.quantityComplete ?? 0) > 0
  );
}

/**
 * The work center a STARTED operation stays on: its stored one, when it is
 * active at the job's location (`validHere`: the selector's capacity set, or
 * the location's active work centers for the hold) and the op has a process.
 * Null when the selector will not keep it there: not started, no process (no
 * candidate at all), or a stored work center not valid here. The started-op
 * hold uses the same rule, so it never holds a machine the op will not run on.
 */
export function startedOperationWorkCenter(
  op: {
    processId?: string | null;
    workCenterId?: string | null;
    status?: string | null;
    quantityComplete?: number | null;
  },
  validHere: { has(workCenterId: string): boolean }
): string | null {
  if (!op.processId || !isOperationStarted(op)) return null;
  return op.workCenterId && validHere.has(op.workCenterId)
    ? op.workCenterId
    : null;
}

export function applyWorkCenterSelections(
  operations: Map<string, ScheduledOperation>,
  selections: Map<string, WorkCenterSelection>,
  timeZone = "UTC"
): Map<string, ScheduledOperation> {
  const result = new Map<string, ScheduledOperation>();

  for (const [opId, op] of operations) {
    const selection = selections.get(opId);
    if (!selection) {
      result.set(opId, op);
      continue;
    }

    const updated: ScheduledOperation = { ...op };
    // Store the station the plan books the op on. The selector keeps a
    // started op on its machine, and moves it only when that machine is not
    // active at the job's location. A placeholder's fallback is only where it
    // WOULD run.
    const placed = Boolean(selection.placedStart && selection.placedEnd);
    if (
      selection.workCenterId &&
      (!hasPreassignedWorkCenter(op.workCenterId) || placed)
    ) {
      updated.workCenterId = selection.workCenterId;
    }

    // Forward-ASAP placement fills the (pre-placement null) start day and
    // projected finish instant and clears any prior conflict — the placement
    // is the authoritative timing. `dueDate` (the backward need-by target) is
    // deliberately untouched. Outside operations have a placement but no work
    // center.
    if (selection.placedStart && selection.placedEnd) {
      // A pinned outside op's window is the human's: its stored start day
      // stays as it is, empty included.
      const pinnedOutside =
        op.manuallyScheduled && op.operationType === "Outside Processing";
      updated.startDate = pinnedOutside
        ? op.startDate
        : businessDay(selection.placedStart, timeZone);
      updated.projectedCompletionAt = selection.placedEnd;
      updated.hasConflict = false;
      updated.conflictReason = null;
    }

    if (selection.conflict) {
      updated.hasConflict = true;
      updated.conflictReason = selection.conflict;
    }

    result.set(opId, updated);
  }

  return result;
}
