// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type OperationDetail,
  type OperationMaterial,
  type OperationStep,
  operationMaterial,
  operationProcedure,
  type ProductionEvent
} from "@carbon/mes-core";
import { z } from "zod";

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

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/**
 * The material lines worth showing on the Materials tab.
 *
 * `materials` rides in on a passthrough field, so it is `unknown` and has to be
 * validated here. The result distinguishes "no materials" from "the payload was
 * not what this build can read": the first is a fact about the job, the second
 * is a bug, and showing an empty list for both is exactly the silent-empty
 * failure that is worst on a shop floor.
 *
 * A row with no item is dropped — nothing to name it, nothing to issue. A kit
 * PARENT is dropped too: it is a container whose children are the real lines,
 * so showing it would double every quantity on screen.
 */
export function parseMaterials(materials: unknown): {
  materials: OperationMaterial[];
  malformed: boolean;
} {
  if (materials === null || materials === undefined) {
    return { materials: [], malformed: false };
  }
  const parsed = z.array(operationMaterial).safeParse(materials);
  if (!parsed.success) return { materials: [], malformed: true };
  return { materials: issuableMaterials(parsed.data), malformed: false };
}

export function issuableMaterials(
  materials: OperationMaterial[]
): OperationMaterial[] {
  return materials.filter(
    (material) => Boolean(material?.itemId) && material?.kit !== true
  );
}

/**
 * The material a scanned code refers to, or null.
 *
 * Matching is EXACT and case-insensitive on the readable id, with the
 * revisionless form accepted too — a label printed before a revision bump
 * still names the same shelf part. It is deliberately not a prefix or
 * substring match: "ABC-1" would then match "ABC-10", and issuing the wrong
 * material writes a ledger row against the wrong part.
 */
export function matchMaterialToScan(
  materials: OperationMaterial[],
  code: string
): OperationMaterial | null {
  const needle = code.trim().toLowerCase();
  if (!needle) return null;

  return (
    materials.find((material) => {
      const readable = material.itemReadableId?.trim().toLowerCase();
      const withoutRevision = (
        material as { itemReadableIdWithoutRevision?: string | null }
      ).itemReadableIdWithoutRevision
        ?.trim()
        .toLowerCase();
      return (
        (readable !== undefined && readable === needle) ||
        (withoutRevision !== undefined && withoutRevision === needle) ||
        material.itemId?.toLowerCase() === needle
      );
    }) ?? null
  );
}

/** What is left to issue on a line, floored at zero. */
export function remainingToIssue(material: OperationMaterial) {
  const required = material.estimatedQuantity ?? 0;
  const issued = material.quantityIssued ?? 0;
  return required > issued ? required - issued : 0;
}

/** True when the job BUILDS this line rather than consuming it from stock. */
export function isBuiltLine(material: OperationMaterial) {
  return material.methodType === "Make to Order";
}

/** Serial or batch tracked, so issuing it needs a specific entity. */
export function isTrackedLine(material: OperationMaterial) {
  return (
    material.requiresSerialTracking === true ||
    material.requiresBatchTracking === true
  );
}

// ---------------------------------------------------------------------------
// Work instructions
// ---------------------------------------------------------------------------

/**
 * The operation's steps, in the order they are to be worked.
 *
 * `procedure` rides in on a passthrough field, so it is validated here, and
 * the result distinguishes "no instructions" from "a payload this build cannot
 * read" for the same reason the materials do: an empty list for both is the
 * silent-empty failure, and these are the instructions for the part in the
 * operator's hands.
 *
 * Sorting is explicit. The server reads `jobOperationStep` with no ORDER BY,
 * so the array arrives in whatever order Postgres returned it — and work
 * instructions shown out of order are worse than none at all. `id` breaks a
 * tie so the order is at least stable between two reads.
 */
export function parseSteps(procedure: unknown): {
  steps: OperationStep[];
  malformed: boolean;
} {
  if (procedure === null || procedure === undefined) {
    return { steps: [], malformed: false };
  }
  const parsed = operationProcedure.safeParse(procedure);
  if (!parsed.success) return { steps: [], malformed: true };

  const steps = [...parsed.data.attributes].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
  );
  return { steps, malformed: false };
}

/** The record for one unit of a step, if the operator has made one. */
export function recordForUnit(step: OperationStep, unitIndex: number) {
  return (step.jobOperationStepRecord ?? []).find(
    (record) => record.index === unitIndex
  );
}

/**
 * Whether this unit's step counts as recorded.
 *
 * A record ROW is not enough: unchecking a checkbox leaves a row with
 * `booleanValue: false`, and an empty text value is a row with nothing in it.
 * Treating either as done would tick a step the operator has not performed.
 */
export function stepIsRecorded(step: OperationStep, unitIndex: number) {
  const record = recordForUnit(step, unitIndex);
  if (!record) return false;
  if (record.booleanValue === true) return true;
  if (typeof record.numericValue === "number") return true;
  if (typeof record.value === "string" && record.value.trim().length > 0) {
    return true;
  }
  if (typeof record.userValue === "string" && record.userValue.length > 0) {
    return true;
  }
  return false;
}

/** The steps an operator must record before the operation can be finished. */
export function unrecordedRequiredSteps(
  steps: OperationStep[],
  unitIndex: number
) {
  return steps.filter(
    (step) => step.required === true && !stepIsRecorded(step, unitIndex)
  );
}
