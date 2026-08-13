import { businessDay } from "./date-utils.ts";
import type { ScheduledOperation, WorkCenterSelection } from "./types.ts";

/**
 * Apply work center selections to scheduled operations.
 *
 * Pure module (no provider/database imports) so it stays type-checkable
 * under `deno test lib/scheduling/` alongside the other pure units.
 *
 * `timeZone` is the job location's IANA zone: placed timestamps are recorded
 * onto the date-only operation columns as the FACTORY's calendar day (an op
 * ending 03:04 local on the 21st must not be stored as due the 20th).
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
    // Never clobber a pre-assigned work center (user or method default) —
    // auto-selection may only fill empty ones.
    if (selection.workCenterId && !hasPreassignedWorkCenter(op.workCenterId)) {
      updated.workCenterId = selection.workCenterId;
    }

    // Forward-ASAP placement fills the (pre-placement null) dates and clears
    // any prior conflict — the placement is the authoritative timing. Outside
    // operations have a placement but no work center.
    if (selection.placedStart && selection.placedEnd) {
      updated.startDate = businessDay(selection.placedStart, timeZone);
      updated.dueDate = businessDay(selection.placedEnd, timeZone);
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
