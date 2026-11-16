// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// How one item's supply is sized in one netting segment: the coverage walk
// over its open orders, the change actions on them (Expedite, Defer, Cancel,
// Increase, Decrease), and the new supply (Order / Make) its projection needs.
// Pure: no I/O. The planning worklist (`deriveRowActions`) calls
// `sizeRowSupply` with a planning RPC row; the MRP engine can call it with
// inputs it builds itself, and gets the same sizing.

import {
  computePlanningOrders,
  orderSizingRules,
  RoundingMode,
  reducedOrderQuantity,
  round
} from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import type {
  ChangeCandidate,
  OpenSupplyOrder
} from "./planning-action-types.ts";

/** Planning periods are weeks. */
export const DAYS_PER_PERIOD = 7;

/** Signed day difference a − b for two ISO calendar dates. */
export function daysBetween(a: string, b: string): number {
  return parseDate(a).compare(parseDate(b));
}

/** The earlier of two ISO calendar dates. */
export function earlierDate(a: string, b: string): string {
  return daysBetween(a, b) <= 0 ? a : b;
}

/** The later of two ISO calendar dates. */
export function laterDate(a: string, b: string): string {
  return daysBetween(a, b) >= 0 ? a : b;
}

/**
 * The quantity an order holds once a change to `quantity` is applied. Apply
 * writes a PO line in whole PURCHASE units — `round(suggested /
 * conversionFactor, 0, Up)` — so a suggestion between two multiples was
 * rounded up on the line, read as over-supply by the next run, and suggested
 * again: forever. A suggested quantity is therefore what the line will
 * actually hold. A job's quantity is written as suggested.
 */
export function quantityAfterApply(
  order: Pick<OpenSupplyOrder, "purchaseOrderLineId" | "conversionFactor">,
  quantity: number
): number {
  if (!order.purchaseOrderLineId) return quantity;
  const factor =
    order.conversionFactor && order.conversionFactor > 0
      ? order.conversionFactor
      : 1;
  // Strip float noise before the ceil: 1.1 / 0.1 is 11.000000000000002,
  // which would otherwise ceil a whole purchase unit up to the next one.
  const purchaseUnits = round(round(quantity / factor), 0, RoundingMode.Up);
  return round(purchaseUnits * factor);
}

/**
 * The order an open order or a change action targets: its PO line, its job
 * or its planned order. Null for new supply, which has no order yet.
 */
export function supplyTarget(order: {
  purchaseOrderLineId?: string | null;
  jobId?: string | null;
  plannedOrderId?: string | null;
}): string | null {
  return (
    order.purchaseOrderLineId ?? order.jobId ?? order.plannedOrderId ?? null
  );
}

export type DeriveChangeActionsInput = {
  onHand: number;
  /** total demand per period, chronological */
  demandPeriods: { periodId: string; startDate: string; quantity: number }[];
  openOrders: OpenSupplyOrder[];
  /** all planning periods, chronological (for mapping a date to a period) */
  periods: { id: string; startDate: string }[];
  /**
   * The reorder policy's terminal stock target (safety stock / reorder point).
   * The floor is needed now, so it is claimed first: from on-hand, then the
   * earliest orders. An order holding part of it is never Cancelled, Decreased
   * or Deferred. The floor has no date of its own and never Expedites an order
   * (a reorder point is a trigger to order, not a date stock is due), but
   * demand that on-hand no longer covers once the floor is held can.
   */
  policyFloor: number;
  toleranceDays: number;
  todayDate: string;
  /**
   * How the item's policy sizes one order (`orderSizingRules`). A Decrease
   * never takes an order below its minimum or off a whole multiple — a Fixed
   * Reorder Quantity order stays a multiple of that quantity. Absent: none.
   */
  orderRules?: Pick<
    ReturnType<typeof orderSizingRules>,
    "minimum" | "multiples"
  >;
  /**
   * The item's lead time in days. An order whose latest start (due date less
   * lead time) has passed is frozen (`isOrderFrozen`): it gets no Expedite,
   * Increase or Decrease. Absent: 0 — only an overdue order is frozen.
   */
  leadTimeDays?: number;
};

/**
 * An order nothing can change in time: its due date less the item's lead
 * time is before today — every overdue order, and one due sooner than a
 * lead time away. It is already being made or shipped, so an Expedite,
 * Increase or Decrease on it cannot be carried out; a shortfall it cannot
 * cover becomes new supply instead. (An Increase on an overdue job sat beside
 * a Make for the same week, and the planner read the two as ordering twice.)
 *
 * A planned order is never frozen: no document exists, nothing is being made
 * or shipped, and planning changes it directly.
 */
export function isOrderFrozen(
  order: Pick<OpenSupplyOrder, "dueDate" | "plannedOrderId">,
  todayDate: string,
  leadTimeDays = 0
): boolean {
  if (order.plannedOrderId) return false;
  return daysBetween(order.dueDate, todayDate) < Math.max(leadTimeDays, 0);
}

/**
 * Days an order lands after it is first needed (negative: before). Both dates
 * count from today at the earliest: an overdue order arrives today, and a need
 * in the current week is needed today, not on the week's start.
 */
function daysLate(
  order: Pick<OpenSupplyOrder, "dueDate">,
  firstNeed: { startDate: string },
  todayDate: string
): number {
  return daysBetween(
    laterDate(order.dueDate, todayDate),
    laterDate(firstNeed.startDate, todayDate)
  );
}

type OrderCoverage = {
  order: OpenSupplyOrder;
  consumed: number;
  holdsFloor: boolean;
  firstNeed: { periodId: string; startDate: string } | null;
};

/**
 * The chronological consumption walk both the change actions and the sizing
 * projection read: the policy floor first (it is needed now), then demand,
 * each drawing down on-hand first, then the earliest open orders. The first
 * requirement an order covers is its need date.
 */
function walkOrderCoverage(
  input: Pick<
    DeriveChangeActionsInput,
    "onHand" | "demandPeriods" | "openOrders" | "periods" | "policyFloor"
  >
): OrderCoverage[] {
  const { onHand, demandPeriods, openOrders, periods, policyFloor } = input;

  // An order due after the last planning week is outside what this walk can
  // judge: the demand it was raised for is not loaded (MRP plans further out
  // than the reschedule check looks), so every such order would read as
  // "nothing needs it" and be offered for Cancel. It gets no verdict instead —
  // and is not pulled in to cover an earlier need either.
  const lastPeriod = periods[periods.length - 1];
  const isInsideHorizon = (order: OpenSupplyOrder) =>
    !lastPeriod ||
    daysBetween(order.dueDate, lastPeriod.startDate) < DAYS_PER_PERIOD;

  const orders: OrderCoverage[] = openOrders
    .filter(isInsideHorizon)
    .map((order) => ({
      order,
      consumed: 0,
      holdsFloor: false,
      firstNeed: null
    }))
    .sort((a, b) => daysBetween(a.order.dueDate, b.order.dueDate));

  // Chronological consumption walk: the policy floor first (it is needed now),
  // then demand, each drawing down on-hand first, then the earliest open
  // orders. The first requirement an order covers is its need date.
  let balance = onHand;
  let cursor = 0;
  const cover = (need: { periodId: string; startDate: string } | null) => {
    while (balance < 0 && cursor < orders.length) {
      const state = orders[cursor];
      if (!state) break;
      const available = state.order.quantity - state.consumed;
      if (available <= 0) {
        cursor++;
        continue;
      }
      const take = Math.min(available, -balance);
      state.consumed += take;
      balance += take;
      if (!need) state.holdsFloor = true;
      else if (!state.firstNeed) state.firstNeed = need;
      if (state.consumed >= state.order.quantity) cursor++;
    }
  };
  // Covered after the demand walk, the floor took whatever was left: an order
  // that held safety stock was dated by a later demand and offered a Defer,
  // and applying it put stock under the floor until that date.
  balance -= Math.max(policyFloor, 0);
  cover(null);
  for (const demand of demandPeriods) {
    balance -= demand.quantity;
    cover({ periodId: demand.periodId, startDate: demand.startDate });
  }

  return orders;
}

/**
 * The week each open order is first needed in, by its target (PO line or
 * job id) — from the same walk as the change actions. Orders that cover no
 * dated need (unneeded, or holding only the policy floor) are absent.
 */
export function firstNeedPeriodByOrder(
  input: Pick<
    DeriveChangeActionsInput,
    "onHand" | "demandPeriods" | "openOrders" | "periods" | "policyFloor"
  >,
  /**
   * With these, a FROZEN order late by more than the tolerance is left out:
   * it gets no Expedite, so it lands when it lands, and the projection must
   * not count it earlier — the need it misses gets new supply.
   */
  frozen?: { toleranceDays: number; todayDate: string; leadTimeDays?: number }
): Map<string, string> {
  const needs = new Map<string, string>();
  for (const { order, firstNeed } of walkOrderCoverage(input)) {
    const ref = supplyTarget(order);
    if (!ref || !firstNeed) continue;
    if (
      frozen &&
      isOrderFrozen(order, frozen.todayDate, frozen.leadTimeDays) &&
      daysLate(order, firstNeed, frozen.todayDate) > frozen.toleranceDays
    ) {
      continue;
    }
    needs.set(ref, firstNeed.periodId);
  }
  return needs;
}

/**
 * SAP-style rescheduling check over one item+location. Claims the policy
 * floor, then walks demand chronologically, against on-hand and then open
 * orders (earliest first) as the balance goes negative; each order's FIRST
 * covered demand dates it, and an order holding the floor is never deferred.
 * Emits at most ONE action per open order:
 *   consumed = 0                        → Cancel
 *   |expected − needed| > tolerance     → Expedite / Defer, where expected is
 *                                          the due date and needed the first
 *                                          need's week start, each no earlier
 *                                          than today
 *   leftover quantity (no date action)  → Decrease, to what the order will
 *                                          hold (`quantityAfterApply`)
 */
export function deriveChangeActions(
  input: DeriveChangeActionsInput
): ChangeCandidate[] {
  const { openOrders, periods, toleranceDays, todayDate } = input;

  if (openOrders.length === 0) return [];

  const periodFor = (dateIso: string): { id: string; startDate: string } => {
    let match = periods[0];
    for (const p of periods) {
      if (daysBetween(p.startDate, dateIso) <= 0) match = p;
      else break;
    }
    return match ?? { id: "", startDate: dateIso };
  };

  const orders = walkOrderCoverage(input);

  const actions: ChangeCandidate[] = [];
  for (const { order, consumed, holdsFloor, firstNeed } of orders) {
    // Planning changes a planned order itself: never a manual action.
    const isPlannedOrder = Boolean(order.plannedOrderId);
    const target = {
      purchaseOrderLineId: order.purchaseOrderLineId ?? null,
      jobId: order.jobId ?? null,
      plannedOrderId: order.plannedOrderId ?? null,
      requiresManualAction: !isPlannedOrder && order.requiresManualAction,
      supplierId: order.supplierId ?? null,
      policyName: null,
      triggerValues: null,
      latestOrderDate: null
    };

    if (consumed <= 0) {
      const period = periodFor(order.dueDate);
      actions.push({
        ...target,
        type: "Cancel",
        periodId: period.id,
        suggestedQuantity: order.quantity,
        suggestedDate: order.dueDate,
        horizonDate: order.dueDate,
        isASAP: false,
        reason: "No remaining requirement for this order"
      });
      continue;
    }

    const frozen = isOrderFrozen(order, todayDate, input.leadTimeDays);

    if (firstNeed) {
      // An overdue order arrives today at the earliest, not on its old due
      // date: measured from that date it read as "early" and was offered a
      // Defer to a date already past. Likewise a need in the current week is
      // needed today, not on the week's start: Apply writes the suggested
      // date onto the order, so an Expedite to a past week start made the
      // order overdue — read as arriving today, days after the week start —
      // and the same Expedite came back every run whenever the tolerance was
      // under a week.
      const needDate = laterDate(firstNeed.startDate, todayDate);
      // gap > 0: the order lands AFTER it is needed
      const gap = daysLate(order, firstNeed, todayDate);
      // Moving a promised date is agreed with the supplier, not applied.
      const dateTarget = {
        ...target,
        requiresManualAction:
          !isPlannedOrder &&
          (target.requiresManualAction || Boolean(order.dateIsPromised))
      };
      // A frozen order cannot be pulled in; the need it misses is planned
      // as new supply (`firstNeedPeriodByOrder` leaves it where it lands).
      if (gap > toleranceDays && frozen) continue;
      if (gap > toleranceDays) {
        actions.push({
          ...dateTarget,
          type: "Expedite",
          periodId: firstNeed.periodId,
          suggestedQuantity: order.quantity,
          suggestedDate: needDate,
          horizonDate: earlierDate(order.dueDate, needDate),
          isASAP: daysBetween(firstNeed.startDate, todayDate) < 0,
          reason: `Needed ${gap} days earlier than its current date`
        });
        continue;
      }
      // An order holding the floor is needed now, whatever demand follows.
      if (gap < -toleranceDays && !holdsFloor) {
        actions.push({
          ...dateTarget,
          type: "Defer",
          periodId: firstNeed.periodId,
          suggestedQuantity: order.quantity,
          suggestedDate: needDate,
          horizonDate: earlierDate(order.dueDate, needDate),
          isASAP: false,
          reason: `Not needed until ${-gap} days after its current date`
        });
        continue;
      }
    }

    // Round at the compare: `consumed` is a running float sum, so the raw
    // difference can be ~1e-16 for an order that is fully required.
    // Nor can a frozen order be cut back.
    if (frozen) continue;
    const required = round(consumed);
    // What the order holds once decreased — no less than the policy's
    // minimum, on its whole multiples, and a PO line in whole purchase
    // units — so an order already at that quantity is left alone.
    const decreasedTo = quantityAfterApply(
      order,
      input.orderRules
        ? reducedOrderQuantity(required, order.quantity, input.orderRules)
        : required
    );
    if (round(order.quantity - decreasedTo) > 0) {
      const period = periodFor(order.dueDate);
      actions.push({
        ...target,
        type: "Decrease",
        periodId: period.id,
        suggestedQuantity: decreasedTo,
        suggestedDate: order.dueDate,
        horizonDate: order.dueDate,
        isASAP: false,
        reason: `Only ${required} of ${order.quantity} is required`
      });
    }
  }

  return actions;
}

/**
 * The stock projection as if every open order arrived when it is needed: an
 * expedited order's quantity counts from the week it is needed instead of the
 * week it lands — and so does an order that is late by no more than the
 * reschedule tolerance, which gets no Expedite (`firstNeedPeriods`).
 *
 * New-supply sizing reads this projection. Sized on the raw one, a shortage an
 * Expedite already covers also got an Order (or Make) for the same week, and
 * applying both doubled that week's supply and left the order's old week short.
 * An order a few days late was the same case without the Expedite: a need of
 * 100 this week and a PO of 100 landing next Sunday read as short by 100 this
 * week, so sizing ordered 100 more — folded into "Increase from 100 to 200"
 * on that very PO, and a Decrease back on the next run.
 * Only Expedite moves supply EARLIER; Defer, Cancel and Decrease take away
 * supply nothing needs, so they cannot open a shortage and are not applied.
 *
 * `projections[i]` is the projected on-hand at the end of `periods[i]`. An order
 * dated before the first week counts in it (as MRP books overdue supply); one
 * dated after the last week is outside the projection.
 */
export function projectionsWithExpedites(args: {
  projections: number[];
  periods: { id: string; startDate: string }[];
  changeActions: Pick<
    ChangeCandidate,
    "type" | "periodId" | "purchaseOrderLineId" | "jobId" | "plannedOrderId"
  >[];
  openOrders: OpenSupplyOrder[];
  /** The week each order is first needed in (`firstNeedPeriodByOrder`). */
  firstNeedPeriods?: Map<string, string>;
}): number[] {
  const { projections, periods, changeActions, openOrders } = args;
  const adjusted = [...projections];
  const lastPeriod = periods[periods.length - 1];

  const weekOf = (dateIso: string): number => {
    if (
      lastPeriod &&
      daysBetween(dateIso, lastPeriod.startDate) >= DAYS_PER_PERIOD
    ) {
      return periods.length;
    }
    let index = 0;
    periods.forEach((p, i) => {
      if (daysBetween(p.startDate, dateIso) <= 0) index = i;
    });
    return index;
  };

  // Each order moves once, to the week it is needed. An Expedite names that
  // week itself; the walk's first need covers the rest.
  const needPeriodByOrder = new Map<string, string>();
  for (const action of changeActions) {
    if (action.type !== "Expedite") continue;
    const target = supplyTarget(action);
    if (target) needPeriodByOrder.set(target, action.periodId);
  }
  for (const [target, periodId] of args.firstNeedPeriods ?? []) {
    if (!needPeriodByOrder.has(target)) needPeriodByOrder.set(target, periodId);
  }

  for (const [target, periodId] of needPeriodByOrder) {
    const order = openOrders.find((o) => supplyTarget(o) === target);
    const needIndex = periods.findIndex((p) => p.id === periodId);
    if (!order || needIndex < 0) continue;

    // an order landing in or before its need week moves nothing
    const landIndex = Math.min(weekOf(order.dueDate), adjusted.length);
    for (let i = needIndex; i < landIndex; i++) {
      adjusted[i] = (adjusted[i] ?? 0) + order.quantity;
    }
  }
  return adjusted;
}

/**
 * Fold a new-supply suggestion into an existing open order landing in the same
 * window: instead of "create another order" AND leaving the existing one
 * unchanged, emit ONE Increase on that order (to existing + suggested). Only
 * orders that received no other action are eligible — one action per target.
 */
export function convertOrdersToIncreases(args: {
  sizingCandidates: ChangeCandidate[];
  openOrders: OpenSupplyOrder[];
  changeActions: ChangeCandidate[];
  toleranceDays: number;
  todayDate: string;
  /**
   * The most one order may hold (`orderSizingRules(...).maximum`: the batch
   * size, the fixed reorder quantity, the maximum order quantity). A
   * suggestion is folded only into an order it fits; otherwise it stays a new
   * order. 0 or absent: no limit.
   */
  maximumPerOrder?: number;
  /** The item's lead time: a frozen order (`isOrderFrozen`) is never increased. */
  leadTimeDays?: number;
}): ChangeCandidate[] {
  const { sizingCandidates, openOrders, changeActions, toleranceDays } = args;
  const maximumPerOrder = args.maximumPerOrder ?? 0;
  // Both dates as the day they mean: an overdue order lands today, and a
  // suggestion for the current week (dated its start) is needed today — so
  // an order an Expedite moved to today still matches this week's shortfall.
  const asOfToday = (dateIso: string) => laterDate(dateIso, args.todayDate);

  const targeted = new Set(changeActions.map((a) => supplyTarget(a) ?? ""));
  const used = new Set<string>();

  return sizingCandidates.map((candidate) => {
    if (candidate.type !== "Order" && candidate.type !== "Make") {
      return candidate;
    }
    const match = openOrders.find((order) => {
      const ref = supplyTarget(order) ?? "";
      if (!ref || targeted.has(ref) || used.has(ref)) return false;
      // An Order folds only into a PO line or a Buy planned order, a Make
      // only into a job or a Make planned order.
      const isBuy = order.plannedOrderId
        ? order.orderType === "Buy"
        : Boolean(order.purchaseOrderLineId);
      const isMake = order.plannedOrderId
        ? order.orderType === "Make"
        : Boolean(order.jobId);
      if (candidate.type === "Order" && !isBuy) return false;
      if (candidate.type === "Make" && !isMake) return false;
      if (isOrderFrozen(order, args.todayDate, args.leadTimeDays)) return false;
      // Growing an order past what one order holds (a batch, a fixed
      // reorder quantity, the maximum order quantity) breaks the rule it was
      // sized by, so the suggestion stays a new order of its own.
      if (
        maximumPerOrder > 0 &&
        round(
          quantityAfterApply(
            order,
            order.quantity + candidate.suggestedQuantity
          )
        ) > maximumPerOrder
      ) {
        return false;
      }
      return (
        Math.abs(
          daysBetween(
            asOfToday(order.dueDate),
            asOfToday(candidate.suggestedDate)
          )
        ) <= toleranceDays
      );
    });
    if (!match) return candidate;
    // What the order holds once increased — a PO line in whole purchase
    // units — so the next run reads exactly what Apply wrote.
    const increasedTo = quantityAfterApply(
      match,
      match.quantity + candidate.suggestedQuantity
    );
    if (round(increasedTo - match.quantity) <= 0) return candidate;
    used.add(supplyTarget(match) ?? "");
    return {
      ...candidate,
      type: "Increase",
      purchaseOrderLineId: match.purchaseOrderLineId ?? null,
      jobId: match.jobId ?? null,
      plannedOrderId: match.plannedOrderId ?? null,
      // planning changes a planned order itself
      requiresManualAction: !match.plannedOrderId && match.requiresManualAction,
      // the line's own supplier — the candidate carries the item's preferred
      // one, which need not be who this PO is with
      supplierId: match.supplierId ?? null,
      horizonDate: earlierDate(match.dueDate, candidate.suggestedDate),
      suggestedQuantity: increasedTo,
      reason: `Increase from ${match.quantity} to cover a shortfall of ${round(candidate.suggestedQuantity)}`
    };
  });
}

function policyFloorFor(row: {
  reorderingPolicy: string;
  demandAccumulationSafetyStock: number;
  reorderPoint: number;
  supersessionMode: string | null;
  minimumReserveQuantity: number;
}): number {
  if (row.supersessionMode === "Stock Only") {
    return Number(row.minimumReserveQuantity) || 0;
  }
  switch (row.reorderingPolicy) {
    case "Demand-Based Reorder":
      return Number(row.demandAccumulationSafetyStock) || 0;
    case "Fixed Reorder Quantity":
    case "Maximum Quantity":
      return Number(row.reorderPoint) || 0;
    default:
      return 0;
  }
}

/**
 * The reorder policy fields the sizing reads: the RPC row's columns, or the
 * engine's own copy of `itemPlanning` and `itemReplenishment`.
 */
export type PlanningPolicyRow = {
  reorderingPolicy: string;
  reorderPoint: number;
  reorderQuantity: number;
  minimumOrderQuantity: number;
  maximumOrderQuantity: number;
  orderMultiple: number;
  lotSize: number;
  maximumInventoryQuantity: number;
  demandAccumulationPeriod: number;
  demandAccumulationSafetyStock: number;
  leadTime: number;
};

export type RowSizingInput = {
  kind: "Order" | "Make";
  /** A project segment is lot-for-lot: no reorder point, safety stock or Stock Only reserve. */
  isProjectSegment: boolean;
  supersessionMode: string | null;
  /** The RPC's shortfall; read only for a Stock Only item. */
  quantityToOrder: number;
  minimumReserveQuantity: number;
  quantityOnHand: number;
  /** Nettable on-hand of the item in the segment. */
  onHand: number;
  /** What a project segment takes from common stock, per period. A common row ignores it. */
  draws: { periodId: string; quantity: number }[];
  /** This run's weeks, current first. */
  periods: { id: string; startDate: string }[];
  /** Cumulative projected stock at the end of each period, before draws. */
  projections: number[];
  /** Demand of the item in the segment, by period id. */
  demandByPeriod: Map<string, number>;
  /** Open PO lines or jobs of the item in the segment. */
  openOrders: OpenSupplyOrder[];
  policy: PlanningPolicyRow;
  preferredSupplierId: string | null;
  toleranceDays: number;
  todayDate: string;
};

export type RowSizingResult = {
  /** Expedite, Defer, Cancel and Decrease on the open orders. */
  changeActions: ChangeCandidate[];
  /** Order / Make, and the Increase each one folded into an open order. */
  newSupply: ChangeCandidate[];
};

/** The draws summed per period, positive draws only. */
export function drawsByPeriod(
  draws: { periodId: string; quantity: number }[]
): Map<string, number> {
  const drawByPeriod = new Map<string, number>();
  for (const draw of draws) {
    if (draw.quantity <= 0) continue;
    drawByPeriod.set(
      draw.periodId,
      (drawByPeriod.get(draw.periodId) ?? 0) + draw.quantity
    );
  }
  return drawByPeriod;
}

/**
 * The change actions on a row's open orders and the new supply its projection
 * needs. A draw counts as the segment's own stock from its period on, so a
 * project segment's Order or Make covers only the remainder.
 */
export function sizeRowSupply(input: RowSizingInput): RowSizingResult {
  const {
    kind,
    isProjectSegment,
    periods,
    demandByPeriod,
    openOrders,
    policy,
    toleranceDays,
    todayDate
  } = input;

  const drawByPeriod = drawsByPeriod(isProjectSegment ? input.draws : []);
  const drawTotal = [...drawByPeriod.values()].reduce((a, b) => a + b, 0);

  // change actions against real open documents
  const demandPeriods = periods
    .filter((p) => (demandByPeriod.get(p.id) ?? 0) > 0)
    .map((p) => ({
      periodId: p.id,
      startDate: p.startDate,
      quantity: demandByPeriod.get(p.id) ?? 0
    }));

  const coverageInput = {
    onHand: input.onHand + drawTotal,
    demandPeriods,
    openOrders,
    periods,
    policyFloor: isProjectSegment
      ? 0
      : policyFloorFor({
          ...policy,
          supersessionMode: input.supersessionMode,
          minimumReserveQuantity: input.minimumReserveQuantity
        })
  };
  const leadTime = Number(policy.leadTime) || 0;
  // lot-for-lot in a project segment: one order per short week, sized to the
  // shortfall
  const sizingPolicy = isProjectSegment
    ? "Demand-Based Reorder"
    : policy.reorderingPolicy;
  const sizingParams = isProjectSegment
    ? {
        reorderPoint: 0,
        reorderQuantity: 0,
        minimumOrderQuantity: 0,
        maximumOrderQuantity: 0,
        orderMultiple: 0,
        lotSize: 0,
        maximumInventoryQuantity: 0,
        demandAccumulationPeriod: 1,
        demandAccumulationSafetyStock: 0,
        leadTime
      }
    : {
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
        leadTime
      };
  const orderRules = orderSizingRules(
    !isProjectSegment && input.supersessionMode === "Stock Only"
      ? "Stock Only"
      : sizingPolicy,
    sizingParams
  );
  const changeActions = deriveChangeActions({
    ...coverageInput,
    toleranceDays,
    todayDate,
    orderRules,
    leadTimeDays: leadTime
  });

  // new-supply suggestions from the shared sizing (same math as the grid),
  // sized on the projection with every open order counted from the week
  // it is needed: every Expedite above done, and an order late within the
  // tolerance counted as on time, as the reschedule check judged it
  let sizing: ChangeCandidate[] = [];
  if (!isProjectSegment && input.supersessionMode === "Stock Only") {
    const shortfall = Math.max(0, Number(input.quantityToOrder) || 0);
    const firstPeriod = periods[0];
    if (shortfall > 0 && firstPeriod) {
      const startDate = parseDate(firstPeriod.startDate)
        .subtract({ days: Number(policy.leadTime) || 0 })
        .toString();
      sizing = [
        {
          type: kind,
          periodId: firstPeriod.id,
          suggestedQuantity: shortfall,
          suggestedDate: firstPeriod.startDate,
          horizonDate: firstPeriod.startDate,
          latestOrderDate: startDate,
          isASAP: daysBetween(startDate, todayDate) < 0,
          purchaseOrderLineId: null,
          jobId: null,
          plannedOrderId: null,
          requiresManualAction: false,
          supplierId: kind === "Order" ? input.preferredSupplierId : null,
          policyName: "Stock Only",
          reason: "Below the minimum reserve for a superseded item",
          triggerValues: {
            projectedStock: Number(input.quantityOnHand) || 0,
            reorderPoint: Number(input.minimumReserveQuantity) || 0,
            leadTime: Number(policy.leadTime) || 0
          }
        }
      ];
    }
  } else {
    // A draw is the segment's stock from its period on.
    let drawn = 0;
    const projected = periods.map((p, i) => {
      drawn += drawByPeriod.get(p.id) ?? 0;
      return (input.projections[i] ?? 0) + drawn;
    });
    const projections = projectionsWithExpedites({
      projections: projected,
      periods,
      changeActions,
      openOrders,
      firstNeedPeriods: firstNeedPeriodByOrder(coverageInput, {
        toleranceDays,
        todayDate,
        leadTimeDays: leadTime
      })
    });
    sizing = computePlanningOrders({
      reorderingPolicy: sizingPolicy,
      periods,
      projections,
      todayDate,
      params: sizingParams
    }).map((order) => ({
      type: kind,
      periodId: order.periodId,
      suggestedQuantity: order.quantity,
      suggestedDate: order.dueDate,
      horizonDate: order.dueDate,
      latestOrderDate: order.startDate,
      isASAP: order.isASAP,
      purchaseOrderLineId: null,
      jobId: null,
      plannedOrderId: null,
      requiresManualAction: false,
      supplierId: kind === "Order" ? input.preferredSupplierId : null,
      policyName: isProjectSegment ? "Lot-for-Lot" : order.policyName,
      reason: null,
      triggerValues: isProjectSegment
        ? {
            projectedStock: order.triggerValues.projectedStock,
            leadTime
          }
        : order.triggerValues
    }));
  }

  const newSupply = convertOrdersToIncreases({
    sizingCandidates: sizing,
    openOrders,
    changeActions,
    toleranceDays,
    todayDate,
    maximumPerOrder: orderRules.maximum,
    leadTimeDays: leadTime
  });

  return { changeActions, newSupply };
}
