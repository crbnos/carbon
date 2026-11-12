// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

/**
 * The open operations a scanned unit can be issued into, best first: those
 * with a material still short of its requirement. A material with no
 * operation belongs to the last open operation of its make method.
 */
export function travelerIssueCandidates({
  operations,
  materials,
  workCenterId
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
}): string[] {
  const byId = new Map(
    operations.map((operation) => [operation.id, operation])
  );

  const lastByMakeMethod = new Map<string, (typeof operations)[number]>();
  for (const operation of operations) {
    const current = lastByMakeMethod.get(operation.jobMakeMethodId);
    if (!current || operation.operationOrder > current.operationOrder) {
      lastByMakeMethod.set(operation.jobMakeMethodId, operation);
    }
  }

  const candidateIds = new Set<string>();
  for (const material of materials) {
    const required = material.estimatedQuantity ?? material.quantity;
    if ((material.quantityIssued ?? 0) >= required) continue;
    const operationId =
      material.jobOperationId ??
      lastByMakeMethod.get(material.jobMakeMethodId)?.id;
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
  operationJobMakeMethodId
}: {
  scannedStatus: string | null;
  targetTrackedEntityId: string | null;
  targetStatus: string | null;
  targetJobMakeMethodId: string | null;
  operationJobMakeMethodId: string | null;
}):
  | { kind: "issue" }
  | { kind: "open"; trackedEntityId: string }
  | { kind: "navigate" } {
  if (scannedStatus === "Available") return { kind: "issue" };
  if (
    targetTrackedEntityId &&
    targetStatus === "Reserved" &&
    operationJobMakeMethodId &&
    targetJobMakeMethodId === operationJobMakeMethodId
  ) {
    return { kind: "open", trackedEntityId: targetTrackedEntityId };
  }
  return { kind: "navigate" };
}
