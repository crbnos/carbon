import { HOUR_MS, MINUTE_MS, SECOND_MS } from "./date-utils.ts";
import type { BaseOperation, FactorUnit } from "./types.ts";

const HOURS_PER_WORKDAY = 8;

/**
 * Convert time value to hours based on the unit type
 */
function convertToHours(
  time: number | null | undefined,
  unit: FactorUnit | null | undefined,
  quantity: number
): number {
  if (!time || !unit) return 0;

  switch (unit) {
    case "Total Hours":
      return time;
    case "Total Minutes":
      return time / 60;
    case "Hours/Piece":
      return time * quantity;
    case "Hours/100 Pieces":
      return (time / 100) * quantity;
    case "Hours/1000 Pieces":
      return (time / 1000) * quantity;
    case "Minutes/Piece":
      return (time * quantity) / 60;
    case "Minutes/100 Pieces":
      return ((time / 100) * quantity) / 60;
    case "Minutes/1000 Pieces":
      return ((time / 1000) * quantity) / 60;
    case "Pieces/Hour":
      return time > 0 ? quantity / time : 0;
    case "Pieces/Minute":
      return time > 0 ? quantity / (time * 60) : 0;
    case "Seconds/Piece":
      return (time * quantity) / 3600;
    default:
      return 0;
  }
}

/**
 * Convert time value to milliseconds based on the unit type
 */
function convertToMilliseconds(
  time: number | null | undefined,
  unit: FactorUnit | null | undefined,
  quantity: number
): number {
  if (!time || !unit) return 0;

  switch (unit) {
    case "Total Hours":
      return time * HOUR_MS;
    case "Total Minutes":
      return time * MINUTE_MS;
    case "Hours/Piece":
      return time * quantity * HOUR_MS;
    case "Hours/100 Pieces":
      return (time / 100) * quantity * HOUR_MS;
    case "Hours/1000 Pieces":
      return (time / 1000) * quantity * HOUR_MS;
    case "Minutes/Piece":
      return time * quantity * MINUTE_MS;
    case "Minutes/100 Pieces":
      return (time / 100) * quantity * MINUTE_MS;
    case "Minutes/1000 Pieces":
      return (time / 1000) * quantity * MINUTE_MS;
    case "Pieces/Hour":
      return time > 0 ? (quantity / time) * HOUR_MS : 0;
    case "Pieces/Minute":
      return time > 0 ? (quantity / time) * MINUTE_MS : 0;
    case "Seconds/Piece":
      return time * quantity * SECOND_MS;
    default:
      return 0;
  }
}

/**
 * Calculate the total duration of an operation in hours
 * Total = setup + max(labor, machine) since labor and machine can overlap
 */
export function calculateDurationHours(operation: BaseOperation): number {
  const quantity = operation.operationQuantity || 1;

  const setupHours = convertToHours(
    operation.setupTime,
    operation.setupUnit,
    quantity
  );
  const laborHours = convertToHours(
    operation.laborTime,
    operation.laborUnit,
    quantity
  );
  const machineHours = convertToHours(
    operation.machineTime,
    operation.machineUnit,
    quantity
  );

  // Total = setup + max(labor, machine) since labor and machine can overlap
  return setupHours + Math.max(laborHours, machineHours);
}

/**
 * Hours a person is hands-on at the START of the operation: setup + labor.
 * The machine runs the remaining max(0, machine - labor) unattended. When
 * labor >= machine this equals calculateDurationHours (fully attended).
 */
export function calculateAttendedHours(operation: BaseOperation): number {
  const quantity = operation.operationQuantity || 1;

  const setupHours = convertToHours(
    operation.setupTime,
    operation.setupUnit,
    quantity
  );
  const laborHours = convertToHours(
    operation.laborTime,
    operation.laborUnit,
    quantity
  );

  return setupHours + laborHours;
}

/**
 * Calculate the total duration of an operation in working days
 * Rounds up to at least 1 day
 */
export function calculateDurationDays(
  operation: BaseOperation,
  hoursPerDay: number = HOURS_PER_WORKDAY
): number {
  const hours = calculateDurationHours(operation);
  return Math.max(Math.ceil(hours / hoursPerDay), 1);
}

/**
 * Calculate the total duration of an operation in milliseconds
 * Used for load balancing calculations
 */
export function calculateDurationMs(operation: BaseOperation): number {
  const quantity = operation.operationQuantity || 1;

  const setupMs = convertToMilliseconds(
    operation.setupTime,
    operation.setupUnit,
    quantity
  );
  const laborMs = convertToMilliseconds(
    operation.laborTime,
    operation.laborUnit,
    quantity
  );
  const machineMs = convertToMilliseconds(
    operation.machineTime,
    operation.machineUnit,
    quantity
  );

  // Total = setup + max(labor, machine) since labor and machine can overlap
  return setupMs + Math.max(laborMs, machineMs);
}

/**
 * Calculate detailed duration breakdown for an operation
 */
export function calculateDurationBreakdown(operation: BaseOperation): {
  setupHours: number;
  laborHours: number;
  machineHours: number;
  totalHours: number;
  totalDays: number;
  totalMs: number;
} {
  const quantity = operation.operationQuantity || 1;

  const setupHours = convertToHours(
    operation.setupTime,
    operation.setupUnit,
    quantity
  );
  const laborHours = convertToHours(
    operation.laborTime,
    operation.laborUnit,
    quantity
  );
  const machineHours = convertToHours(
    operation.machineTime,
    operation.machineUnit,
    quantity
  );

  const totalHours = setupHours + Math.max(laborHours, machineHours);
  const totalDays = Math.max(Math.ceil(totalHours / HOURS_PER_WORKDAY), 1);
  const totalMs = totalHours * HOUR_MS;

  return {
    setupHours,
    laborHours,
    machineHours,
    totalHours,
    totalDays,
    totalMs
  };
}

/**
 * Remaining-work fractions for a (possibly started) operation, so the schedule
 * reserves only the work left to do — not the full standard content — anchored
 * at now.
 *
 * - `work` scales labor and machine time by the quantity still to run:
 *   clamp(1 − quantityComplete / max(operationQuantity, 1), 0, 1).
 * - `setup` is 1 until any production event exists on the operation, then 0
 *   (setup is a one-time cost — once the machine is set up it stays set up).
 *
 * Quantity-proportional only (per spec): remaining time is derived from
 * quantity, never from productionEvent durations.
 */
export function remainingFractions(
  op: {
    operationQuantity?: number | null;
    quantityComplete?: number | null;
  },
  hasProductionEvent: boolean
): { setup: number; work: number } {
  const complete = op.quantityComplete ?? 0;
  const total = Math.max(op.operationQuantity ?? 1, 1);
  const work = Math.min(Math.max(1 - complete / total, 0), 1);
  const setup = hasProductionEvent ? 0 : 1;
  return { setup, work };
}

export { convertToHours, convertToMilliseconds, HOURS_PER_WORKDAY };
