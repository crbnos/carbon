// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { EPSILON, round } from "@carbon/utils";

/**
 * The tracked entity id in a traveler link (`/x/traveler/<id>`). The label
 * holds the origin it was printed from, which need not be this deployment's
 * MES_URL, so only the path is compared. A raw id from an old label is not a
 * link: the resolve route handles it.
 */
export function parseTravelerCode(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const match = url.pathname.match(/^\/x\/traveler\/([^/?#]+)\/?$/);
  if (!match) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
  // `/x/traveler/resolve` is the raw-id route, not a unit.
  if (!id || id === "resolve") return null;
  return id;
}

/**
 * Which of a unit's open operations a traveler scan opens. The operator's work
 * center wins; without a match, the next operations in routing order. Two or
 * more candidates (parallel operations) ask the operator to choose.
 */
export function pickTravelerOperation({
  operations,
  workCenterId
}: {
  operations: {
    id: string;
    workCenterId: string | null;
    operationOrder: number;
  }[];
  workCenterId: string | null;
}):
  | { kind: "open"; operationId: string }
  | { kind: "choose"; operationIds: string[] }
  | { kind: "none" } {
  if (operations.length === 0) return { kind: "none" };

  const atStation = workCenterId
    ? operations.filter((operation) => operation.workCenterId === workCenterId)
    : [];

  let candidates = atStation;
  if (candidates.length === 0) {
    const lowestOrder = Math.min(
      ...operations.map((operation) => operation.operationOrder)
    );
    candidates = operations.filter(
      (operation) => operation.operationOrder === lowestOrder
    );
  }

  if (candidates.length === 1) {
    return { kind: "open", operationId: candidates[0]!.id };
  }
  return {
    kind: "choose",
    operationIds: candidates.map((operation) => operation.id)
  };
}

/** The job material fields the traveler issue rules read. */
export type TravelerMaterial = {
  id: string;
  jobOperationId: string | null;
  /** Quantity per unit of the make method. */
  quantity: number | null;
  estimatedQuantity: number | null;
  quantityIssued: number | null;
};

/** What a job material still needs for the whole job. */
export function jobMaterialShortfall(material: {
  quantity: number | null;
  estimatedQuantity: number | null;
  quantityIssued: number | null;
}): number {
  const required = material.estimatedQuantity ?? material.quantity ?? 0;
  return Math.max(0, round(required - (material.quantityIssued ?? 0)));
}

/**
 * What is consumed into a serial unit now, per job material and per item of
 * the consumed components (`getUnitConsumption`).
 */
export type TravelerConsumption = {
  materialId: string;
  itemId: string | null;
  quantity: number;
};

/**
 * The material a traveler scan issues the scanned item into at one
 * operation. Only a material on this operation, then one with no operation,
 * can take it. A serial unit (`unitConsumed` set: what is consumed into the
 * unit) takes a material while its quantity per unit is not consumed into
 * that unit. Consumption of the scanned item booked to another material (an
 * Issue dialog issue by item makes one) fills this operation's materials
 * first. Consumption of any other item never fills them: a fitted bolt is not
 * a chamber. Any other parent takes a material while the job still needs it.
 */
export function pickTravelerMaterial<T extends TravelerMaterial>({
  materials,
  jobOperationId,
  itemId,
  unitConsumed
}: {
  /** Every material of the scanned item on the make method. */
  materials: T[];
  jobOperationId: string;
  /** The scanned unit's item. */
  itemId: string | null;
  unitConsumed: TravelerConsumption[] | null;
}): { kind: "issue"; material: T } | { kind: "full" } | { kind: "notUsed" } {
  const byId = (a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const eligible = [
    ...materials.filter((m) => m.jobOperationId === jobOperationId).sort(byId),
    ...materials.filter((m) => m.jobOperationId === null).sort(byId)
  ];
  if (eligible.length === 0) return { kind: "notUsed" };

  if (!unitConsumed) {
    const material = eligible.find((m) => jobMaterialShortfall(m) > EPSILON);
    return material ? { kind: "issue", material } : { kind: "full" };
  }

  const known = new Set(materials.map((m) => m.id));
  const consumedByMaterial = new Map<string, number>();
  let unattributed = 0;
  for (const entry of unitConsumed) {
    if (known.has(entry.materialId)) {
      consumedByMaterial.set(
        entry.materialId,
        (consumedByMaterial.get(entry.materialId) ?? 0) + entry.quantity
      );
    } else if (itemId !== null && entry.itemId === itemId) {
      unattributed += entry.quantity;
    }
  }
  for (const material of materials) {
    const consumed = consumedByMaterial.get(material.id) ?? 0;
    unattributed += Math.max(0, consumed - (material.quantity ?? 0));
  }

  for (const material of eligible) {
    const consumed = consumedByMaterial.get(material.id) ?? 0;
    let need = Math.max(0, round((material.quantity ?? 0) - consumed));
    const covered = Math.min(need, unattributed);
    need = round(need - covered);
    unattributed = round(unattributed - covered);
    if (need > EPSILON) return { kind: "issue", material };
  }
  return { kind: "full" };
}

/**
 * Whether an operation applies to a unit. A rework operation with scope rows
 * (`jobOperationTrackedEntity`) applies only to the units listed; an
 * operation with no rows applies to every unit.
 */
export function isUnitInOperationScope(
  scopes: Map<string, Set<string>>,
  operationId: string,
  trackedEntityId: string
): boolean {
  const scoped = scopes.get(operationId);
  return !scoped || scoped.has(trackedEntityId);
}

/**
 * The open operations a scanned unit can be issued into, best first: those
 * with a material still short of its requirement. A material with no
 * operation belongs to the first open operation of its make method (lowest
 * order, then id), where the picking list stages it. A make
 * method in `perUnitMakeMethodIds` builds serial units: its materials are not
 * checked against the job here, because the caller checks each one against
 * the unit it issues into (`pickTravelerMaterial`).
 */
export function travelerIssueCandidates({
  operations,
  materials,
  workCenterId,
  perUnitMakeMethodIds
}: {
  operations: {
    id: string;
    jobMakeMethodId: string;
    workCenterId: string | null;
    operationOrder: number;
    /** ISO date (YYYY-MM-DD); compared as text. */
    jobDueDate: string | null;
  }[];
  materials: {
    jobMakeMethodId: string;
    jobOperationId: string | null;
    quantity: number;
    estimatedQuantity: number | null;
    quantityIssued: number | null;
  }[];
  workCenterId: string | null;
  perUnitMakeMethodIds?: Set<string>;
}): string[] {
  const byId = new Map(
    operations.map((operation) => [operation.id, operation])
  );

  const firstByMakeMethod = new Map<string, (typeof operations)[number]>();
  for (const operation of operations) {
    const current = firstByMakeMethod.get(operation.jobMakeMethodId);
    if (
      !current ||
      operation.operationOrder < current.operationOrder ||
      (operation.operationOrder === current.operationOrder &&
        operation.id < current.id)
    ) {
      firstByMakeMethod.set(operation.jobMakeMethodId, operation);
    }
  }

  const candidateIds = new Set<string>();
  for (const material of materials) {
    if (
      !perUnitMakeMethodIds?.has(material.jobMakeMethodId) &&
      jobMaterialShortfall(material) <= EPSILON
    ) {
      continue;
    }
    const operationId =
      material.jobOperationId ??
      firstByMakeMethod.get(material.jobMakeMethodId)?.id;
    if (!operationId || !byId.has(operationId)) continue;
    candidateIds.add(operationId);
  }

  const candidates = [...candidateIds].map((id) => byId.get(id)!);
  candidates.sort((a, b) => {
    const aHere = workCenterId !== null && a.workCenterId === workCenterId;
    const bHere = workCenterId !== null && b.workCenterId === workCenterId;
    if (aHere !== bHere) return aHere ? -1 : 1;
    if (a.jobDueDate !== b.jobDueDate) {
      if (a.jobDueDate === null) return 1;
      if (b.jobDueDate === null) return -1;
      return a.jobDueDate < b.jobDueDate ? -1 : 1;
    }
    return a.operationOrder - b.operationOrder;
  });

  return candidates.map((operation) => operation.id);
}

/**
 * What a traveler scan on an operation screen does. An available unit is
 * issued into the operation. A unit already inside this job's unit (its
 * target is reserved on this make method) opens that unit, with no issue.
 * Anything else goes through the traveler route.
 */
export function travelerScanAction({
  scannedStatus,
  targetTrackedEntityId,
  targetStatus,
  targetJobMakeMethodId,
  targetInProduction,
  operationJobMakeMethodId
}: {
  scannedStatus: string | null;
  targetTrackedEntityId: string | null;
  targetStatus: string | null;
  targetJobMakeMethodId: string | null;
  /** The target unit's own job still has open operations for it. */
  targetInProduction: boolean;
  operationJobMakeMethodId: string | null;
}):
  | { kind: "issue" }
  | { kind: "open"; trackedEntityId: string }
  | { kind: "navigate" } {
  // A unit of this operation's own make method opens here, whatever its
  // status: a serial unit turns Available after any completed operation.
  if (
    targetTrackedEntityId &&
    (targetStatus === "Reserved" || targetStatus === "Available") &&
    operationJobMakeMethodId &&
    targetJobMakeMethodId === operationJobMakeMethodId
  ) {
    return { kind: "open", trackedEntityId: targetTrackedEntityId };
  }
  // A unit still being built elsewhere is never issued: open its own work.
  if (targetInProduction) return { kind: "navigate" };
  if (scannedStatus === "Available") return { kind: "issue" };
  return { kind: "navigate" };
}
