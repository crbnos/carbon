// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// MRP v2 Phase 2a: planned orders in the common segment. `createPlanSupply`
// builds the `planSupply` hook `explodeBom` calls once per common key. The
// hook sizes the key with `sizeRowSupply` (the sizing the planning worklist
// uses), holds Firm and fence-held planned orders, applies the planning time
// fence to new orders, and returns what the engine explodes: the lot-sized
// quantity plus the parent's scrap, at the order's release week.
// Pure: no I/O, no clock.
//
// A key gets planned orders only where the planning RPCs
// (`get_production_planning` / `get_purchasing_planning`) give the worklist a
// row that sizes new supply. Every other key (a project or planning group
// segment, a superseded item, an item with no `itemPlanning` row at the
// location, …) returns null and keeps the Phase 1 path.

import type { Database } from "@carbon/database";
import {
  type BomExplosionInput,
  COMMON_SEGMENT,
  KEY_SEP,
  makeLocationItemKey,
  type PlannedSupplyResult
} from "@carbon/database/mrp-engine";
import {
  isPlannedOrderHeld,
  plannedOrderWeekIndex,
  planningTimeFenceDate,
  resolvePlanningTimeFenceDays,
  round,
  scrapAllowance
} from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { itemLocationSegmentKey } from "./open-supply-orders.ts";
import type {
  ChangeCandidate,
  OpenSupplyOrder,
  PlanningActionCandidate
} from "./planning-action-types.ts";
import {
  daysBetween,
  type PlanningPolicyRow,
  sizeRowSupply,
  supplyTarget
} from "./row-sizing.ts";

/**
 * One item's planning settings at one location: the base columns of a
 * planning RPC row (`item` ⋈ `itemReplenishment` ⋈ `itemPlanning`), as read.
 * The RPCs do not COALESCE the policy columns, so each may be null.
 */
export type PlanningPolicyInput = {
  itemId: string;
  locationId: string;
  /** `item.active` */
  active: boolean;
  /** `item.itemTrackingType` */
  itemTrackingType: Database["public"]["Enums"]["itemTrackingType"];
  /** `item.replenishmentSystem`: Make plans jobs, Buy and Buy and Make plan purchases. */
  replenishmentSystem: Database["public"]["Enums"]["itemReplenishmentSystem"];
  reorderingPolicy: Database["public"]["Enums"]["itemReorderingPolicy"];
  reorderPoint: number | null;
  reorderQuantity: number | null;
  minimumOrderQuantity: number | null;
  maximumOrderQuantity: number | null;
  orderMultiple: number | null;
  /** `itemReplenishment.lotSize` */
  lotSize: number | null;
  maximumInventoryQuantity: number | null;
  demandAccumulationPeriod: number | null;
  demandAccumulationSafetyStock: number | null;
  /** `itemReplenishment.leadTime`, in calendar days. */
  leadTime: number | null;
  /** `itemPlanning.planningTimeFenceDays`; null takes the location's. */
  planningTimeFenceDays: number | null;
};

/** A `plannedOrder` row with status Planned or Firm. */
export type ExistingPlannedOrder = {
  id: string;
  itemId: string;
  locationId: string;
  planningSegmentId: string;
  orderType: Database["public"]["Enums"]["plannedOrderType"];
  status: "Planned" | "Firm";
  quantity: number;
  scrapQuantity: number;
  dueDate: string;
  releaseDate: string;
  periodId: string;
  splitIndex: number;
  supplierId: string | null;
  /**
   * The trace MRP stored when it planned the order (`plannedOrder.
   * quantityTrace`); a held order's Order / Make names its policy from it.
   * Absent or null: no policy named.
   */
  quantityTrace?: Partial<
    Pick<PlannedOrderTrace, "policyName" | "triggerValues">
  > | null;
};

/** What `runMrp` loads for planned orders. Absent: MRP plans as in Phase 1. */
export type PlannedOrderInputs = {
  planningPolicies: PlanningPolicyInput[];
  /** `location.planningTimeFenceDays` by location id; absent is 0. */
  locationTimeFenceDays: ReadonlyMap<string, number>;
  /** `itemReplenishment.scrapPercentage` (a rate: 0.1 is 10%) by item id. */
  scrapRateByItem: ReadonlyMap<string, number>;
  /** The supplier a new Order names, as the purchasing RPC's `preferredSupplierId`. */
  preferredSupplierByItem: ReadonlyMap<string, string | null>;
  /** Open PO lines and jobs (`buildOpenSupplyOrders`), by `itemLocationSegmentKey`. */
  openSupplyOrders: ReadonlyMap<string, OpenSupplyOrder[]>;
  /** The company's `plannedOrder` rows with status Planned or Firm. */
  existingPlannedOrders: ExistingPlannedOrder[];
  /** `companySettings.rescheduleToleranceDays` */
  toleranceDays: number;
};

export type CreatePlanSupplyInputs = PlannedOrderInputs & {
  /** Today on the company's clock (YYYY-MM-DD). */
  todayDate: string;
  /** The engine's periods, in order. */
  periods: { id: string; startDate: string; endDate: string }[];
  /** Items with an `itemSupersession` row: they keep the Phase 1 path. */
  supersededItemIds: ReadonlySet<string>;
  /**
   * Made items that some BOM line builds as Make to Order. Their parent's job
   * spawns their subjob, so they get no planned order of their own and their
   * demand passes through to their children, as in Phase 1.
   */
  inlineProductionItemIds: ReadonlySet<string>;
  /** Each item's low-level code; absent is 0. */
  lowLevelCodeByItem?: ReadonlyMap<string, number>;
};

export type PlannedOrderTrace = {
  policyName: string | null;
  triggerValues: ChangeCandidate["triggerValues"];
  /** The lot-sized quantity. */
  quantity: number;
  scrapQuantity: number;
  /** What MRP explodes: `quantity + scrapQuantity` for Make, else 0. */
  explosionQuantity: number;
};

/** A planned order MRP generated in this run, not yet matched to a row. */
export type GeneratedPlannedOrder = {
  /** `plannedOrderNaturalKey` of the fields below. */
  naturalKey: string;
  itemId: string;
  locationId: string;
  planningSegmentId: string;
  orderType: "Make" | "Buy";
  quantity: number;
  scrapQuantity: number;
  dueDate: string;
  /** The day to release it: the due date less the lead time, fence-shifted. */
  releaseDate: string;
  /** The week it is due in. */
  periodId: string;
  /** Its index among this key's new orders of one type in one week. */
  splitIndex: number;
  lowLevelCode: number;
  supplierId: string | null;
  quantityTrace: PlannedOrderTrace;
};

/**
 * A new order the time fence moved. `expediteTo` is the date it is really
 * needed; the worklist raises an Expedite to it.
 */
export type PlannedOrderSignal = {
  naturalKey: string;
  expediteTo?: string;
};

/** A change action (Expedite, Defer, Decrease, Cancel) on a held planned order. */
export type PlannedOrderChangeAction = Omit<
  PlanningActionCandidate,
  "assignee"
>;

export type PlanSupplyResult = {
  plannedOrders: GeneratedPlannedOrder[];
  /**
   * The planned orders held this run: Firm, or Planned and released inside
   * the time fence, of an item MRP plans or no longer plans. They keep their
   * values; the writer must neither update nor delete them, and only they
   * get change actions.
   */
  heldPlannedOrderIds: string[];
  plannedOrderSignals: PlannedOrderSignal[];
  plannedOrderChangeActions: PlannedOrderChangeAction[];
  /**
   * The new supply of each planned key (`itemLocationSegmentKey`): every
   * Order / Make, and every Increase on an open order. A key the hook planned
   * is present even with an empty list; a key absent here keeps the Phase 1
   * path.
   *
   * An Order / Make stands for one planned order still to convert, and names
   * it: a new one by `plannedOrderKey` (dates fence-shifted; `runMrp` adds its
   * `plannedOrderId` once the write gave it one), a held one (Firm, or Planned
   * inside the fence) by `plannedOrderKey` and `plannedOrderId`, with its own
   * quantity and dates. A held order MRP cancels has none. The worklist sums
   * them per type and week into one action that names no planned order.
   */
  newSupplyByRow: Map<string, ChangeCandidate[]>;
};

type PlanSupplyArgs = Parameters<
  NonNullable<BomExplosionInput["planSupply"]>
>[0];

/** The natural key of a planned order; never joined with "-". */
export function plannedOrderNaturalKey(order: {
  itemId: string;
  locationId: string;
  planningSegmentId: string;
  orderType: string;
  periodId: string;
  splitIndex: number;
}): string {
  return [
    order.itemId,
    order.locationId,
    order.planningSegmentId,
    order.orderType,
    order.periodId,
    String(order.splitIndex)
  ].join(KEY_SEP);
}

/**
 * `newSupplyByRow` with each new Order / Make naming its planned order's id,
 * once the write gave the order one (`plannedOrderIdByKey`). A held order
 * already names its own id and keeps it: a Firm order may share a new
 * order's natural key.
 */
export function withPlannedOrderIds(
  newSupplyByRow: ReadonlyMap<string, ChangeCandidate[]>,
  plannedOrderIdByKey: ReadonlyMap<string, string>
): Map<string, ChangeCandidate[]> {
  return new Map(
    [...newSupplyByRow].map(([rowKey, supply]) => [
      rowKey,
      supply.map((candidate) => {
        if (candidate.plannedOrderId || !candidate.plannedOrderKey) {
          return candidate;
        }
        const plannedOrderId = plannedOrderIdByKey.get(
          candidate.plannedOrderKey
        );
        return plannedOrderId ? { ...candidate, plannedOrderId } : candidate;
      })
    ])
  );
}

/** A Buy or Buy and Make item plans purchases; a Make item plans jobs. */
function sizingKindOf(
  replenishmentSystem: string | null | undefined
): "Order" | "Make" | null {
  if (replenishmentSystem === "Make") return "Make";
  if (replenishmentSystem === "Buy" || replenishmentSystem === "Buy and Make") {
    return "Order";
  }
  return null;
}

/**
 * The policy as `deriveRowActions` reads an RPC row: `sizeRowSupply` turns
 * each null into 0, and a null accumulation period into 1.
 */
function policyRowOf(policy: PlanningPolicyInput): PlanningPolicyRow {
  return {
    reorderingPolicy: policy.reorderingPolicy,
    reorderPoint: Number(policy.reorderPoint) || 0,
    reorderQuantity: Number(policy.reorderQuantity) || 0,
    minimumOrderQuantity: Number(policy.minimumOrderQuantity) || 0,
    maximumOrderQuantity: Number(policy.maximumOrderQuantity) || 0,
    orderMultiple: Number(policy.orderMultiple) || 0,
    lotSize: Number(policy.lotSize) || 0,
    maximumInventoryQuantity: Number(policy.maximumInventoryQuantity) || 0,
    demandAccumulationPeriod: Number(policy.demandAccumulationPeriod) || 1,
    demandAccumulationSafetyStock:
      Number(policy.demandAccumulationSafetyStock) || 0,
    leadTime: Number(policy.leadTime) || 0
  };
}

/**
 * The RPCs' stock-driven row: a reorder point on Fixed Reorder Quantity or
 * Maximum Quantity gives the item a row with no demand and no supply.
 */
function hasBufferPolicy(policy: PlanningPolicyInput): boolean {
  return (
    (Number(policy.reorderPoint) || 0) > 0 &&
    (policy.reorderingPolicy === "Fixed Reorder Quantity" ||
      policy.reorderingPolicy === "Maximum Quantity")
  );
}

function addDays(dateIso: string, days: number): string {
  return parseDate(dateIso).add({ days }).toString();
}

export function createPlanSupply(inputs: CreatePlanSupplyInputs): {
  planSupply: (args: PlanSupplyArgs) => PlannedSupplyResult | null;
  extraPlanningKeys: string[];
  result: () => PlanSupplyResult;
} {
  const { periods, todayDate } = inputs;
  const sizingPeriods = periods.map((p) => ({
    id: p.id,
    startDate: p.startDate
  }));
  const periodIndexById = new Map(periods.map((p, i) => [p.id, i]));

  // The last week that starts on or before the date; the first week for an
  // earlier date, the last for a later one.
  const periodIndexOn = (dateIso: string): number => {
    let index = 0;
    for (const [i, period] of periods.entries()) {
      if (daysBetween(period.startDate, dateIso) <= 0) index = i;
      else break;
    }
    return index;
  };
  // The week a planned order counts in: an overdue order in the first week,
  // one past the last week in none. One rule with the drawer and convert.
  const weekIndexOf = (dueDate: string): number | null =>
    plannedOrderWeekIndex(dueDate, periods, todayDate);

  const policyByKey = new Map<string, PlanningPolicyInput>();
  for (const policy of inputs.planningPolicies) {
    policyByKey.set(
      makeLocationItemKey(policy.locationId, policy.itemId),
      policy
    );
  }

  // The planning row's kind, or null when the worklist has no row that sizes
  // new supply for the key (the RPCs' base_items filters).
  const eligibleOf = (locationId: string, itemId: string) => {
    if (inputs.supersededItemIds.has(itemId)) return null;
    if (inputs.inlineProductionItemIds.has(itemId)) return null;
    const policy = policyByKey.get(makeLocationItemKey(locationId, itemId));
    if (!policy || !policy.active) return null;
    if (policy.itemTrackingType === "Non-Inventory") return null;
    const kind = sizingKindOf(policy.replenishmentSystem);
    if (!kind) return null;
    return { policy, kind };
  };

  // The item's fence, else the location's. An item with no planning row at
  // the location has only the location's.
  const fenceDaysAt = (locationId: string, itemId: string): number =>
    resolvePlanningTimeFenceDays(
      policyByKey.get(makeLocationItemKey(locationId, itemId))
        ?.planningTimeFenceDays,
      inputs.locationTimeFenceDays.get(locationId)
    );
  const fenceDaysOf = (policy: PlanningPolicyInput): number =>
    fenceDaysAt(policy.locationId, policy.itemId);

  // Held orders: Firm, or Planned and released inside the fence. They keep
  // their quantity and dates and count as supply.
  const heldByKey = new Map<string, ExistingPlannedOrder[]>();
  // Held orders of an item MRP no longer plans (deactivated, superseded,
  // built as Make to Order, no planning row): kept, never supply, never
  // exploded, each with a Cancel for a person to decide. Deleting a Firm or
  // fence-held order silently would undo a planner's decision.
  const ineligibleHeld: ExistingPlannedOrder[] = [];
  for (const order of inputs.existingPlannedOrders) {
    if ((order.planningSegmentId || COMMON_SEGMENT) !== COMMON_SEGMENT) {
      continue;
    }
    const eligible = eligibleOf(order.locationId, order.itemId);
    if (!eligible) {
      const fenceDays = fenceDaysAt(order.locationId, order.itemId);
      if (isPlannedOrderHeld(order, fenceDays, todayDate)) {
        ineligibleHeld.push(order);
      }
      continue;
    }
    if (!isPlannedOrderHeld(order, fenceDaysOf(eligible.policy), todayDate)) {
      continue;
    }
    const key = makeLocationItemKey(order.locationId, order.itemId);
    const list = heldByKey.get(key) ?? [];
    list.push(order);
    heldByKey.set(key, list);
  }

  const extraPlanningKeys = new Set<string>();
  for (const [key, policy] of policyByKey) {
    if (!eligibleOf(policy.locationId, policy.itemId)) continue;
    if (hasBufferPolicy(policy)) extraPlanningKeys.add(key);
  }
  // A held order with no demand still explodes, and gets its Cancel.
  for (const key of heldByKey.keys()) extraPlanningKeys.add(key);

  const plannedOrders: GeneratedPlannedOrder[] = [];
  const plannedOrderSignals: PlannedOrderSignal[] = [];
  const plannedOrderChangeActions: PlannedOrderChangeAction[] =
    ineligibleHeld.map((order) => ({
      itemId: order.itemId,
      locationId: order.locationId,
      planningSegmentId: COMMON_SEGMENT,
      type: "Cancel",
      periodId: periods[periodIndexOn(order.dueDate)]?.id ?? order.periodId,
      suggestedQuantity: order.quantity,
      suggestedDate: order.dueDate,
      horizonDate: order.dueDate,
      latestOrderDate: null,
      isASAP: false,
      purchaseOrderLineId: null,
      jobId: null,
      plannedOrderId: order.id,
      requiresManualAction: false,
      supplierId: order.orderType === "Buy" ? order.supplierId : null,
      policyName: null,
      reason: "Item is no longer planned by MRP",
      triggerValues: null
    }));
  const newSupplyByRow = new Map<string, ChangeCandidate[]>();

  const planSupply = (args: PlanSupplyArgs): PlannedSupplyResult | null => {
    const { locationId, itemId } = args;
    if (args.segmentId !== COMMON_SEGMENT) return null;
    const eligible = eligibleOf(locationId, itemId);
    if (!eligible) return null;
    const { policy, kind } = eligible;
    const orderType = kind === "Make" ? "Make" : "Buy";
    const policyRow = policyRowOf(policy);
    const leadTime = policyRow.leadTime;
    const scrapRate = inputs.scrapRateByItem.get(itemId) ?? 0;
    const explosionOf = (quantity: number) =>
      quantity + scrapAllowance(quantity, scrapRate);
    const fenceDays = fenceDaysOf(policy);
    const fenceDate = planningTimeFenceDate(todayDate, fenceDays);
    const rowKey = itemLocationSegmentKey(itemId, locationId);
    const held = heldByKey.get(makeLocationItemKey(locationId, itemId)) ?? [];

    // ── the projection, as the RPC's week columns: on-hand plus supply (open
    // orders and held planned orders) less gross demand, cumulative, not
    // floored
    const heldSupply = periods.map(() => 0);
    for (const order of held) {
      const index = weekIndexOf(order.dueDate);
      if (index === null) continue;
      heldSupply[index] = (heldSupply[index] ?? 0) + order.quantity;
    }
    let balance = args.onHand;
    const projections = periods.map((_, i) => {
      balance +=
        (args.supplyByPeriod[i] ?? 0) +
        (heldSupply[i] ?? 0) -
        (args.grossByPeriod[i] ?? 0);
      return balance;
    });
    const demandByPeriod = new Map<string, number>();
    for (const [i, period] of periods.entries()) {
      const gross = args.grossByPeriod[i] ?? 0;
      if (gross > 0) demandByPeriod.set(period.id, gross);
    }

    const heldOpenOrders: OpenSupplyOrder[] = held.map((order) => ({
      plannedOrderId: order.id,
      orderType: order.orderType === "Make" ? "Make" : "Buy",
      quantity: order.quantity,
      dueDate: order.dueDate,
      requiresManualAction: false,
      supplierId: order.supplierId,
      release: null
    }));
    const openOrders = [
      ...(inputs.openSupplyOrders.get(rowKey) ?? []),
      ...heldOpenOrders
    ];

    const { changeActions, newSupply } = sizeRowSupply({
      kind,
      isProjectSegment: false,
      supersessionMode: null,
      quantityToOrder: 0,
      minimumReserveQuantity: 0,
      quantityOnHand: args.onHand,
      onHand: args.onHand,
      draws: [],
      periods: sizingPeriods,
      projections,
      demandByPeriod,
      openOrders,
      policy: policyRow,
      preferredSupplierId: inputs.preferredSupplierByItem.get(itemId) ?? null,
      toleranceDays: inputs.toleranceDays,
      todayDate
    });

    for (const action of changeActions) {
      if (!action.plannedOrderId) continue;
      plannedOrderChangeActions.push({
        ...action,
        itemId,
        locationId,
        planningSegmentId: COMMON_SEGMENT
      });
    }

    // ── the time fence: a new order that would start inside it starts at
    // its end instead, its due date moved by the same days
    const fencedFrom = new Map<ChangeCandidate, ChangeCandidate>();
    const shifted = newSupply.map((candidate) => {
      if (!isNewOrder(candidate) || fenceDays <= 0) return candidate;
      const startDate = candidate.latestOrderDate ?? candidate.suggestedDate;
      const days = daysBetween(fenceDate, startDate);
      if (days <= 0) return candidate;
      const dueDate = addDays(candidate.suggestedDate, days);
      const moved: ChangeCandidate = {
        ...candidate,
        periodId: periods[periodIndexOn(dueDate)]?.id ?? candidate.periodId,
        suggestedDate: dueDate,
        horizonDate: dueDate,
        latestOrderDate: fenceDate,
        isASAP: false
      };
      fencedFrom.set(moved, candidate);
      return moved;
    });

    // ── split index: per week and type, by due date then quantity, skipping
    // the indexes of held Planned rows (their natural keys stay theirs)
    const takenSplits = new Set(
      held
        .filter(
          (order) => order.status === "Planned" && order.orderType === orderType
        )
        .map((order) => order.periodId + KEY_SEP + order.splitIndex)
    );
    const newOrders = shifted.filter(isNewOrder);
    const ordered = [...newOrders].sort(
      (a, b) =>
        daysBetween(a.suggestedDate, b.suggestedDate) ||
        a.suggestedQuantity - b.suggestedQuantity
    );
    const splitIndexOf = new Map<ChangeCandidate, number>();
    const nextSplit = new Map<string, number>();
    for (const candidate of ordered) {
      let index = nextSplit.get(candidate.periodId) ?? 0;
      while (takenSplits.has(candidate.periodId + KEY_SEP + index)) index++;
      splitIndexOf.set(candidate, index);
      nextSplit.set(candidate.periodId, index + 1);
    }

    const explosions: PlannedSupplyResult["explosions"] = [];
    const lowLevelCode = inputs.lowLevelCodeByItem?.get(itemId) ?? 0;

    const rowSupply = shifted.map((candidate) => {
      if (!isNewOrder(candidate)) return candidate;
      const splitIndex = splitIndexOf.get(candidate) ?? 0;
      const naturalKey = plannedOrderNaturalKey({
        itemId,
        locationId,
        planningSegmentId: COMMON_SEGMENT,
        orderType,
        periodId: candidate.periodId,
        splitIndex
      });
      const quantity = round(candidate.suggestedQuantity);
      // A purchase carries no scrap; a job makes its scrap on top.
      const scrapQuantity =
        orderType === "Make" ? scrapAllowance(quantity, scrapRate) : 0;
      const explosionQuantity =
        orderType === "Make" ? quantity + scrapQuantity : 0;
      const releaseDate = candidate.latestOrderDate ?? candidate.suggestedDate;
      plannedOrders.push({
        naturalKey,
        itemId,
        locationId,
        planningSegmentId: COMMON_SEGMENT,
        orderType,
        quantity,
        scrapQuantity,
        dueDate: candidate.suggestedDate,
        releaseDate,
        periodId: candidate.periodId,
        splitIndex,
        lowLevelCode,
        supplierId: candidate.supplierId,
        quantityTrace: {
          policyName: candidate.policyName,
          triggerValues: candidate.triggerValues,
          quantity,
          scrapQuantity,
          explosionQuantity
        }
      });
      const unfenced = fencedFrom.get(candidate);
      if (unfenced) {
        plannedOrderSignals.push({
          naturalKey,
          expediteTo: unfenced.suggestedDate
        });
      }
      if (orderType === "Make") {
        explosions.push({
          releasePeriodIndex: periodIndexOn(releaseDate),
          quantity: explosionQuantity,
          // the demand it was sized for, before the fence moved it
          contributorPeriodIndex:
            periodIndexById.get((unfenced ?? candidate).periodId) ?? 0
        });
      }
      return { ...candidate, plannedOrderKey: naturalKey };
    });

    // ── held orders still to convert: each is part of its week's Order /
    // Make, so applying that action converts it. Its quantity and dates are
    // its own; sizing already counted it as supply, so it adds no order. A
    // held order MRP cancels is not offered for conversion.
    const cancelledIds = new Set(
      changeActions
        .filter((action) => action.type === "Cancel")
        .map((action) => action.plannedOrderId)
    );
    const heldOrderSupply: ChangeCandidate[] = [];
    for (const order of held) {
      if (cancelledIds.has(order.id)) continue;
      if (order.orderType !== "Make" && order.orderType !== "Buy") continue;
      // the week it lands in as supply; past the horizon it is not supply
      const index = weekIndexOf(order.dueDate);
      const period = index === null ? undefined : periods[index];
      if (!period) continue;
      heldOrderSupply.push({
        type: order.orderType === "Make" ? "Make" : "Order",
        periodId: period.id,
        suggestedQuantity: order.quantity,
        suggestedDate: order.dueDate,
        horizonDate: order.dueDate,
        latestOrderDate: order.releaseDate,
        isASAP: daysBetween(order.releaseDate, todayDate) < 0,
        purchaseOrderLineId: null,
        jobId: null,
        plannedOrderId: order.id,
        plannedOrderKey: plannedOrderNaturalKey(order),
        requiresManualAction: false,
        supplierId: order.orderType === "Buy" ? order.supplierId : null,
        policyName: order.quantityTrace?.policyName ?? null,
        reason: null,
        triggerValues: order.quantityTrace?.triggerValues ?? null
      });
    }
    newSupplyByRow.set(rowKey, [...rowSupply, ...heldOrderSupply]);

    if (kind !== "Make") return { explosions: [] };

    // A held Make order is still made: its components are needed. One past
    // the horizon is not supply this run, so nothing needs its components
    // yet either.
    for (const order of held) {
      if (order.orderType !== "Make") continue;
      if (weekIndexOf(order.dueDate) === null) continue;
      explosions.push({
        releasePeriodIndex: periodIndexOn(order.releaseDate),
        quantity: order.quantity + order.scrapQuantity,
        contributorPeriodIndex: periodIndexOn(order.dueDate)
      });
    }

    // An Increase on a job or a Make planned order needs components for the
    // extra quantity, from the order's start.
    for (const candidate of rowSupply) {
      if (candidate.type !== "Increase") continue;
      const target = supplyTarget(candidate);
      const order = openOrders.find((o) => supplyTarget(o) === target);
      if (!order) continue;
      const isMakeOrder = order.plannedOrderId
        ? order.orderType === "Make"
        : Boolean(order.jobId);
      if (!isMakeOrder) continue;
      const heldOrder = order.plannedOrderId
        ? held.find((h) => h.id === order.plannedOrderId)
        : undefined;
      const before = heldOrder
        ? heldOrder.quantity + heldOrder.scrapQuantity
        : explosionOf(order.quantity);
      const delta = explosionOf(candidate.suggestedQuantity) - before;
      if (delta <= 0) continue;
      explosions.push({
        releasePeriodIndex: periodIndexOn(addDays(order.dueDate, -leadTime)),
        quantity: delta,
        contributorPeriodIndex: periodIndexById.get(candidate.periodId) ?? 0
      });
    }

    return { explosions };
  };

  return {
    planSupply,
    extraPlanningKeys: [...extraPlanningKeys],
    result: () => ({
      plannedOrders,
      heldPlannedOrderIds: [
        ...[...heldByKey.values()].flat(),
        ...ineligibleHeld
      ].map((order) => order.id),
      plannedOrderSignals,
      plannedOrderChangeActions,
      newSupplyByRow
    })
  };
}

/** A new Order or Make from the sizing: new supply with no order behind it. */
function isNewOrder(candidate: ChangeCandidate): boolean {
  return (
    (candidate.type === "Order" || candidate.type === "Make") &&
    !supplyTarget(candidate)
  );
}
