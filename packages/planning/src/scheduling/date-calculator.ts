import { toIsoDate } from "./date-utils.ts";
import {
  calculateDurationDays,
  calculateDurationHours
} from "./duration-calculator.ts";
import type { BaseOperation, ScheduledOperation } from "./types.ts";

/**
 * Build the working ScheduledOperation map that the placement pass fills in.
 *
 * There is NO backward JIT pass in placement: everything schedules
 * forward-ASAP, and the projected finish IS the overdue forecast. So this is a
 * plain per-operation builder — durations computed, `startDate` and
 * `projectedCompletionAt` left null pre-placement (forward-ASAP placement in
 * the work-center selector fills them for EVERY op, pinned included — a pin
 * owns the TARGET, not the placement; spec 2026-08-15 dual dates).
 *
 * `dueDate` is the backward need-by target: it starts null and is only seeded
 * from storage for a manually-scheduled (pinned) operation, whose stored value
 * the need-by pass takes as-is and propagates upstream. The one placement
 * exception is a pinned OUTSIDE-PROCESSING op, which skips placement entirely
 * and keeps its stored window, so its stored startDate is preserved too.
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
    const pinnedOutside = pinned && op.operationType === "Outside Processing";

    scheduled.set(op.id, {
      ...op,
      id: op.id,
      // toIsoDate: pg DATE columns arrive as JS Date objects — every consumer
      // (need-by pin passthrough, diff-write compare) expects "YYYY-MM-DD".
      startDate: pinnedOutside ? toIsoDate(op.startDate) : null,
      dueDate: pinned ? toIsoDate(op.dueDate) : null,
      projectedCompletionAt: null,
      priority: op.priority ?? 99,
      durationHours,
      durationDays,
      hasConflict: false,
      conflictReason: null
    });
  }

  return scheduled;
}
