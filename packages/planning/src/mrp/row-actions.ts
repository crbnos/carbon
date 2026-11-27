// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// One planning row's actions (pure): the change actions on its open orders,
// its new supply, the releases of its planned documents and, in a project
// segment, its Transfers; and the actions MRP v2 raises on planned orders.
//
// Change actions follow the SAP "rescheduling check on a firmed receipt" model:
// open orders are matched to dated requirements chronologically; a date gap
// STRICTLY greater than companySettings.rescheduleToleranceDays fires
// Expedite/Defer; exactly ONE action is emitted per target document
// (Cancel → Expedite/Defer → Increase/Decrease).

import type { Database } from "@carbon/database";
import { COMMON_SEGMENT, KEY_SEP } from "@carbon/database/mrp-engine";
import { round } from "@carbon/utils";
import type {
  PlannedOrderChangeAction,
  PlannedOrderSignal
} from "./planned-orders.ts";
import type {
  ChangeCandidate,
  OpenSupplyOrder,
  PlanningActionCandidate,
  PlanningActionType
} from "./planning-action-types.ts";
import {
  daysBetween,
  drawsByPeriod,
  earlierDate,
  laterDate,
  planningPolicyRowOf,
  sizeRowSupply,
  supplyTarget,
  weekIndexOn
} from "./row-sizing.ts";

/**
 * A Release is raised this many days before its release day, not earlier.
 * Every planned order has one, so raised the moment the order exists it is a
 * standing row weeks ahead of anything anyone can do about it.
 */
const RELEASE_NOTICE_DAYS = 1;

/**
 * One Release per planned order (`OpenSupplyOrder.release`), dated the last
 * day to release it, raised only from `RELEASE_NOTICE_DAYS` before that day.
 * Released from the order itself — the planning pages link to it — so it is
 * never applied. An order MRP would Cancel gets none, and so does a planned
 * order: MRP converts it, nobody releases it.
 */
export function deriveReleaseActions(args: {
  openOrders: OpenSupplyOrder[];
  changeActions: Pick<
    ChangeCandidate,
    "type" | "purchaseOrderLineId" | "jobId" | "plannedOrderId"
  >[];
  periods: { id: string; startDate: string }[];
  todayDate: string;
}): ChangeCandidate[] {
  const { openOrders, changeActions, periods, todayDate } = args;
  const cancelled = new Set(
    changeActions.filter((a) => a.type === "Cancel").map((a) => supplyTarget(a))
  );
  // the week a date falls in; an earlier date is the first week
  const periodFor = (dateIso: string) => periods[weekIndexOn(periods, dateIso)];

  const actions: ChangeCandidate[] = [];
  for (const order of openOrders) {
    const release = order.release;
    if (!release || order.plannedOrderId) continue;
    // not yet: the run on the day before raises it
    if (daysBetween(release.date, todayDate) > RELEASE_NOTICE_DAYS) continue;
    if (cancelled.has(supplyTarget(order))) {
      continue;
    }
    const period = periodFor(release.date);
    if (!period) continue;
    actions.push({
      type: "Release",
      periodId: period.id,
      suggestedQuantity: order.quantity,
      suggestedDate: release.date,
      horizonDate: release.date,
      // the latest-order-date column is for new supply, not this
      latestOrderDate: null,
      // its day has come (or gone): release it now
      isASAP: daysBetween(release.date, todayDate) <= 0,
      purchaseOrderLineId: order.purchaseOrderLineId ?? null,
      jobId: order.jobId ?? null,
      plannedOrderId: null,
      requiresManualAction: false,
      supplierId: order.supplierId ?? null,
      policyName: null,
      reason: `Due ${release.dueDate} with a ${release.leadTime}-day lead time`,
      triggerValues: { leadTime: release.leadTime }
    });
  }
  return actions;
}

export type RpcPlanningRow =
  Database["public"]["Functions"]["get_purchasing_planning"]["Returns"][number];
export type ProductionPlanningRow =
  Database["public"]["Functions"]["get_production_planning"]["Returns"][number];

const TRANSFER_REASON = "Common stock not needed within the horizon";

export type DeriveRowActionsInput = {
  /** One planning RPC row: one item in one segment at the location. */
  row: RpcPlanningRow | ProductionPlanningRow;
  kind: "Order" | "Make";
  /** This run's weeks, current first. */
  periods: { id: string; startDate: string }[];
  /** Demand of the item in the row's segment, by period id. */
  demandByPeriod: Map<string, number>;
  /** Open PO lines or jobs of the item in the row's segment. */
  openOrders: OpenSupplyOrder[];
  /** On-hand of the item in the row's segment. */
  onHand: number;
  /** What the row's segment takes from common stock, per period. */
  draws: { periodId: string; quantity: number }[];
  toleranceDays: number;
  todayDate: string;
  /**
   * MRP v2: the row as the engine sized it with planned orders. When set it
   * replaces the sizing of the RPC row, whose projection has no planned
   * order in it (it would Expedite a job a Firm order already covers).
   */
  engine?: {
    /**
     * Each new Order / Make and each Increase (`planCompany`'s
     * `newSupplyByRow`).
     */
    supply: ChangeCandidate[];
    /**
     * The change actions on the row's open jobs and PO lines, with the held
     * planned orders as supply (`planCompany`'s `documentChangeActionsByRow`).
     */
    changeActions: ChangeCandidate[];
  };
};

/**
 * Every action for one planning row: the change actions on its open orders,
 * the new supply its projection needs, the releases of its planned orders,
 * and, in a project segment, a Transfer per period that draws common stock.
 *
 * A project segment is lot-for-lot: no reorder point, safety stock or Stock
 * Only reserve. A draw counts as the segment's own stock from its period on,
 * so the segment's Order or Make covers only the remainder.
 *
 * An open Project Borrow is firm: MRP books it as demand on the borrower and
 * supply on the lender, in the row's projection, but it is never one of
 * `openOrders`, so no change action (Expedite, Defer, Cancel, Increase,
 * Decrease) ever targets it. An overdue borrow is an exception the planning
 * worklist and the project header show instead.
 */
export function deriveRowActions(
  input: DeriveRowActionsInput
): ChangeCandidate[] {
  const { row, periods, openOrders, todayDate } = input;
  const segmentId = row.planningSegmentId || COMMON_SEGMENT;
  const isProjectSegment = segmentId !== COMMON_SEGMENT;

  const drawByPeriod = drawsByPeriod(isProjectSegment ? input.draws : []);

  // A row the engine planned takes its change actions and its new supply
  // from the engine's one sizing; any other row is sized from the RPC row.
  const { changeActions, merged } = input.engine
    ? {
        changeActions: input.engine.changeActions,
        merged: engineNewSupply(input.engine.supply, input.engine.changeActions)
      }
    : rpcRowSizing(input, isProjectSegment);

  // Lot-size splitting can emit several new-supply suggestions in one
  // period; persist ONE action per (type, period) with the summed quantity
  // — the natural key would otherwise collide and silently drop batches.
  // The planning pages split the action back into the orders its policy
  // sized (`splitIntoOrders`): a batch, a fixed reorder quantity, a
  // maximum order quantity each.
  const aggregated = new Map<string, ChangeCandidate>();
  const passthrough: ChangeCandidate[] = [];
  for (const candidate of merged) {
    const isNewSupply =
      (candidate.type === "Order" || candidate.type === "Make") &&
      !supplyTarget(candidate);
    if (!isNewSupply) {
      passthrough.push(candidate);
      continue;
    }
    const key = `${candidate.type}${KEY_SEP}${candidate.periodId}`;
    const current = aggregated.get(key);
    if (current) {
      current.suggestedQuantity += candidate.suggestedQuantity;
      current.isASAP = current.isASAP || candidate.isASAP;
      current.suggestedDate = earlierDate(
        current.suggestedDate,
        candidate.suggestedDate
      );
      current.horizonDate = earlierDate(
        current.horizonDate,
        candidate.horizonDate
      );
      if (candidate.latestOrderDate) {
        current.latestOrderDate = current.latestOrderDate
          ? earlierDate(current.latestOrderDate, candidate.latestOrderDate)
          : candidate.latestOrderDate;
      }
    } else {
      aggregated.set(key, { ...candidate });
    }
  }

  const releaseActions = deriveReleaseActions({
    openOrders,
    changeActions,
    periods,
    todayDate
  });

  // One Transfer per period a draw lands in: common stock into the project.
  const transfers: ChangeCandidate[] = [];
  for (const period of periods) {
    const quantity = drawByPeriod.get(period.id) ?? 0;
    if (quantity <= 0) continue;
    transfers.push({
      type: "Transfer",
      periodId: period.id,
      suggestedQuantity: quantity,
      suggestedDate: period.startDate,
      horizonDate: period.startDate,
      latestOrderDate: null,
      isASAP: daysBetween(period.startDate, todayDate) < 0,
      purchaseOrderLineId: null,
      jobId: null,
      plannedOrderId: null,
      requiresManualAction: false,
      supplierId: null,
      policyName: null,
      reason: TRANSFER_REASON,
      triggerValues: null,
      fromProjectId: null,
      toProjectId: segmentId
    });
  }

  return [
    ...aggregated.values(),
    ...passthrough,
    ...changeActions,
    ...releaseActions,
    ...transfers
  ].map((action) => ({ ...action, planningSegmentId: segmentId }));
}

/** The sizing of a row the engine did not plan, from its RPC row. */
function rpcRowSizing(
  input: DeriveRowActionsInput,
  isProjectSegment: boolean
): { changeActions: ChangeCandidate[]; merged: ChangeCandidate[] } {
  const { row, periods } = input;
  const { changeActions, newSupply } = sizeRowSupply({
    kind: input.kind,
    isProjectSegment,
    supersessionMode: row.supersessionMode,
    quantityToOrder: row.quantityToOrder,
    minimumReserveQuantity: row.minimumReserveQuantity,
    quantityOnHand: row.quantityOnHand,
    onHand: input.onHand,
    draws: input.draws,
    periods,
    projections: periods.map(
      (_, i) => Number(row[`week${i + 1}` as keyof typeof row]) || 0
    ),
    demandByPeriod: input.demandByPeriod,
    openOrders: input.openOrders,
    policy: planningPolicyRowOf(row),
    preferredSupplierId: (row as RpcPlanningRow).preferredSupplierId ?? null,
    toleranceDays: input.toleranceDays,
    todayDate: input.todayDate
  });
  return { changeActions, merged: newSupply };
}

/**
 * The engine's new supply for a row, as actions. Each engine Order or Make is
 * one planned order (new or held); the action stands for every planned order
 * of its week, so it names none (`plannedOrderKey` and `plannedOrderId` are
 * dropped) and `deriveRowActions` sums the week's orders into it. One action
 * per order: an Increase on an order that a change action of the row already
 * targets is left out, as `convertOrdersToIncreases` leaves it out when it
 * sizes the row itself.
 */
function engineNewSupply(
  engineSupply: ChangeCandidate[],
  changeActions: ChangeCandidate[]
): ChangeCandidate[] {
  const targeted = new Set(changeActions.map((a) => supplyTarget(a) ?? ""));
  return engineSupply.flatMap(({ plannedOrderKey: _key, ...candidate }) => {
    if (candidate.type === "Order" || candidate.type === "Make") {
      return [{ ...candidate, plannedOrderId: null }];
    }
    const target = supplyTarget(candidate);
    if (target && targeted.has(target)) return [];
    return [candidate];
  });
}

/** Which action wins on one order: Cancel, then a date, then a quantity. */
const CHANGE_PRECEDENCE: Partial<Record<PlanningActionType, number>> = {
  Cancel: 0,
  Expedite: 1,
  Defer: 1,
  Increase: 2,
  Decrease: 2
};

/**
 * MRP v2: the actions on planned orders that no planning row carries. They
 * are raised whether or not the item has a planning RPC row this run (a
 * held planned order with no demand left gets its Cancel).
 *
 * 1. Each change action the engine raised on a held planned order
 *    (Expedite, Defer, Decrease, Cancel). Only a held order gets one. The
 *    engine plans past the worklist's last week; an action in a later week
 *    goes in the last week, with its own date, so a person still sees it.
 * 2. An Expedite for each new planned order the time fence moved, to the
 *    date it is needed (`expediteTo`; never before today, as
 *    `deriveChangeActions` dates a need). Its quantity is the order's.
 *
 * Each planned order gets one action: the precedence of
 * `deriveChangeActions` (Cancel, then Expedite / Defer, then Increase /
 * Decrease) decides.
 */
export function plannedOrderActions(args: {
  changeActions: PlannedOrderChangeAction[];
  signals: PlannedOrderSignal[];
  /** `planCompany`'s `newSupplyByRow`: the signalled orders' quantities. */
  newSupplyByRow: ReadonlyMap<string, ChangeCandidate[]>;
  /** `plannedOrderNaturalKey` -> `plannedOrder.id`, as written this run. */
  plannedOrderIdByKey: ReadonlyMap<string, string>;
  /** The planned orders held this run. */
  heldPlannedOrderIds: ReadonlySet<string>;
  periods: { id: string; startDate: string }[];
  todayDate: string;
}): Omit<PlanningActionCandidate, "assignee">[] {
  const { periods, todayDate } = args;
  const periodFor = (dateIso: string) => periods[weekIndexOn(periods, dateIso)];

  const periodIds = new Set(periods.map((p) => p.id));
  const lastPeriodId = periods.at(-1)?.id;
  const actions: Omit<PlanningActionCandidate, "assignee">[] = [];
  for (const action of args.changeActions) {
    if (!action.plannedOrderId) continue;
    if (!args.heldPlannedOrderIds.has(action.plannedOrderId)) continue;
    const periodId =
      periodIds.has(action.periodId) || !lastPeriodId
        ? action.periodId
        : lastPeriodId;
    actions.push({ ...action, periodId, requiresManualAction: false });
  }

  // The new orders by natural key. A held Firm order may share a new order's
  // natural key (only Planned rows are unique on it); it names its own id.
  const orderByKey = new Map<string, ChangeCandidate>();
  for (const supply of args.newSupplyByRow.values()) {
    for (const candidate of supply) {
      const key = candidate.plannedOrderKey;
      if (!key) continue;
      if (
        candidate.plannedOrderId &&
        candidate.plannedOrderId !== args.plannedOrderIdByKey.get(key)
      ) {
        continue;
      }
      orderByKey.set(key, candidate);
    }
  }
  for (const signal of args.signals) {
    if (!signal.expediteTo) continue;
    const plannedOrderId = args.plannedOrderIdByKey.get(signal.naturalKey);
    const order = orderByKey.get(signal.naturalKey);
    const period = periodFor(signal.expediteTo);
    if (!plannedOrderId || !order || !period) continue;
    const [itemId, locationId, planningSegmentId] =
      signal.naturalKey.split(KEY_SEP);
    if (!itemId || !locationId) continue;
    const suggestedDate = laterDate(signal.expediteTo, todayDate);
    actions.push({
      itemId,
      locationId,
      planningSegmentId: planningSegmentId ?? COMMON_SEGMENT,
      type: "Expedite",
      periodId: period.id,
      suggestedQuantity: round(order.suggestedQuantity),
      suggestedDate,
      horizonDate: earlierDate(order.suggestedDate, suggestedDate),
      latestOrderDate: null,
      isASAP: daysBetween(signal.expediteTo, todayDate) < 0,
      purchaseOrderLineId: null,
      jobId: null,
      plannedOrderId,
      requiresManualAction: false,
      supplierId: order.supplierId,
      policyName: null,
      reason: `Needed ${daysBetween(order.suggestedDate, suggestedDate)} days earlier than the planning time fence allows`,
      triggerValues: null
    });
  }
  return actions;
}

/**
 * One action per planned order across all of a run's candidates, by
 * `CHANGE_PRECEDENCE`; the first of equal rank stays. Candidates on no
 * planned order pass through.
 */
export function onePerPlannedOrder<
  T extends Pick<PlanningActionCandidate, "type" | "plannedOrderId">
>(candidates: T[]): T[] {
  const best = new Map<string, T>();
  for (const candidate of candidates) {
    if (!candidate.plannedOrderId) continue;
    const current = best.get(candidate.plannedOrderId);
    const rank = CHANGE_PRECEDENCE[candidate.type] ?? 3;
    const currentRank = current ? (CHANGE_PRECEDENCE[current.type] ?? 3) : 4;
    if (rank < currentRank) best.set(candidate.plannedOrderId, candidate);
  }
  return candidates.filter(
    (candidate) =>
      !candidate.plannedOrderId ||
      best.get(candidate.plannedOrderId) === candidate
  );
}
