import type {
  DeadlineType,
  DispatchRule,
  OperationWithJobInfo,
  ScheduledOperation,
} from "./types.ts";
import { HOUR_MS } from "./date-utils.ts";

/**
 * Deadline type priority order (lower number = higher priority)
 */
const DEADLINE_PRIORITY: Record<string, number> = {
  "ASAP": 0,
  "Hard Deadline": 1,
  "Soft Deadline": 2,
  "No Deadline": 3,
};

/**
 * Get deadline priority value (for sorting)
 */
function getDeadlinePriority(deadlineType: DeadlineType | string | null | undefined): number {
  return DEADLINE_PRIORITY[deadlineType || "No Deadline"] ?? 3;
}

/**
 * Sort operations by priority criteria:
 * 1. Start Date (earliest first) - Primary
 * 2. Job Priority (lower number = higher priority) - Secondary
 * 3. Deadline Type (ASAP > Hard > Soft > No Deadline) - Tie-breaker
 */
export function sortOperationsByPriority<T extends OperationWithJobInfo>(
  operations: T[],
  rule: DispatchRule = "EDD"
): T[] {
  return [...operations].sort((a, b) => {
    const ruleCompare = compareByDispatchRule(a, b, rule);
    if (ruleCompare !== 0) return ruleCompare;

    // Legacy tie-break chain (was the whole comparator before dispatch rules):
    // 1. Start date (earliest first, nulls last)
    if (a.startDate && b.startDate) {
      const dateCompare =
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
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

/** Compare two nullable keys ascending, nulls last; 0 when tied/unknown. */
function compareNullable(a: number | null, b: number | null): number {
  if (a !== null && b !== null) return a - b;
  if (a !== null) return -1;
  if (b !== null) return 1;
  return 0;
}

/**
 * Primary sort key per dispatch rule. Ties (and missing data) fall through to
 * the legacy chain in sortOperationsByPriority.
 *
 * - FIFO: createdAt ascending
 * - EDD: operation dueDate ascending (the default; for backward-scheduled
 *   jobs this closely mirrors the legacy startDate-first ordering)
 * - SPT: shortest duration first
 * - WSPT: jobPriority × duration ascending (lower job priority number =
 *   more important, so important+short work leads)
 * - CR: (dueDate − now) / duration ascending
 * - MinSlack: (dueDate − now) − duration ascending
 */
function compareByDispatchRule(
  a: OperationWithJobInfo,
  b: OperationWithJobInfo,
  rule: DispatchRule
): number {
  const now = Date.now();
  const due = (op: OperationWithJobInfo) =>
    op.dueDate ? new Date(op.dueDate).getTime() : null;
  const duration = (op: OperationWithJobInfo) =>
    op.durationHours !== null && op.durationHours !== undefined
      ? Math.max(op.durationHours, 0.01)
      : null;

  switch (rule) {
    case "FIFO": {
      const aKey = a.createdAt ? new Date(a.createdAt).getTime() : null;
      const bKey = b.createdAt ? new Date(b.createdAt).getTime() : null;
      return compareNullable(aKey, bKey);
    }
    case "EDD":
      return compareNullable(due(a), due(b));
    case "SPT":
      return compareNullable(duration(a), duration(b));
    case "WSPT": {
      const aDur = duration(a);
      const bDur = duration(b);
      const aKey = aDur === null ? null : (a.jobPriority ?? 99) * aDur;
      const bKey = bDur === null ? null : (b.jobPriority ?? 99) * bDur;
      return compareNullable(aKey, bKey);
    }
    case "CR": {
      const aDue = due(a);
      const bDue = due(b);
      const aDur = duration(a);
      const bDur = duration(b);
      const aKey =
        aDue === null || aDur === null ? null : (aDue - now) / (aDur * HOUR_MS);
      const bKey =
        bDue === null || bDur === null ? null : (bDue - now) / (bDur * HOUR_MS);
      return compareNullable(aKey, bKey);
    }
    case "MinSlack": {
      const aDue = due(a);
      const bDue = due(b);
      const aDur = duration(a);
      const bDur = duration(b);
      const aKey =
        aDue === null || aDur === null ? null : aDue - now - aDur * HOUR_MS;
      const bKey =
        bDue === null || bDur === null ? null : bDue - now - bDur * HOUR_MS;
      return compareNullable(aKey, bKey);
    }
  }
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
export function groupOperationsByWorkCenter<T extends { workCenterId: string | null }>(
  operations: T[]
): Map<string | null, T[]> {
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
  operations: OperationWithJobInfo[],
  resolveRule?: (workCenterId: string | null) => DispatchRule
): Map<string, number> {
  const allPriorities = new Map<string, number>();

  // Group by work center
  const byWorkCenter = groupOperationsByWorkCenter(operations);

  // Calculate priorities for each work center independently
  for (const [wcId, wcOperations] of byWorkCenter) {
    // Sort operations for this work center using its dispatch rule
    const rule = resolveRule ? resolveRule(wcId) : "EDD";
    const sorted = sortOperationsByPriority(wcOperations, rule);

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
    createdAt: operation.createdAt
      ? new Date(operation.createdAt).toISOString()
      : null,
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
      priority,
    });
  }

  return result;
}

export { DEADLINE_PRIORITY, getDeadlinePriority };
