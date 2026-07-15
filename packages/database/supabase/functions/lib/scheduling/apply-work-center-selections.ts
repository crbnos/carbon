import { toIsoDateInTimeZone } from "./date-utils.ts";
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
    if (selection.workCenterId) {
      updated.workCenterId = selection.workCenterId;
    }

    // Finite placement overrides the infinite-capacity dates — and with
    // them the pass-1 date conflict, which was computed against the
    // backward-scheduled dates this placement just replaced. Outside
    // operations have a placement but no work center.
    if (selection.placedStart && selection.placedEnd) {
      updated.startDate = toIsoDateInTimeZone(
        new Date(selection.placedStart),
        timeZone
      );
      updated.dueDate = toIsoDateInTimeZone(
        new Date(selection.placedEnd),
        timeZone
      );
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
