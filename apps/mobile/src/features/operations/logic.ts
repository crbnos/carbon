// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type AssemblyTrackedInput,
  assemblyTrackedInput,
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
export function remainingQuantity(operation: {
  operationQuantity?: number | null;
  quantityComplete?: number | null;
}) {
  const target = operation.operationQuantity ?? 0;
  const done = operation.quantityComplete ?? 0;
  return target > done ? target - done : 0;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export type TrackingType = "Serial" | "Batch";

/**
 * What a reporting sheet needs to know about the work, and nothing else.
 *
 * The operation screen and the assembly screen read different payloads, and
 * the sheets used to take the operation screen's whole one while reading four
 * fields of it. Naming those fields lets both screens open the SAME quantity,
 * scrap, rework, finish and quality sheets, so a report means one thing
 * wherever it was made.
 */
export type ReportTarget = {
  operationId: string;
  operationQuantity?: number | null;
  quantityComplete?: number | null;
  /** The unit being reported on. Only ever set for a tracked parent. */
  trackedEntityId?: string;
  /** What an operator reads off that unit's label. */
  trackedEntityReadableId?: string | null;
  /**
   * The PARENT's tracking. It selects the server's completion branch: Serial
   * completes this unit, mints the next one and prints its label; Batch
   * completes against the lot. Left out, a tracked parent's report takes the
   * untracked branch and none of that happens — silently.
   */
  trackingType?: TrackingType;
};

/** A make method's tracking, as the one value the reports carry. */
export function parentTrackingType(
  method:
    | {
        requiresSerialTracking?: boolean | null;
        requiresBatchTracking?: boolean | null;
      }
    | null
    | undefined
): TrackingType | undefined {
  if (method?.requiresSerialTracking) return "Serial";
  if (method?.requiresBatchTracking) return "Batch";
  return undefined;
}

/**
 * The reporting target for the plain operation screen.
 *
 * The unit is sent only for a tracked parent, exactly as web's `QuantityModal`
 * does it: an untracked job can still carry a stray inventory entity, and that
 * entity is not the thing being built.
 */
export function reportTargetFor(detail: OperationDetail): ReportTarget {
  const trackingType = parentTrackingType(detail.jobMakeMethod);
  return {
    operationId: detail.operation.id,
    operationQuantity: detail.operation.operationQuantity,
    quantityComplete: detail.operation.quantityComplete,
    trackedEntityId: trackingType
      ? (detail.trackedEntityId ?? undefined)
      : undefined,
    trackingType
  };
}

/** The two fields every quantity, scrap and rework report carries. */
export function trackingFields(target: ReportTarget) {
  return {
    trackedEntityId: target.trackedEntityId,
    trackingType: target.trackingType
  };
}

/**
 * Why a report cannot be made yet, or null.
 *
 * A serial parent is reported one named unit at a time, so with no unit
 * chosen there is nothing to complete or scrap. The server would refuse it;
 * saying so on the button is kinder than a toast after the tap.
 */
export function needsUnit(target: ReportTarget) {
  return target.trackingType === "Serial" && !target.trackedEntityId;
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
 * A lot or serial already consumed into the unit — what Remove is offered.
 * The same row the assembly screen reads; one function builds both.
 */
export type ConsumedInput = AssemblyTrackedInput;

/**
 * What the server sends as `materials`: the lines, and the tracked inputs
 * already consumed. A bare array is accepted as well — it is what the read
 * returned before it grew `trackedInputs`, and a self-hosted server can be
 * months behind the app.
 */
const materialsPayload = z.union([
  z.array(operationMaterial),
  z
    .object({
      materials: z.array(operationMaterial),
      trackedInputs: z.array(assemblyTrackedInput).nullable().optional()
    })
    .passthrough()
]);

/**
 * The material lines worth showing on the Materials tab.
 *
 * `materials` rides in on a passthrough field, so it is `unknown` and has to be
 * validated here. The result distinguishes "no materials" from "the payload was
 * not what this build can read": the first is a fact about the job, the second
 * is a bug, and showing an empty list for both is exactly the silent-empty
 * failure that is worst on a shop floor.
 *
 * That distinction is also how this once failed completely. The parser took a
 * bare array, the server sends `{ materials, trackedInputs }`, and every test
 * fed it an array — so the tests passed and the tab told every operator on
 * every operation that its materials could not be read. The fixtures in
 * `tabs.test.ts` are now the live shape.
 *
 * A row with no item is dropped — nothing to name it, nothing to issue. A kit
 * PARENT is dropped too: it is a container whose children are the real lines,
 * so showing it would double every quantity on screen.
 */
export function parseMaterials(materials: unknown): {
  materials: OperationMaterial[];
  trackedInputs: ConsumedInput[];
  malformed: boolean;
} {
  if (materials === null || materials === undefined) {
    return { materials: [], trackedInputs: [], malformed: false };
  }
  const parsed = materialsPayload.safeParse(materials);
  if (!parsed.success) {
    return { materials: [], trackedInputs: [], malformed: true };
  }
  const lines = Array.isArray(parsed.data)
    ? parsed.data
    : parsed.data.materials;
  const trackedInputs = Array.isArray(parsed.data)
    ? []
    : (parsed.data.trackedInputs ?? []);
  return {
    materials: issuableMaterials(lines),
    trackedInputs,
    malformed: false
  };
}

/**
 * The inputs already consumed against ONE material line.
 *
 * `activityAttributes` belongs to the consume: its `Job Material` is the line
 * the lot was issued against. An input with no such attribute is left out —
 * offering Remove on a lot that might belong to another line is how the wrong
 * part gets pulled out of a unit's genealogy.
 */
export function consumedForMaterial(
  trackedInputs: ConsumedInput[],
  materialId: string | null | undefined
): ConsumedInput[] {
  if (!materialId) return [];
  return trackedInputs.filter(
    (input) =>
      (
        input.activityAttributes as Record<string, unknown> | null | undefined
      )?.["Job Material"] === materialId
  );
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
      const withoutRevision = material.itemReadableIdWithoutRevision
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

/**
 * The body of an untracked issue.
 *
 * **`Negative Adjmt.` is the issue.** The three names are INVENTORY's point of
 * view, not the job's: issuing a part takes it out of stock, so it is a
 * negative adjustment — the `issue` edge function writes a negative ledger row
 * and ADDS the quantity to `jobMaterial.quantityIssued`. `Positive Adjmt.` is
 * the return: stock goes back up and `quantityIssued` comes down.
 *
 * This app sent `Positive Adjmt.` for an issue, reading the word as "add to
 * what is issued". Every tap of Issue would have returned stock the job never
 * took and driven the issued quantity negative. It is built here, once, and
 * pinned by a test, so the direction cannot be flipped by a sheet again. Web's
 * `IssueMaterialModal` defaults to the same value.
 */
export function untrackedIssueBody(args: {
  itemId: string;
  materialId?: string | null;
  quantity: number;
  /** Scopes an unplanned part to the step it was issued on. */
  jobOperationStepId?: string;
}) {
  return {
    itemId: args.itemId,
    materialId: args.materialId ?? undefined,
    quantity: args.quantity,
    adjustmentType: "Negative Adjmt." as const,
    ...(args.jobOperationStepId
      ? { jobOperationStepId: args.jobOperationStepId }
      : {})
  };
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
