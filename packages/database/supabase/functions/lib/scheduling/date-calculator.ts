import {
  calculateDurationDays,
  calculateDurationHours,
} from "./duration-calculator.ts";
import type { BaseOperation, ScheduledOperation } from "./types.ts";

/**
 * Build the working ScheduledOperation map that the placement pass fills in.
 *
 * There is NO backward JIT pass anymore: everything schedules forward-ASAP, and
 * the projected finish IS the overdue forecast. So this is a plain per-operation
 * builder — durations computed, `startDate`/`dueDate` left null pre-placement
 * (forward-ASAP placement in the work-center selector assigns them). The one
 * exception is a manually-scheduled (pinned) operation, which keeps its stored
 * start/due dates so the placement pass reserves and schedules around its
 * pinned window.
 */
export function buildScheduledOperations(
  operations: BaseOperation[]
): Map<string, ScheduledOperation> {
  const scheduled = new Map<string, ScheduledOperation>();

  for (const op of operations) {
    if (!op.id) continue;

    const durationDays = calculateDurationDays(op);
    const durationHours = calculateDurationHours(op);
    const pinned = !!op.manuallyScheduled;

    scheduled.set(op.id, {
      ...op,
      id: op.id,
      startDate: pinned ? op.startDate ?? null : null,
      dueDate: pinned ? op.dueDate ?? null : null,
      priority: op.priority ?? 99,
      durationHours,
      durationDays,
      hasConflict: false,
      conflictReason: null,
    });
  }

  return scheduled;
}
