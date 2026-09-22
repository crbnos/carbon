import { parseDate } from "@internationalized/date";
import { toInstantIso, toIsoDate } from "./date-utils.ts";
import type {
  DeadlineType,
  OperationWithJobInfo,
  ScheduledOperation
} from "./types.ts";

/**
 * Deadline type priority order (lower number = higher priority)
 */
const DEADLINE_PRIORITY: Record<string, number> = {
  ASAP: 0,
  "Hard Deadline": 1,
  "Soft Deadline": 2,
  "No Deadline": 3
};

/**
 * Get deadline priority value (for sorting)
 */
function getDeadlinePriority(
  deadlineType: DeadlineType | string | null | undefined
): number {
  return DEADLINE_PRIORITY[deadlineType || "No Deadline"] ?? 3;
}

/**
 * Sort operations into their per-work-center dispatch sequence. The dispatch
 * order IS the forward-ASAP placement order — one source of truth for what runs
 * next — so the placed start date is the primary key:
 * 1. Placed start date (earliest first, nulls last) — Primary
 * 2. Job Priority (lower number = higher priority) - Secondary
 * 3. Deadline Type (ASAP > Hard > Soft > No Deadline) - Tie-breaker
 */
export function sortOperationsByPriority<T extends OperationWithJobInfo>(
  operations: T[]
): T[] {
  return [...operations].sort((a, b) => {
    // 1. Start date (earliest first, nulls last). Date-only "YYYY-MM-DD"
    // comparison via calendar dates (toIsoDate normalizes a pg DATE object or
    // string first); only the sign matters to the sort.
    if (a.startDate && b.startDate) {
      const dateCompare = parseDate(toIsoDate(a.startDate)!).compare(
        parseDate(toIsoDate(b.startDate)!)
      );
      if (dateCompare !== 0) return dateCompare;
    } else if (a.startDate) {
      return -1;
    } else if (b.startDate) {
      return 1;
    }

    // 2. Job priority (lower = higher priority)
    const aPriority = a.jobPriority ?? 0;
    const bPriority = b.jobPriority ?? 0;
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    // 3. Deadline type (ASAP > Hard > Soft > No Deadline)
    const aDeadline = getDeadlinePriority(a.deadlineType);
    const bDeadline = getDeadlinePriority(b.deadlineType);
    return aDeadline - bDeadline;
  });
}

/**
 * Assign sequential integer priorities to sorted operations
 * Uses simple sequential numbering (1, 2, 3, ...)
 */
export function assignSequentialPriorities<T extends { id: string }>(
  sortedOperations: T[]
): Map<string, number> {
  const priorities = new Map<string, number>();

  sortedOperations.forEach((op, index) => {
    priorities.set(op.id, index + 1);
  });

  return priorities;
}

/**
 * Calculate fractional priority for inserting between two existing priorities
 * Used when inserting a new operation between existing ones
 */
export function calculateFractionalPriority(
  priorityBefore: number | null,
  priorityAfter: number | null
): number {
  const before = priorityBefore ?? 0;
  const after = priorityAfter ?? before + 2;

  return (before + after) / 2;
}

/**
 * Group operations by work center
 */
export function groupOperationsByWorkCenter<
  T extends { workCenterId: string | null }
>(operations: T[]): Map<string | null, T[]> {
  const groups = new Map<string | null, T[]>();

  for (const op of operations) {
    const wcId = op.workCenterId;
    if (!groups.has(wcId)) {
      groups.set(wcId, []);
    }
    groups.get(wcId)!.push(op);
  }

  return groups;
}

/**
 * Calculate priorities for all operations grouped by work center
 * Returns a map of operation ID to priority number
 */
export function calculatePrioritiesByWorkCenter(
  operations: OperationWithJobInfo[]
): Map<string, number> {
  const allPriorities = new Map<string, number>();

  // Group by work center
  const byWorkCenter = groupOperationsByWorkCenter(operations);

  // Calculate priorities for each work center independently
  for (const [, wcOperations] of byWorkCenter) {
    // Sort into placement order (start date ascending), then number 1, 2, 3…
    const sorted = sortOperationsByPriority(wcOperations);

    // Assign sequential priorities
    const priorities = assignSequentialPriorities(sorted);

    // Merge into all priorities
    for (const [opId, priority] of priorities) {
      allPriorities.set(opId, priority);
    }
  }

  return allPriorities;
}

/**
 * Convert scheduled operations to OperationWithJobInfo format
 * for priority calculation
 */
export function toOperationWithJobInfo(
  operation: ScheduledOperation,
  jobPriority: number | null,
  jobDeadlineType: DeadlineType | null
): OperationWithJobInfo {
  return {
    id: operation.id,
    dueDate: operation.dueDate,
    startDate: operation.startDate,
    priority: operation.priority,
    deadlineType: operation.deadlineType ?? jobDeadlineType,
    jobPriority,
    workCenterId: operation.workCenterId ?? null,
    durationHours: operation.durationHours ?? null,
    createdAt: operation.createdAt ? toInstantIso(operation.createdAt) : null
  };
}

/**
 * Apply calculated priorities to scheduled operations
 */
export function applyPriorities(
  operations: Map<string, ScheduledOperation>,
  priorities: Map<string, number>
): Map<string, ScheduledOperation> {
  const result = new Map<string, ScheduledOperation>();

  for (const [opId, op] of operations) {
    const priority = priorities.get(opId) ?? op.priority;
    result.set(opId, {
      ...op,
      priority
    });
  }

  return result;
}

export { DEADLINE_PRIORITY, getDeadlinePriority };
