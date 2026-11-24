// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { EPSILON, round } from "@carbon/utils";

/**
 * The tracked entity id in a traveler link (`/x/traveler/<id>`). The label
 * holds the origin it was printed from, which need not be this deployment's
 * MES_URL, so only the path is compared. A raw id from an old label is not a
 * link: the scan endpoint looks it up.
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
  // `/x/traveler/scan` is the scan endpoint, not a unit.
  if (!id || id === "scan") return null;
  return id;
}

/** The serial confirmed by a traveler scan or the on-screen claim chooser. */
export function travelerIssueSerial(
  code: string,
  entity: { id: string; readableId: string | null },
  selectedSerial?: string
) {
  return (
    selectedSerial ??
    (code === entity.readableId &&
    code !== entity.id &&
    !parseTravelerCode(code)
      ? code
      : undefined)
  );
}

/** Match the printed ID first. A human-readable serial must identify exactly one candidate. */
export function findScannedUnit<
  T extends { id: string | null; readableId: string | null }
>(candidates: readonly T[], value: string): T | undefined {
  if (!value.trim()) return undefined;
  const travelerId = parseTravelerCode(value);
  const byId = candidates.find((unit) => unit.id === (travelerId ?? value));
  if (travelerId || byId) return byId;
  const matches = candidates.filter((unit) => unit.readableId === value);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Capture what a scan or selection identified while that stock list was on screen. */
export function captureIssueSerial(
  stock: readonly { id: string | null; readableId: string | null }[],
  value: string,
  pairingScan = false
) {
  const unit = findScannedUnit(stock, value);
  if (
    pairingScan &&
    unit?.id &&
    unit.readableId != null &&
    travelerIssueSerial(value, { id: unit.id, readableId: unit.readableId }) ===
      undefined
  ) {
    return { observedId: unit.id, confirmSerial: unit.readableId };
  }
  return {
    observedId: unit?.id ?? undefined,
    expectedSerial: unit?.readableId ?? undefined
  };
}

/** Resolve the physical children for one Issue request, including the frozen label. */
export function issueSerialChildren(
  serials: readonly {
    id: string;
    expectedSerial?: string;
    confirmSerial?: string;
  }[],
  action: "scan" | "confirm"
) {
  if (action === "scan" && serials.some((sn) => sn.confirmSerial !== undefined))
    return null;
  return serials.map((sn) => ({
    trackedEntityId: sn.id,
    quantity: 1,
    expectedSerial: sn.expectedSerial ?? sn.confirmSerial
  }));
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
}):
  | {
      kind: "issue";
      material: T /** What the material still needs. */;
      needed: number;
    }
  | { kind: "full" }
  | { kind: "notUsed" } {
  const byId = (a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const eligible = [
    ...materials.filter((m) => m.jobOperationId === jobOperationId).sort(byId),
    ...materials.filter((m) => m.jobOperationId === null).sort(byId)
  ];
  if (eligible.length === 0) return { kind: "notUsed" };

  if (!unitConsumed) {
    const material = eligible.find((m) => jobMaterialShortfall(m) > EPSILON);
    return material
      ? { kind: "issue", material, needed: jobMaterialShortfall(material) }
      : { kind: "full" };
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
    if (need > EPSILON) return { kind: "issue", material, needed: need };
  }
  return { kind: "full" };
}

/**
 * How much one scan of a batch lot's label issues: what the material still
 * needs, up to what the lot holds in stock the job can draw (its own
 * location, nettable bins, its stripes). Zero when the lot has none there.
 */
export function batchScanQuantity({
  needed,
  available
}: {
  needed: number;
  available: number;
}): number {
  return Math.max(0, round(Math.min(needed, available)));
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

/** A free unit's claim: the unit it is issued into and the material it fills. */
export type TravelerClaim = {
  operationId: string;
  parentTrackedEntityId: string;
  materialId: string;
};

/**
 * Where a free scanned unit (a kit, a finished sub-assembly) goes at each
 * candidate operation, in the order given; at most one claim per operation.
 * A serial make method offers every unit still open at the operation, in unit
 * order with `preferredUnitId` first, and takes the first that does not hold
 * the item yet: with five kits in flight, the sixth kit claims the sixth unit.
 * Any other make method has one parent, its next open unit, and takes the
 * item while the job still needs it.
 */
export function pickTravelerClaims<
  M extends TravelerMaterial & { jobMakeMethodId: string }
>({
  operations,
  unitIds,
  isOpenAt,
  serialMakeMethodIds,
  materials,
  itemId,
  consumed,
  preferredUnitId
}: {
  operations: { id: string; jobMakeMethodId: string }[];
  /** Live unit ids of each make method, in unit order. */
  unitIds: Map<string, string[]>;
  isOpenAt: (unitId: string, operationId: string) => boolean;
  serialMakeMethodIds: Set<string>;
  materials: M[];
  itemId: string | null;
  /** What is consumed into each serial unit (`getUnitConsumption`). */
  consumed: Map<string, TravelerConsumption[]>;
  preferredUnitId?: string | null;
}): TravelerClaim[] {
  const claims: TravelerClaim[] = [];
  for (const operation of operations) {
    const ids = unitIds.get(operation.jobMakeMethodId) ?? [];
    const open = ids.filter((id) => isOpenAt(id, operation.id));
    const serial = serialMakeMethodIds.has(operation.jobMakeMethodId);
    const parents = serial
      ? preferredUnitId && open.includes(preferredUnitId)
        ? [preferredUnitId, ...open.filter((id) => id !== preferredUnitId)]
        : open
      : [open[0] ?? ids[ids.length - 1]].filter((id): id is string => !!id);
    const own = materials.filter(
      (m) => m.jobMakeMethodId === operation.jobMakeMethodId
    );
    for (const parentId of parents) {
      const picked = pickTravelerMaterial({
        materials: own,
        jobOperationId: operation.id,
        itemId,
        unitConsumed: serial ? (consumed.get(parentId) ?? []) : null
      });
      if (picked.kind === "issue") {
        claims.push({
          operationId: operation.id,
          parentTrackedEntityId: parentId,
          materialId: picked.material.id
        });
        break;
      }
    }
  }
  return claims;
}

/**
 * Which claims a scanned free unit may go into, and whether the best one is
 * taken without asking.
 *
 * A claim at a later operation of a serial part (`laterSerial`) goes only
 * into the unit the operator holds (`heldUnitId`, the unit on screen): the
 * server never picks that unit. On an operation page with none held the
 * operator picks one first (`pickUnit`); on any other page such a claim is
 * never taken unasked.
 *
 * Any other claim is taken on an operation page, which keeps it inside that
 * operation. On any other page only a serial unit (one part, one label) goes
 * in unasked: a batch lot would issue stock, so it asks. An operator with a
 * station takes the best claim only at that station; one with none takes it
 * only when it is the one place at the location that needs the part.
 */
export function decideTravelerClaim<
  T extends {
    parentTrackedEntityId: string;
    laterSerial: boolean;
    operation: { workCenterId: string | null };
  }
>({
  onOperationPage,
  heldUnitId,
  isSerial,
  workCenterId,
  options
}: {
  onOperationPage: boolean;
  /** The unit on screen the operator scanned or picked. */
  heldUnitId: string | null;
  isSerial: boolean;
  /** The operator's station today. */
  workCenterId: string | null;
  /** The claims, best first. */
  options: T[];
}): { kind: "pickUnit" } | { kind: "claim"; options: T[]; auto: boolean } {
  if (onOperationPage) {
    if (!heldUnitId && options.some((o) => o.laterSerial)) {
      return { kind: "pickUnit" };
    }
    return {
      kind: "claim",
      options: options.filter(
        (o) => !o.laterSerial || o.parentTrackedEntityId === heldUnitId
      ),
      auto: true
    };
  }
  const best = options[0];
  if (!best || best.laterSerial || !isSerial) {
    return { kind: "claim", options, auto: false };
  }
  const auto =
    workCenterId === null
      ? options.length === 1
      : best.operation.workCenterId === workCenterId;
  return { kind: "claim", options, auto };
}
