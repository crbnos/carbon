import type { Database } from "@carbon/database";
import type { DB } from "@carbon/database/client";
import {
  fromAbsolute,
  parseDate,
  toCalendarDate
} from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import {
  type BatchPlacement,
  placeReleasedBatches
} from "./batch-scheduler.ts";
import { buildScheduledOperations } from "./date-calculator.ts";
import {
  businessDayFromMs,
  msToInstantIso,
  toInstantMs
} from "./date-utils.ts";
import { buildOperationDependencies } from "./dependency-manager.ts";
import {
  buildFiniteContext,
  loadAvailabilityWindows,
  SCHEDULING_HORIZON_DAYS
} from "./finite-context.ts";
import { KyselyMasterDataProvider } from "./master-data-provider.ts";
import { loadOrderedBatch } from "./run-schedule.ts";
import type {
  ReservationInterval,
  ResourceCapacityData
} from "./slot-allocator.ts";
import type {
  BaseOperation,
  FactorUnit,
  JobOperationDependency,
  OperationType,
  ScheduledOperation
} from "./types.ts";
import {
  type FiniteSchedulingContext,
  WorkCenterSelector
} from "./work-center-selector.ts";

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

// ============================================================================
// Orchestrator — runQuoteLeadTimeWhatIf
// ============================================================================

export type QuoteLeadTimeScenario = {
  /** ISO instant of the last placed end */
  finishAt: string | null;
  /** calendar days from today (location tz), min 1 */
  leadTimeDays: number | null;
  /** first conflict, else the longest wait's note */
  cause: string | null;
};

export type QuoteLeadTimeForecast = {
  quoteLineId: string;
  locationId: string;
  computedAt: string;
  /** ops whose three time standards are all 0 (constant across quantities) */
  zeroStandardOperationCount: number;
  quantities: Array<{
    quantity: number;
    /** 0 when nothing gates */
    materialReadyDays: number;
    /** end of queue */
    queued: QuoteLeadTimeScenario;
    /** front of queue */
    bestCase: QuoteLeadTimeScenario;
    /** present only when a dueDate was sent */
    target: {
      /** YYYY-MM-DD */
      date: string;
      verdict: "on-time" | "expedite" | "late";
      /** negative = short, vs the queued finish */
      slackDays: number;
    } | null;
  }>;
  /** rendered verbatim in the modal */
  assumptions: string[];
};

/**
 * Load a quote line's routing + BOM with Kysely, scoped to the company. Returns
 * null when the line has no make method (a Pull/Purchase line has no routing to
 * schedule). Every numeric is Number()-coerced — Kysely hands NUMERIC back as a
 * string.
 */
async function loadQuoteLineRouting(
  db: Kysely<DB>,
  quoteLineId: string,
  companyId: string
): Promise<{
  makeMethods: QuoteMakeMethodRow[];
  materials: QuoteMaterialRow[];
  operations: QuoteOperationRow[];
} | null> {
  const [makeMethodRows, materialRows, operationRows] = await Promise.all([
    db
      .selectFrom("quoteMakeMethod")
      .select(["id", "parentMaterialId"])
      .where("quoteLineId", "=", quoteLineId)
      .where("companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("quoteMaterial")
      .select([
        "id",
        "quoteMakeMethodId",
        "itemId",
        "methodType",
        "quantity",
        "quoteOperationId"
      ])
      .where("quoteLineId", "=", quoteLineId)
      .where("companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("quoteOperation")
      .select([
        "id",
        "quoteMakeMethodId",
        "processId",
        "workCenterId",
        "order",
        "operationOrder",
        "operationType",
        "description",
        "setupTime",
        "setupUnit",
        "laborTime",
        "laborUnit",
        "machineTime",
        "machineUnit",
        "operationLeadTime"
      ])
      .where("quoteLineId", "=", quoteLineId)
      .where("companyId", "=", companyId)
      .execute()
  ]);

  if (makeMethodRows.length === 0) return null;

  const makeMethods: QuoteMakeMethodRow[] = makeMethodRows.map((m) => ({
    id: m.id,
    parentMaterialId: m.parentMaterialId
  }));
  const materials: QuoteMaterialRow[] = materialRows.map((m) => ({
    id: m.id,
    quoteMakeMethodId: m.quoteMakeMethodId,
    itemId: m.itemId,
    methodType: m.methodType,
    quantity: Number(m.quantity),
    quoteOperationId: m.quoteOperationId
  }));
  const operations: QuoteOperationRow[] = operationRows
    .filter(
      (o): o is typeof o & { quoteMakeMethodId: string } =>
        o.quoteMakeMethodId !== null
    )
    .map((o) => ({
      id: o.id,
      quoteMakeMethodId: o.quoteMakeMethodId,
      processId: o.processId,
      workCenterId: o.workCenterId,
      order: Number(o.order),
      operationOrder: o.operationOrder,
      operationType: o.operationType,
      description: o.description,
      setupTime: Number(o.setupTime),
      setupUnit: o.setupUnit,
      laborTime: Number(o.laborTime),
      laborUnit: o.laborUnit,
      machineTime: Number(o.machineTime),
      machineUnit: o.machineUnit,
      operationLeadTime: Number(o.operationLeadTime)
    }));

  return { makeMethods, materials, operations };
}

/**
 * Item lead times (itemReplenishment.leadTime, default 7) and location on-hand
 * (itemStockQuantities, the aggregate runMrp reads) for the material floors.
 */
async function loadMaterialAvailability(
  db: Kysely<DB>,
  itemIds: string[],
  locationId: string,
  companyId: string
): Promise<MaterialAvailability> {
  const leadTimeDaysByItem = new Map<string, number>();
  const onHandByItem = new Map<string, number>();
  if (itemIds.length === 0) return { leadTimeDaysByItem, onHandByItem };

  const [replenishmentRows, stockRows] = await Promise.all([
    db
      .selectFrom("itemReplenishment")
      .select(["itemId", "leadTime"])
      .where("itemId", "in", itemIds)
      .where("companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("itemStockQuantities")
      .select(["itemId", "quantityOnHand"])
      .where("itemId", "in", itemIds)
      .where("locationId", "=", locationId)
      .where("companyId", "=", companyId)
      .execute()
  ]);
  for (const r of replenishmentRows) {
    if (r.itemId != null) {
      leadTimeDaysByItem.set(
        r.itemId,
        Number(r.leadTime ?? DEFAULT_ITEM_LEAD_TIME_DAYS)
      );
    }
  }
  for (const r of stockRows) {
    if (r.itemId != null) {
      onHandByItem.set(r.itemId, Number(r.quantityOnHand) || 0);
    }
  }
  return { leadTimeDaysByItem, onHandByItem };
}

/**
 * Capable-to-promise for a quote line: forward-ASAP finite placement of the
 * line's synthetic routing against the live reservation snapshot ("end of
 * queue", excludeJobIds []) and against the location's open jobs excluded
 * ("best case", the same snapshot runExpediteWhatIf uses). Persists nothing.
 * Returns null when the line has no routing to schedule.
 */
export async function runQuoteLeadTimeWhatIf(params: {
  db: Kysely<DB>;
  client: SupabaseClient<Database>;
  companyId: string;
  userId: string;
  locationId: string;
  quoteLineId: string;
  quantities: number[];
  dueDate?: string | null;
}): Promise<QuoteLeadTimeForecast | null> {
  const {
    db,
    client,
    companyId,
    userId,
    locationId,
    quoteLineId,
    quantities,
    dueDate
  } = params;

  // The engine's clock convention: one `now` for the whole run. Not used for
  // anything but epoch-ms arithmetic.
  const now = Date.now();

  const locationRow = await db
    .selectFrom("location")
    .select(["timezone", "name"])
    .where("id", "=", locationId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  const timeZone = locationRow?.timezone ?? "UTC";
  const locationName = locationRow?.name ?? "this location";

  const routing = await loadQuoteLineRouting(db, quoteLineId, companyId);
  if (!routing) return null;

  const availability = await loadMaterialAvailability(
    db,
    Array.from(new Set(routing.materials.map((m) => m.itemId))),
    locationId,
    companyId
  );

  const provider = new KyselyMasterDataProvider(db, client, companyId, {
    cacheCompanyData: true
  });

  const batch = await loadOrderedBatch(db, locationId, companyId);

  // Mirror the existing batch reservations (persist: false reads them back)
  // so the what-if agrees with the rows already in its snapshot.
  let batchPlacements: Map<string, BatchPlacement> | null = null;
  try {
    batchPlacements = await placeReleasedBatches({
      db,
      provider,
      companyId,
      locationId,
      now,
      userId,
      orderedJobIds: batch,
      horizonEnd: now + (SCHEDULING_HORIZON_DAYS + 7) * 24 * 3_600_000,
      persist: false
    });
  } catch {
    // fall through — the sim runs with per-member placement
  }

  const selector = new WorkCenterSelector(provider, locationId);
  await selector.initialize();

  // The op ids, process ids and dependency graph are identical for every
  // quantity — only operationQuantity scales. Build the first simulation to
  // derive the windows fetch and the two contexts once.
  const firstSim = buildQuoteSimulation({
    quoteLineId,
    quantity: quantities[0]!,
    ...routing,
    availability,
    now
  });
  const firstOps = Array.from(
    buildScheduledOperations(firstSim.operations).values()
  );

  const windows = await loadAvailabilityWindows({
    provider,
    workCenterSelector: selector,
    operations: firstOps,
    locationId,
    now
  });

  const queuedCtx = await buildFiniteContext({
    provider,
    operations: firstOps,
    dependencies: firstSim.dependencies,
    availability: windows,
    locationId,
    timeZone,
    now,
    excludeJobIds: []
  });
  const bestCtx = await buildFiniteContext({
    provider,
    operations: firstOps,
    dependencies: firstSim.dependencies,
    availability: windows,
    locationId,
    timeZone,
    now,
    excludeJobIds: batch
  });

  // One selector instance for every run: selectWorkCentersForOperations resets
  // plannedReservations at its start and setFiniteContext swaps the context, so
  // a cloned context per run is the only isolation needed.
  const runScenario = (
    ctx: FiniteSchedulingContext,
    ops: ScheduledOperation[]
  ): { finishMs: number | null; cause: string | null } => {
    selector.setFiniteContext(cloneFiniteContext(ctx));
    const selections = selector.selectWorkCentersForOperations(ops, {
      jobDueDate: dueDate ?? null,
      batchPlacements
    });
    // Projected finish = the latest placed end across selections and the
    // planned reservations, the same union selectWorkCenters() computes.
    let finishMs: number | null = null;
    const bump = (ms: number) => {
      if (finishMs === null || ms > finishMs) finishMs = ms;
    };
    for (const s of selections.values()) {
      if (s.placedEnd) bump(toInstantMs(s.placedEnd));
    }
    for (const p of selector.getPlannedReservations()) {
      if (p.endAt > p.startAt) bump(p.endAt);
    }
    // Cause: the first conflict, else the note of the reservation that waited
    // longest for capacity.
    let cause: string | null = null;
    for (const s of selections.values()) {
      if (s.conflict) {
        cause = s.conflict;
        break;
      }
    }
    if (!cause) {
      let maxWait = -1;
      for (const p of selector.getPlannedReservations()) {
        if (!p.scheduleNote) continue;
        const wait =
          p.earliestStartAt !== undefined ? p.startAt - p.earliestStartAt : 0;
        if (wait > maxWait) {
          maxWait = wait;
          cause = p.scheduleNote;
        }
      }
    }
    return { finishMs, cause };
  };

  const scenarioResult = (r: {
    finishMs: number | null;
    cause: string | null;
  }): QuoteLeadTimeScenario => ({
    finishAt: r.finishMs === null ? null : msToInstantIso(r.finishMs),
    leadTimeDays:
      r.finishMs === null
        ? null
        : calendarDaysFromNow(r.finishMs, now, timeZone),
    cause: r.cause
  });

  const quantityResults = quantities.map((quantity) => {
    const sim = buildQuoteSimulation({
      quoteLineId,
      quantity,
      ...routing,
      availability,
      now
    });
    const ops = Array.from(buildScheduledOperations(sim.operations).values());

    const queued = runScenario(queuedCtx, ops);
    const bestCase = runScenario(bestCtx, ops);

    let target: {
      date: string;
      verdict: "on-time" | "expedite" | "late";
      slackDays: number;
    } | null = null;
    if (dueDate) {
      const queuedFinishDate =
        queued.finishMs === null
          ? null
          : businessDayFromMs(queued.finishMs, timeZone);
      const bestFinishDate =
        bestCase.finishMs === null
          ? null
          : businessDayFromMs(bestCase.finishMs, timeZone);
      let verdict: "on-time" | "expedite" | "late";
      if (queuedFinishDate && queuedFinishDate <= dueDate) {
        verdict = "on-time";
      } else if (bestFinishDate && bestFinishDate <= dueDate) {
        verdict = "expedite";
      } else {
        verdict = "late";
      }
      const slackDays = queuedFinishDate
        ? parseDate(dueDate).compare(parseDate(queuedFinishDate))
        : 0;
      target = { date: dueDate, verdict, slackDays };
    }

    return {
      quantity,
      materialReadyDays: sim.materialReadyDays,
      queued: scenarioResult(queued),
      bestCase: scenarioResult(bestCase),
      target
    };
  });

  const assumptions = [
    `Placed after every job already released at ${locationName}`,
    `Purchased material is available after its item lead time; stock is netted at ${locationName} only`,
    "No shipping buffer is added"
  ];

  return {
    quoteLineId,
    locationId,
    computedAt: msToInstantIso(now),
    zeroStandardOperationCount: firstSim.zeroStandardOperationCount,
    quantities: quantityResults,
    assumptions
  };
}
