import { fromAbsolute, toCalendarDate } from "@internationalized/date";
import { buildOperationDependencies } from "./dependency-manager.ts";
import type {
  ReservationInterval,
  ResourceCapacityData
} from "./slot-allocator.ts";
import type {
  BaseOperation,
  FactorUnit,
  JobOperationDependency,
  OperationType
} from "./types.ts";
import type { FiniteSchedulingContext } from "./work-center-selector.ts";

const DAY_MS = 24 * 3_600_000;
/** Same fallback MRP uses when an item has no itemReplenishment.leadTime. */
const DEFAULT_ITEM_LEAD_TIME_DAYS = 7;

// A quote line's routing rows, already Number()-coerced by the loader. The
// engine's SchedulingEngine reads jobOperation/jobMaterial; the quote what-if
// feeds these hand-loaded quote rows through the same pure placement core.
export type QuoteMakeMethodRow = {
  id: string;
  parentMaterialId: string | null;
};
export type QuoteMaterialRow = {
  id: string;
  quoteMakeMethodId: string;
  itemId: string;
  methodType: "Purchase to Order" | "Pull from Inventory" | "Make to Order";
  /** per parent unit */
  quantity: number;
  /** consuming op */
  quoteOperationId: string | null;
};
export type QuoteOperationRow = {
  id: string;
  quoteMakeMethodId: string;
  processId: string | null;
  workCenterId: string | null;
  order: number;
  operationOrder: "After Previous" | "With Previous";
  operationType: string | null;
  description: string | null;
  setupTime: number;
  setupUnit: string;
  laborTime: number;
  laborUnit: string;
  machineTime: number;
  machineUnit: string;
  operationLeadTime: number;
};
export type MaterialAvailability = {
  /** itemReplenishment.leadTime, default 7 */
  leadTimeDaysByItem: Map<string, number>;
  /** itemStockQuantities at the location */
  onHandByItem: Map<string, number>;
};

/**
 * Turn a quote line's routing + BOM into synthetic finite-placement inputs for
 * one quantity: BaseOperations (quantities scaled down the make-method chain),
 * the dependency graph (within-method + assembly edges, exactly as the job
 * engine builds them), and per-operation material floors (materialReadyAt) for
 * purchased / short-stock parts. Pure — all DB reads happen in the loader.
 */
export function buildQuoteSimulation(args: {
  quoteLineId: string;
  quantity: number;
  makeMethods: QuoteMakeMethodRow[];
  materials: QuoteMaterialRow[];
  operations: QuoteOperationRow[];
  availability: MaterialAvailability;
  /** epoch ms */
  now: number;
}): {
  jobId: string;
  operations: BaseOperation[];
  dependencies: JobOperationDependency[];
  /** max floor in whole days, 0 if none */
  materialReadyDays: number;
  /** ops whose three times are all 0 */
  zeroStandardOperationCount: number;
} {
  const {
    quoteLineId,
    quantity,
    makeMethods,
    materials,
    operations,
    availability,
    now
  } = args;
  const jobId = `quote:${quoteLineId}:${quantity}`;

  const materialById = new Map(materials.map((m) => [m.id, m]));

  // Multiplier of each make method: the root is 1, every other method is its
  // parent material's method multiplier × the material's per-parent quantity.
  // Walk parents-first until no more resolve; a method whose parent never
  // resolves is dropped (along with its operations).
  const multiplierByMethod = new Map<string, number>();
  for (const mm of makeMethods) {
    if (mm.parentMaterialId === null) {
      multiplierByMethod.set(mm.id, 1);
    }
  }
  let progress = true;
  while (progress) {
    progress = false;
    for (const mm of makeMethods) {
      if (multiplierByMethod.has(mm.id)) continue;
      if (mm.parentMaterialId === null) continue;
      const parentMaterial = materialById.get(mm.parentMaterialId);
      if (!parentMaterial) continue;
      const parentMultiplier = multiplierByMethod.get(
        parentMaterial.quoteMakeMethodId
      );
      if (parentMultiplier === undefined) continue;
      multiplierByMethod.set(mm.id, parentMultiplier * parentMaterial.quantity);
      progress = true;
    }
  }

  // Build the operations for every resolved method.
  const builtOps: BaseOperation[] = [];
  const opById = new Map<string, BaseOperation>();
  const opsByMethod = new Map<string, BaseOperation[]>();
  for (const op of operations) {
    const multiplier = multiplierByMethod.get(op.quoteMakeMethodId);
    if (multiplier === undefined) continue;
    const built: BaseOperation = {
      id: op.id,
      jobId,
      jobMakeMethodId: op.quoteMakeMethodId,
      processId: op.processId,
      workCenterId: op.workCenterId,
      order: op.order,
      operationOrder: op.operationOrder,
      operationType: (op.operationType ?? undefined) as
        | OperationType
        | undefined,
      description: op.description,
      setupTime: op.setupTime,
      setupUnit: op.setupUnit as FactorUnit,
      laborTime: op.laborTime,
      laborUnit: op.laborUnit as FactorUnit,
      machineTime: op.machineTime,
      machineUnit: op.machineUnit as FactorUnit,
      operationLeadTime: op.operationLeadTime,
      operationQuantity: quantity * multiplier,
      quantityComplete: 0,
      status: "Todo"
    };
    builtOps.push(built);
    opById.set(op.id, built);
    const list = opsByMethod.get(op.quoteMakeMethodId) ?? [];
    list.push(built);
    opsByMethod.set(op.quoteMakeMethodId, list);
  }

  // Dependencies: within each method, plus one assembly edge per non-root
  // method from the child's last op to the parent's consuming op.
  const depMap = new Map<string, Set<string>>();
  for (const op of builtOps) {
    depMap.set(op.id!, new Set<string>());
  }
  for (const [, methodOps] of opsByMethod) {
    for (const [opId, deps] of buildOperationDependencies(methodOps)) {
      const existing = depMap.get(opId);
      if (existing) {
        for (const depId of deps) existing.add(depId);
      }
    }
  }
  for (const mm of makeMethods) {
    if (mm.parentMaterialId === null) continue;
    if (!multiplierByMethod.has(mm.id)) continue;
    const childOps = opsByMethod.get(mm.id) ?? [];
    if (childOps.length === 0) continue;
    const lastOpOfChild = [...childOps].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    )[childOps.length - 1];
    const parentMaterial = materialById.get(mm.parentMaterialId);
    if (!parentMaterial) continue;
    let consumingOpId = parentMaterial.quoteOperationId;
    if (!consumingOpId) {
      const parentOps = opsByMethod.get(parentMaterial.quoteMakeMethodId) ?? [];
      consumingOpId =
        [...parentOps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0]?.id ??
        null;
    }
    if (consumingOpId && lastOpOfChild?.id && depMap.has(consumingOpId)) {
      depMap.get(consumingOpId)!.add(lastOpOfChild.id);
    }
  }
  const dependencies: JobOperationDependency[] = [];
  for (const [operationId, deps] of depMap) {
    for (const dependsOnId of deps) {
      dependencies.push({ operationId, dependsOnId, jobId });
    }
  }

  // Material floors: a purchased part, or a stocked part short of the required
  // quantity, gates its consuming operation at now + the item's lead time.
  let materialReadyDays = 0;
  for (const material of materials) {
    const multiplier = multiplierByMethod.get(material.quoteMakeMethodId);
    if (multiplier === undefined) continue;
    const required = quantity * multiplier * material.quantity;
    let floorDays = 0;
    if (material.methodType === "Purchase to Order") {
      floorDays =
        availability.leadTimeDaysByItem.get(material.itemId) ??
        DEFAULT_ITEM_LEAD_TIME_DAYS;
    } else if (
      material.methodType === "Pull from Inventory" &&
      (availability.onHandByItem.get(material.itemId) ?? 0) < required
    ) {
      floorDays =
        availability.leadTimeDaysByItem.get(material.itemId) ??
        DEFAULT_ITEM_LEAD_TIME_DAYS;
    }
    if (floorDays <= 0) continue;

    let consumingOpId = material.quoteOperationId;
    if (!consumingOpId) {
      const methodOps = opsByMethod.get(material.quoteMakeMethodId) ?? [];
      consumingOpId =
        [...methodOps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0]?.id ??
        null;
    }
    if (!consumingOpId) continue;
    const consumingOp = opById.get(consumingOpId);
    if (!consumingOp) continue;

    const readyAt = now + floorDays * DAY_MS;
    consumingOp.materialReadyAt =
      consumingOp.materialReadyAt === undefined
        ? readyAt
        : Math.max(consumingOp.materialReadyAt, readyAt);
    if (floorDays > materialReadyDays) materialReadyDays = floorDays;
  }

  const zeroStandardOperationCount = builtOps.filter(
    (op) =>
      (op.setupTime ?? 0) === 0 &&
      (op.laborTime ?? 0) === 0 &&
      (op.machineTime ?? 0) === 0
  ).length;

  return {
    jobId,
    operations: builtOps,
    dependencies,
    materialReadyDays,
    zeroStandardOperationCount
  };
}

/**
 * A shallow clone that gives every simulation run its OWN reservation arrays.
 * FiniteSchedulingContext's reservation arrays "are mutated in-run as
 * operations are placed" (see its doc), so a second run over the same context
 * would see the first run's placements. Everything else is shared by reference.
 */
export function cloneFiniteContext(
  ctx: FiniteSchedulingContext
): FiniteSchedulingContext {
  const capacityByWorkCenter = new Map<string, ResourceCapacityData>();
  for (const [id, data] of ctx.capacityByWorkCenter) {
    capacityByWorkCenter.set(id, {
      ...data,
      reservations: [...data.reservations]
    });
  }
  const reservationsByEmployee = new Map<string, ReservationInterval[]>();
  for (const [id, list] of ctx.reservationsByEmployee) {
    reservationsByEmployee.set(id, [...list]);
  }
  return { ...ctx, capacityByWorkCenter, reservationsByEmployee };
}

/**
 * Calendar days from now to a finish instant, both resolved on the location's
 * calendar, minimum 1. `convert` turns leadTime into promisedDate = today + N,
 * so calendar days is the only unit that round-trips.
 */
export function calendarDaysFromNow(
  finishMs: number,
  nowMs: number,
  timeZone: string
): number {
  const finish = toCalendarDate(fromAbsolute(finishMs, timeZone));
  const today = toCalendarDate(fromAbsolute(nowMs, timeZone));
  const days = finish.compare(today);
  return days < 1 ? 1 : days;
}
