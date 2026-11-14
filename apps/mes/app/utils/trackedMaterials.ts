// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "@carbon/utils";

export type RequiredScanMaterial = {
  id: string | null;
  jobMakeMethodId: string | null;
  jobOperationId: string | null;
  requiresSerialTracking: boolean | null;
  requiresBatchTracking: boolean | null;
  quantity: number | null;
  quantityIssued: number | null;
};

/**
 * The serial and batch materials an operation consumes that are not yet
 * issued for the units it will have completed. A material with no
 * operation is consumed at the first open operation of its make method.
 */
export function unissuedTrackedMaterials<T extends RequiredScanMaterial>(args: {
  materials: T[];
  operationId: string;
  jobMakeMethodId: string;
  isFirstOpenOperation: boolean;
  unitsAfterCompletion: number;
}): T[] {
  const {
    materials,
    operationId,
    jobMakeMethodId,
    isFirstOpenOperation,
    unitsAfterCompletion
  } = args;

  return materials.filter((material) => {
    if (!material.requiresSerialTracking && !material.requiresBatchTracking) {
      return false;
    }
    if (material.jobMakeMethodId !== jobMakeMethodId) return false;

    const consumedHere =
      material.jobOperationId === operationId ||
      (material.jobOperationId === null && isFirstOpenOperation);
    if (!consumedHere) return false;

    // At the internal quantity scale: 0.1 × 3 units is 0.30000000000000004
    // in floating point, which would refuse a fully issued 0.3.
    return (
      round(material.quantityIssued ?? 0) <
      round((material.quantity ?? 0) * unitsAfterCompletion)
    );
  });
}

export function requiredScanMessage(
  rows: { itemReadableId: string; issued: number; required: number }[]
): string | null {
  if (rows.length === 0) return null;
  return `Scan in these parts first: ${rows
    .map((row) => `${row.itemReadableId} (${row.issued} of ${row.required})`)
    .join(", ")}`;
}

/**
 * The first open operation of each make method: the lowest `order`, then the
 * lowest id. `operations` are the open (not Done or Canceled) operations of
 * the make methods. A material with no operation is consumed there, where
 * `generatePickingList` stages it and `get_line_feed_shortages` counts it.
 */
export function firstOpenOperationIds(
  operations: { id: string; jobMakeMethodId: string | null; order: number }[]
): Set<string> {
  const first = new Map<string, (typeof operations)[number]>();
  for (const operation of operations) {
    if (!operation.jobMakeMethodId) continue;
    const current = first.get(operation.jobMakeMethodId);
    if (
      !current ||
      operation.order < current.order ||
      (operation.order === current.order && operation.id < current.id)
    ) {
      first.set(operation.jobMakeMethodId, operation);
    }
  }
  return new Set([...first.values()].map((operation) => operation.id));
}

/**
 * The inputs still inside a unit: what was consumed into it (`inputs`, the
 * strict descendants), less a Scrapped input and less an input given back by
 * an Unconsume (it appears in `outputs`, the strict ancestors, as often as in
 * `inputs`). With no outputs every live input counts.
 */
export function netTrackedInputs<
  T extends { id: string; status?: string | null }
>(inputs: T[], outputs: { id: string }[]): T[] {
  const live = inputs.filter((input) => input.status !== "Scrapped");
  if (outputs.length === 0) return live;

  const inputCounts = new Map<string, number>();
  for (const input of live) {
    inputCounts.set(input.id, (inputCounts.get(input.id) ?? 0) + 1);
  }
  const outputCounts = new Map<string, number>();
  for (const output of outputs) {
    outputCounts.set(output.id, (outputCounts.get(output.id) ?? 0) + 1);
  }
  const included = new Set<string>();
  return live.filter((input) => {
    if (included.has(input.id)) return false;
    if ((inputCounts.get(input.id) ?? 0) <= (outputCounts.get(input.id) ?? 0)) {
      return false;
    }
    included.add(input.id);
    return true;
  });
}

/** The quantity scanned into a unit per job material. */
export function issuedByJobMaterial(
  inputs: { quantity: number | null; activityAttributes: unknown }[]
): Map<string, number> {
  const issued = new Map<string, number>();
  for (const input of inputs) {
    const attributes = input.activityAttributes as Record<
      string,
      unknown
    > | null;
    const materialId = attributes?.["Job Material"];
    if (typeof materialId !== "string") continue;
    issued.set(
      materialId,
      (issued.get(materialId) ?? 0) + Number(input.quantity ?? 0)
    );
  }
  return issued;
}

export type RequiredScanUnits =
  /** A batch or untracked parent: the operation's `quantityIssued` counts. */
  | { kind: "operation"; unitsAfterCompletion: number }
  /** Serial units: each unit counts only what was scanned into it. */
  | { kind: "serial"; issuedByUnit: Map<string, number>[] };

/**
 * The short materials of one operation, with what is issued and what is
 * required over the units checked. A serial material is short when any unit
 * holds less than its quantity; `issued` counts at most the quantity per unit.
 */
export function requiredScanShortfall<T extends RequiredScanMaterial>(args: {
  materials: T[];
  operationId: string;
  jobMakeMethodId: string;
  isFirstOpenOperation: boolean;
  units: RequiredScanUnits;
}): { material: T; issued: number; required: number }[] {
  const {
    materials,
    operationId,
    jobMakeMethodId,
    isFirstOpenOperation,
    units
  } = args;

  if (units.kind === "operation") {
    return unissuedTrackedMaterials({
      materials,
      operationId,
      jobMakeMethodId,
      isFirstOpenOperation,
      unitsAfterCompletion: units.unitsAfterCompletion
    }).map((material) => ({
      material,
      issued: round(material.quantityIssued ?? 0),
      required: round((material.quantity ?? 0) * units.unitsAfterCompletion)
    }));
  }

  const short = new Set<T>();
  for (const issuedToUnit of units.issuedByUnit) {
    const unissued = unissuedTrackedMaterials({
      materials: materials.map((material) => ({
        ...material,
        quantityIssued: material.id ? (issuedToUnit.get(material.id) ?? 0) : 0
      })),
      operationId,
      jobMakeMethodId,
      isFirstOpenOperation,
      unitsAfterCompletion: 1
    });
    const unissuedIds = new Set(unissued.map((material) => material.id));
    for (const material of materials) {
      if (unissuedIds.has(material.id)) short.add(material);
    }
  }

  return materials
    .filter((material) => short.has(material))
    .map((material) => {
      const perUnit = material.quantity ?? 0;
      const issued = units.issuedByUnit.reduce(
        (sum, issuedToUnit) =>
          sum +
          Math.min(
            material.id ? (issuedToUnit.get(material.id) ?? 0) : 0,
            perUnit
          ),
        0
      );
      return {
        material,
        issued: round(issued),
        required: round(perUnit * units.issuedByUnit.length)
      };
    });
}

/**
 * The refusal for a batch: each member that is short, by its label, with its
 * parts. Null when no member is short.
 */
export function batchRequiredScanMessage(
  members: {
    label: string;
    rows: { itemReadableId: string; issued: number; required: number }[];
  }[]
): string | null {
  const short = members.filter((member) => member.rows.length > 0);
  if (short.length === 0) return null;
  return `Scan in these parts first: ${short
    .map(
      (member) =>
        `${member.label}: ${member.rows
          .map(
            (row) => `${row.itemReadableId} (${row.issued} of ${row.required})`
          )
          .join(", ")}`
    )
    .join("; ")}`;
}
