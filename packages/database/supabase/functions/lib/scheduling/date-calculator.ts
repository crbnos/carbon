import {
  calculateDurationDays,
  calculateDurationHours,
} from "./duration-calculator.ts";
import type {
  BaseOperation,
  DependencyGraph,
  ScheduledOperation,
  SchedulingDirection,
} from "./types.ts";

/**
 * Subtract business days from a date (skips weekends)
 */
function subtractBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let remainingDays = days;

  while (remainingDays > 0) {
    result.setDate(result.getDate() - 1);
    // Skip weekends (0 = Sunday, 6 = Saturday)
    const dayOfWeek = result.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      remainingDays--;
    }
  }

  return result;
}

/**
 * Add business days to a date (skips weekends)
 */
function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let remainingDays = days;

  while (remainingDays > 0) {
    result.setDate(result.getDate() + 1);
    // Skip weekends (0 = Sunday, 6 = Saturday)
    const dayOfWeek = result.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      remainingDays--;
    }
  }

  return result;
}

/**
 * Format date to ISO date string (YYYY-MM-DD)
 */
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Get today's date as ISO string
 */
function getTodayString(): string {
  return formatDate(new Date());
}

/**
 * Interface for scheduling strategy
 */
export interface SchedulingStrategy {
  calculateDates(
    operations: BaseOperation[],
    operationMap: Map<string, BaseOperation>,
    graph: DependencyGraph,
    anchorDate: string | null
  ): Map<string, ScheduledOperation>;
}

/**
 * Backward scheduling strategy - schedules from due date backward
 */
export class BackwardSchedulingStrategy implements SchedulingStrategy {
  calculateDates(
    _operations: BaseOperation[],
    operationMap: Map<string, BaseOperation>,
    graph: DependencyGraph,
    jobDueDate: string | null
  ): Map<string, ScheduledOperation> {
    const scheduled = new Map<string, ScheduledOperation>();
    const today = getTodayString();
    const finalDueDate = jobDueDate || today;

    // Topological sort in reverse order (leaf nodes first)
    const sortedIds = graph.topologicalSort("reverse");

    for (const opId of sortedIds) {
      const op = operationMap.get(opId);
      if (!op || !op.id) continue;

      const durationDays = calculateDurationDays(op);
      const durationHours = calculateDurationHours(op);

      // If manually scheduled, preserve the existing dueDate and derive startDate
      if (op.manuallyScheduled && op.dueDate) {
        const dueDateObj = new Date(op.dueDate);
        const startDateObj = subtractBusinessDays(dueDateObj, durationDays);
        const startDate = formatDate(startDateObj);

        const hasConflict = startDate < today;
        const conflictReason = hasConflict
          ? `Operation must start on ${startDate} but current date is ${today}`
          : null;

        const scheduledOp: ScheduledOperation = {
          ...op,
          id: op.id,
          startDate,
          dueDate: op.dueDate,
          priority: op.priority ?? 99,
          durationHours,
          durationDays,
          hasConflict,
          conflictReason,
        };
        scheduled.set(opId, scheduledOp);
        continue;
      }

      // Calculate due date
      let dueDate: string;
      const dependents = graph.getDependents(opId);

      if (dependents.length === 0) {
        // Leaf operation: use job due date
        dueDate = finalDueDate;
      } else {
        // Has dependents: must finish before earliest dependent starts minus lead time
        const dependentConstraints = dependents
          .map((depId) => {
            const scheduledOp = scheduled.get(depId);
            const baseOp = operationMap.get(depId);
            if (!scheduledOp?.startDate) return null;

            // Subtract lead time from dependent's start date
            // Lead time represents how early the subassembly needs to be ready
            // before the parent operation starts
            const leadTimeDays = baseOp?.operationLeadTime ?? 0;
            if (leadTimeDays > 0) {
              const startDate = new Date(scheduledOp.startDate);
              return subtractBusinessDays(startDate, leadTimeDays);
            }
            return new Date(scheduledOp.startDate);
          })
          .filter((date): date is Date => date !== null);

        if (dependentConstraints.length === 0) {
          dueDate = finalDueDate;
        } else {
          // Use the earliest constraint date (start date minus lead time)
          const minDate = new Date(
            Math.min(...dependentConstraints.map((d) => d.getTime()))
          );
          dueDate = formatDate(minDate);
        }
      }

      // Handle "With Previous" operations - same dates as predecessor
      if (op.operationOrder === "With Previous") {
        const dependencies = graph.getDependencies(opId);
        if (dependencies.length > 0) {
          const predecessorId = dependencies[0];
          const predecessor = scheduled.get(predecessorId);
          if (predecessor) {
            const scheduledOp: ScheduledOperation = {
              ...op,
              id: op.id,
              startDate: predecessor.startDate,
              dueDate: predecessor.dueDate,
              priority: op.priority ?? 99,
              durationHours,
              durationDays,
              hasConflict: predecessor.hasConflict,
              conflictReason: predecessor.conflictReason,
            };
            scheduled.set(opId, scheduledOp);
            continue;
          }
        }
      }

      // Calculate start date by subtracting duration from due date
      const dueDateObj = new Date(dueDate);
      const startDateObj = subtractBusinessDays(dueDateObj, durationDays);
      const startDate = formatDate(startDateObj);

      // Check for conflicts (start date in the past)
      const hasConflict = startDate < today;
      const conflictReason = hasConflict
        ? `Operation must start on ${startDate} but current date is ${today}`
        : null;

      const scheduledOp: ScheduledOperation = {
        ...op,
        id: op.id,
        startDate,
        dueDate,
        priority: op.priority ?? 99,
        durationHours,
        durationDays,
        hasConflict,
        conflictReason,
      };

      scheduled.set(opId, scheduledOp);
    }

    return scheduled;
  }
}

/**
 * Forward scheduling strategy - schedules from start date forward
 * (Placeholder for future implementation)
 */
export class ForwardSchedulingStrategy implements SchedulingStrategy {
  calculateDates(
    _operations: BaseOperation[],
    operationMap: Map<string, BaseOperation>,
    graph: DependencyGraph,
    jobStartDate: string | null
  ): Map<string, ScheduledOperation> {
    const scheduled = new Map<string, ScheduledOperation>();
    const today = getTodayString();
    const startDate = jobStartDate || today;

    // Topological sort in forward order (root nodes first)
    const sortedIds = graph.topologicalSort("forward");

    for (const opId of sortedIds) {
      const op = operationMap.get(opId);
      if (!op || !op.id) continue;

      const durationDays = calculateDurationDays(op);
      const durationHours = calculateDurationHours(op);

      // If manually scheduled, preserve the existing dueDate and derive startDate
      if (op.manuallyScheduled && op.dueDate) {
        const dueDateObj = new Date(op.dueDate);
        const startDateObj = subtractBusinessDays(dueDateObj, durationDays);
        const opStartDate = formatDate(startDateObj);

        const scheduledOp: ScheduledOperation = {
          ...op,
          id: op.id,
          startDate: opStartDate,
          dueDate: op.dueDate,
          priority: op.priority ?? 1,
          durationHours,
          durationDays,
          hasConflict: false,
          conflictReason: null,
        };
        scheduled.set(opId, scheduledOp);
        continue;
      }

      // Calculate start date
      let opStartDate: string;
      const dependencies = graph.getDependencies(opId);

      if (dependencies.length === 0) {
        // Root operation: use job start date
        opStartDate = startDate;
      } else {
        // Has dependencies: must start after latest dependency ends plus lead time
        const dependencyDueDates = dependencies
          .map((depId) => scheduled.get(depId)?.dueDate)
          .filter(
            (date): date is string => date !== null && date !== undefined
          );

        if (dependencyDueDates.length === 0) {
          opStartDate = startDate;
        } else {
          // Use the latest dependency due date
          const maxDate = new Date(
            Math.max(...dependencyDueDates.map((d) => new Date(d).getTime()))
          );
          // Add lead time of current operation (time needed after dependencies complete)
          const leadTimeDays = op.operationLeadTime ?? 0;
          if (leadTimeDays > 0) {
            opStartDate = formatDate(addBusinessDays(maxDate, leadTimeDays));
          } else {
            opStartDate = formatDate(maxDate);
          }
        }
      }

      // Handle "With Previous" operations - same dates as predecessor
      if (op.operationOrder === "With Previous" && dependencies.length > 0) {
        const predecessorId = dependencies[0];
        const predecessor = scheduled.get(predecessorId);
        if (predecessor) {
          const scheduledOp: ScheduledOperation = {
            ...op,
            id: op.id,
            startDate: predecessor.startDate,
            dueDate: predecessor.dueDate,
            priority: op.priority ?? 99,
            durationHours,
            durationDays,
            hasConflict: false,
            conflictReason: null,
          };
          scheduled.set(opId, scheduledOp);
          continue;
        }
      }

      // Calculate due date by adding duration to start date
      const startDateObj = new Date(opStartDate);
      const dueDateObj = addBusinessDays(startDateObj, durationDays);
      const dueDate = formatDate(dueDateObj);

      const scheduledOp: ScheduledOperation = {
        ...op,
        id: op.id,
        startDate: opStartDate,
        dueDate,
        priority: op.priority ?? 1,
        durationHours,
        durationDays,
        hasConflict: false,
        conflictReason: null,
      };

      scheduled.set(opId, scheduledOp);
    }

    return scheduled;
  }
}

/**
 * Factory function to get the appropriate scheduling strategy
 */
export function getSchedulingStrategy(
  direction: SchedulingDirection
): SchedulingStrategy {
  switch (direction) {
    case "forward":
      return new ForwardSchedulingStrategy();
    case "backward":
    default:
      return new BackwardSchedulingStrategy();
  }
}

/**
 * Main date calculation function
 */
export function calculateOperationDates(
  operations: BaseOperation[],
  graph: DependencyGraph,
  anchorDate: string | null,
  direction: SchedulingDirection = "backward"
): Map<string, ScheduledOperation> {
  // Build operation map for quick lookup
  const operationMap = new Map<string, BaseOperation>();
  for (const op of operations) {
    if (op.id) {
      operationMap.set(op.id, op);
    }
  }

  const strategy = getSchedulingStrategy(direction);
  return strategy.calculateDates(operations, operationMap, graph, anchorDate);
}

export { addBusinessDays, formatDate, getTodayString, subtractBusinessDays };
