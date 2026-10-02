// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationDetail, ProductionEvent } from "@carbon/mes-core";

/**
 * Every decision this screen makes that does not need React Native.
 *
 * Kept separate from the components for one practical reason: a test that
 * imports a `.tsx` file pulls in `react-native`, whose source is Flow-typed
 * and which vitest cannot parse — so logic living inside a component is logic
 * that cannot be tested. The codebase's answer to that is the pure core
 * (`reconcile.ts`, `mrp-companies.ts`, the precision helpers), and these are
 * the ones worth pinning: each is silent when wrong, and what it reports
 * becomes an operator's hours or a job's cost.
 */

export type WorkType = "Setup" | "Labor" | "Machine";

export const WORK_TYPES: readonly WorkType[] = ["Setup", "Labor", "Machine"];

export type EventIds = {
  setupProductionEventId?: string;
  laborProductionEventId?: string;
  machineProductionEventId?: string;
};

export type OpenEvents = Partial<Record<WorkType, ProductionEvent | undefined>>;

/**
 * Which kinds of time this operation can open.
 *
 * A type is offered only when the operation PLANS time for it, exactly as
 * `Controls.tsx` `WorkTypeToggle` decides it — so Start cannot open a machine
 * event on a job that has no machine step.
 */
export function availableWorkTypes(
  operation: OperationDetail["operation"]
): WorkType[] {
  const types: WorkType[] = [];
  if ((operation.setupDuration ?? 0) > 0) types.push("Setup");
  if ((operation.laborDuration ?? 0) > 0) types.push("Labor");
  if ((operation.machineDuration ?? 0) > 0) types.push("Machine");
  // An operation that plans no time at all still has to be startable: the web
  // falls through to Labor, and a dock with nothing to press would strand the
  // operator at the machine.
  return types.length ? types : ["Labor"];
}

/** The one still-open event of each type (`endTime` null or absent). */
export function openEvents(events: ProductionEvent[]): OpenEvents {
  const open = events.filter((event) => !event.endTime);
  return {
    Setup: open.find((event) => event.type === "Setup"),
    Labor: open.find((event) => event.type === "Labor"),
    Machine: open.find((event) => event.type === "Machine")
  };
}

/**
 * Milliseconds already banked per type by events that have ENDED.
 *
 * The server's stored `duration` is used rather than recomputing it from the
 * two timestamps: recomputing would disagree with the hours the operator is
 * paid for whenever the server adjusted one. Open events contribute nothing —
 * their time belongs to the live timer, and counting both would double it.
 */
export function closedDurations(events: ProductionEvent[]) {
  const totals: Record<WorkType, number> = { Setup: 0, Labor: 0, Machine: 0 };
  for (const event of events) {
    if (!event.endTime) continue;
    totals[event.type] += event.duration ?? 0;
  }
  return totals;
}

/** The open event ids a quantity, scrap, rework or finish report carries. */
export function eventIdsFrom(open: OpenEvents): EventIds {
  return {
    setupProductionEventId: open.Setup?.id,
    laborProductionEventId: open.Labor?.id,
    machineProductionEventId: open.Machine?.id
  };
}

/** What is left to make, floored at zero — never a negative "remaining". */
export function remainingQuantity(operation: OperationDetail["operation"]) {
  const target = operation.operationQuantity ?? 0;
  const done = operation.quantityComplete ?? 0;
  return target > done ? target - done : 0;
}

/**
 * The typed quantity as a number, or null when it is not a usable one.
 *
 * Deliberately not `Number(text)`: that reads "0x10" as 16, "1e3" as 1000 and
 * " " as 0, none of which an operator meant to type into a quantity field.
 */
export function parseQuantity(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}
