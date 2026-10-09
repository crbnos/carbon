// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Planning action messages (spec §P1) — the persisted, assignable output of an
// MRP run. One row per suggested action:
//
//   Order / Make          — create new supply (from the shared reorder sizing)
//   Expedite / Defer      — move an existing open PO line / job (date)
//   Increase / Decrease   — change an existing order's quantity
//   Cancel                — an existing order has no remaining requirement
//
// Change actions follow the SAP "rescheduling check on a firmed receipt" model:
// open orders are matched to dated requirements chronologically; a date gap
// STRICTLY greater than companySettings.rescheduleToleranceDays fires
// Expedite/Defer; exactly ONE action is emitted per target document
// (Cancel → Expedite/Defer → Increase/Decrease).
//
// Persistence is a DIFF-WRITE keyed on the natural key (item, location, type,
// period, target document): Open rows update in place (a human-overridden
// assignee is never re-resolved), Dismissed rows stay dismissed unless the
// suggestion changed materially, vanished Open/Dismissed rows are deleted so a
// returning need re-surfaces, and Actioned rows are terminal. Failures
// PROPAGATE to the caller — a run must not report success with stale actions.
//
// Actions are generated over the WHOLE planning window. The per-item planning
// horizon (time fence) is a read-time lens applied by the planning grids, which
// compare each row's `horizonDate` with today + horizon days — so a planner can
// widen the fence on screen without a run. Nothing here reads the horizon.

import type { Database } from "@carbon/database";
import { getCompanyTimeZone } from "@carbon/database";
import type { DB } from "@carbon/database/client";
import { fetchAll } from "@carbon/database/fetch-all";
import { getLogger } from "@carbon/logger";
import {
  computePlanningOrders,
  datetime,
  equals,
  orderSizingRules,
  RoundingMode,
  reducedOrderQuantity,
  round
} from "@carbon/utils";
import { parseDate, startOfWeek } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Kysely, sql } from "kysely";
import { toIsoDate } from "../scheduling/date-utils.ts";
import { loadResponsibleEmployeeResolver } from "./responsible-employee.ts";
import {
  jobCompletionDate,
  purchaseOrderLineArrivalDate
} from "./supply-date.ts";

const logger = getLogger("planning", "planning-actions");

const KEY_SEP = "\x1f";
const WEEKS_TO_PLAN = 48;
/** Planning periods are weeks. */
const DAYS_PER_PERIOD = 7;
const BATCH_SIZE = 500;
/**
 * A Release is raised this many days before its release day, not earlier.
 * Every planned order has one, so raised the moment the order exists it is a
 * standing row weeks ahead of anything anyone can do about it.
 */
const RELEASE_NOTICE_DAYS = 1;

export type PlanningActionType =
  | "Order"
  | "Make"
  | "Expedite"
  | "Defer"
  | "Cancel"
  | "Increase"
  | "Decrease"
  | "Release";

export type PlanningActionCandidate = {
  itemId: string;
  locationId: string;
  periodId: string;
  type: PlanningActionType;
  suggestedQuantity: number;
  suggestedDate: string;
  /**
   * The date that decides whether this action is inside a planning horizon:
   * the earlier of the target order's current date and `suggestedDate`. A Defer
   * counts from where its order sits today, an Expedite from when it is needed.
   */
  horizonDate: string;
  /**
   * New-supply actions (Order / Make, and the Increase one folds into): the
   * required date less the item's lead time — the last day to place the order.
   */
  latestOrderDate: string | null;
  isASAP: boolean;
  purchaseOrderLineId: string | null;
  jobId: string | null;
  requiresManualAction: boolean;
  supplierId: string | null;
  policyName: string | null;
  reason: string | null;
  triggerValues: Record<string, number | null | undefined> | null;
  assignee: string | null;
};

export type ExistingPlanningAction = {
  id: string;
  itemId: string;
  locationId: string;
  periodId: string;
  type: PlanningActionType;
  status: "Open" | "Dismissed";
  suggestedQuantity: number;
  suggestedDate: string;
  horizonDate: string;
  latestOrderDate: string | null;
  isASAP: boolean;
  purchaseOrderLineId: string | null;
  jobId: string | null;
  requiresManualAction: boolean;
  supplierId: string | null;
  policyName: string | null;
  reason: string | null;
  triggerValues: unknown;
  assignee: string | null;
  assigneeOverridden: boolean;
};

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
 * The view only yields open POs ('Planned' | 'To Receive' | 'To Receive and
 * Invoice'); anything past 'Planned'/'Draft' has been sent to the supplier
 * (mirrors PURCHASE_ORDER_LOCKED_STATUSES in purchasing.models.ts). Never gate
 * on orderDate — insertPurchaseOrder defaults it to today for planned POs.
 */
export function isCommittedPurchaseOrderStatus(
  status: Database["public"]["Enums"]["purchaseOrderStatus"] | null | undefined
): boolean {
  return status !== "Planned" && status !== "Draft";
}

/** Job statuses at/after release-to-floor are committed supply. */
export function isCommittedJobStatus(
  status: Database["public"]["Enums"]["jobStatus"] | null | undefined
): boolean {
  return status === "Ready" || status === "In Progress" || status === "Paused";
}

export type OpenSupplyOrder = {
  purchaseOrderLineId?: string;
  jobId?: string;
  quantity: number;
  /** the date the order is currently expected to land (ISO) */
  dueDate: string;
  requiresManualAction: boolean;
  /**
   * `dueDate` is the supplier's promise (a PO line's or its delivery's
   * promised date). Apply moves only the required date, which a promise
   * outranks, so a date change on such a line is the planner's to agree with
   * the supplier: Expedite / Defer become "Review on PO".
   */
  dateIsPromised?: boolean;
  supplierId?: string | null;
  /**
   * A PO line's inventory units per purchase unit (`purchaseOrderLine.
   * conversionFactor`). `quantity` is in inventory units; Apply writes the
   * line in whole purchase units. Missing or not positive means 1.
   */
  conversionFactor?: number | null;
  /**
   * When a PLANNED order is due to be released (`releaseByDate`); null or
   * absent once it is past Planned — a Release applies only while it is.
   */
  release?: PlannedOrderRelease | null;
};

export type PlannedOrderRelease = {
  /** The last day to release it: due date − lead time − 1 day. */
  date: string;
  /** The due date and lead time that set it — for a purchase order, those of
   *  the line that needs releasing first. */
  dueDate: string;
  leadTime: number;
};

/**
 * The last day to release a planned order so it still arrives on time: its
 * due date less the item's lead time, less one more day. Due in 8 days with a
 * 7-day lead time is today.
 */
export function releaseByDate(dueDate: string, leadTimeDays: number): string {
  return parseDate(dueDate)
    .subtract({ days: Math.max(leadTimeDays, 0) + 1 })
    .toString();
}

/** The earlier of two releases (a purchase order is released once, for the
 *  line that needs it first). */
export function earlierRelease(
  a: PlannedOrderRelease | null | undefined,
  b: PlannedOrderRelease
): PlannedOrderRelease {
  // daysBetween(a, b) is a − b
  return a && daysBetween(a.date, b.date) <= 0 ? a : b;
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
 */
export function isOrderFrozen(
  order: Pick<OpenSupplyOrder, "dueDate">,
  todayDate: string,
  leadTimeDays = 0
): boolean {
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

type ChangeCandidate = Omit<
  PlanningActionCandidate,
  "itemId" | "locationId" | "assignee"
>;

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
    const ref = order.purchaseOrderLineId ?? order.jobId;
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
    const target = {
      purchaseOrderLineId: order.purchaseOrderLineId ?? null,
      jobId: order.jobId ?? null,
      requiresManualAction: order.requiresManualAction,
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
          target.requiresManualAction || Boolean(order.dateIsPromised)
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
    "type" | "periodId" | "purchaseOrderLineId" | "jobId"
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
    const target = action.purchaseOrderLineId ?? action.jobId;
    if (target) needPeriodByOrder.set(target, action.periodId);
  }
  for (const [target, periodId] of args.firstNeedPeriods ?? []) {
    if (!needPeriodByOrder.has(target)) needPeriodByOrder.set(target, periodId);
  }

  for (const [target, periodId] of needPeriodByOrder) {
    const order = openOrders.find(
      (o) => (o.purchaseOrderLineId ?? o.jobId) === target
    );
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

  const targeted = new Set(
    changeActions.map((a) => a.purchaseOrderLineId ?? a.jobId ?? "")
  );
  const used = new Set<string>();

  return sizingCandidates.map((candidate) => {
    if (candidate.type !== "Order" && candidate.type !== "Make") {
      return candidate;
    }
    const match = openOrders.find((order) => {
      const ref = order.purchaseOrderLineId ?? order.jobId ?? "";
      if (!ref || targeted.has(ref) || used.has(ref)) return false;
      const isBuy = Boolean(order.purchaseOrderLineId);
      if (candidate.type === "Order" && !isBuy) return false;
      if (candidate.type === "Make" && isBuy) return false;
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
    used.add(match.purchaseOrderLineId ?? match.jobId ?? "");
    return {
      ...candidate,
      type: "Increase",
      purchaseOrderLineId: match.purchaseOrderLineId ?? null,
      jobId: match.jobId ?? null,
      requiresManualAction: match.requiresManualAction,
      // the line's own supplier — the candidate carries the item's preferred
      // one, which need not be who this PO is with
      supplierId: match.supplierId ?? null,
      horizonDate: earlierDate(match.dueDate, candidate.suggestedDate),
      suggestedQuantity: increasedTo,
      reason: `Increase from ${match.quantity} to cover a shortfall of ${round(candidate.suggestedQuantity)}`
    };
  });
}

/**
 * One Release per planned order (`OpenSupplyOrder.release`), dated the last
 * day to release it, raised only from `RELEASE_NOTICE_DAYS` before that day.
 * Released from the order itself — the planning pages link to it — so it is
 * never applied. An order MRP would Cancel gets none.
 */
export function deriveReleaseActions(args: {
  openOrders: OpenSupplyOrder[];
  changeActions: Pick<
    ChangeCandidate,
    "type" | "purchaseOrderLineId" | "jobId"
  >[];
  periods: { id: string; startDate: string }[];
  todayDate: string;
}): ChangeCandidate[] {
  const { openOrders, changeActions, periods, todayDate } = args;
  const cancelled = new Set(
    changeActions
      .filter((a) => a.type === "Cancel")
      .map((a) => a.purchaseOrderLineId ?? a.jobId)
  );
  // the week a date falls in; an earlier date is the first week
  const periodFor = (dateIso: string) => {
    let match = periods[0];
    for (const p of periods) {
      if (daysBetween(p.startDate, dateIso) <= 0) match = p;
      else break;
    }
    return match;
  };

  const actions: ChangeCandidate[] = [];
  for (const order of openOrders) {
    const release = order.release;
    if (!release) continue;
    // not yet: the run on the day before raises it
    if (daysBetween(release.date, todayDate) > RELEASE_NOTICE_DAYS) continue;
    if (cancelled.has(order.purchaseOrderLineId ?? order.jobId ?? null)) {
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
      requiresManualAction: false,
      supplierId: order.supplierId ?? null,
      policyName: null,
      reason: `Due ${release.dueDate} with a ${release.leadTime}-day lead time`,
      triggerValues: { leadTime: release.leadTime }
    });
  }
  return actions;
}

/**
 * The identity an action keeps from run to run.
 *
 * A change action belongs to its ORDER: item, location, type and target. Its
 * period (the week of the need it was measured against) is data, so a need
 * that moves a week updates the same row instead of replacing it.
 *
 * A new-supply action (Order / Make) has no order yet, so its week is its
 * identity — except that every week up to the current one is one "now" key
 * (`keyPeriod`). MRP puts all current and overdue demand in the first week,
 * which is a different week every Sunday; keyed on it, a shortage that went on
 * got a new row each week and lost its dismissal and its hand-set assignee.
 */
export function naturalKey(
  action: {
    itemId: string;
    locationId: string;
    type: string;
    periodId: string;
    purchaseOrderLineId: string | null;
    jobId: string | null;
  },
  keyPeriod: (periodId: string) => string = (periodId) => periodId
): string {
  const target = action.purchaseOrderLineId ?? action.jobId;
  return [
    action.itemId,
    action.locationId,
    action.type,
    target ? `order:${target}` : `period:${keyPeriod(action.periodId)}`
  ].join(KEY_SEP);
}

/**
 * `naturalKey`'s period mapping for one run: the current week, and any week
 * before it (a row written in an earlier week), are all "now".
 */
export function keyPeriodFor(
  periods: { id: string }[]
): (periodId: string) => string {
  const current = periods[0]?.id;
  const later = new Set(periods.slice(1).map((p) => p.id));
  return (periodId) =>
    periodId === current || !later.has(periodId) ? "now" : periodId;
}

export type PlanningActionDiff = {
  inserts: PlanningActionCandidate[];
  updates: {
    id: string;
    patch: Record<string, unknown>;
  }[];
  deleteIds: string[];
};

/**
 * JSON-value equality independent of object key order. Postgres jsonb returns
 * keys in length-then-bytewise order while candidates build insertion-ordered
 * literals, so a raw JSON.stringify comparison re-patched identical
 * triggerValues on every run — breaking the two-identical-runs-produce-zero-
 * changes invariant and churning updatedAt/updatedBy.
 */
export function jsonEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => jsonEquals(value, b[index]));
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    jsonEquals(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key]
    )
  );
}

/**
 * Diff-write plan: never delete-and-recreate — assignment and dismissal state
 * must survive a run. Two identical consecutive runs produce zero changes.
 */
export function diffPlanningActions(args: {
  existing: ExistingPlanningAction[];
  candidates: PlanningActionCandidate[];
  toleranceDays: number;
  /** This run's weeks, current first; their ids decide what is "now". */
  periods?: { id: string }[];
}): PlanningActionDiff {
  const { existing, candidates, toleranceDays } = args;
  const keyPeriod = args.periods ? keyPeriodFor(args.periods) : undefined;
  const keyOf = (action: Parameters<typeof naturalKey>[0]) =>
    naturalKey(action, keyPeriod);

  // Two stored rows can share a "now" key (last week's current-week row and
  // one written for this week): keep the one already on the current week; the
  // other is deleted below as unseen.
  const currentPeriodId = args.periods?.[0]?.id;
  const existingByKey = new Map<string, ExistingPlanningAction>();
  for (const row of existing) {
    const key = keyOf(row);
    const kept = existingByKey.get(key);
    if (!kept || row.periodId === currentPeriodId) existingByKey.set(key, row);
  }
  const keptIds = new Set([...existingByKey.values()].map((row) => row.id));
  const seen = new Set<string>();

  const inserts: PlanningActionCandidate[] = [];
  const updates: PlanningActionDiff["updates"] = [];

  for (const candidate of candidates) {
    const key = keyOf(candidate);
    if (seen.has(key)) continue; // one action per natural key
    seen.add(key);

    const current = existingByKey.get(key);
    if (!current) {
      inserts.push(candidate);
      continue;
    }

    const materialChange =
      !equals(current.suggestedQuantity, candidate.suggestedQuantity) ||
      Math.abs(daysBetween(current.suggestedDate, candidate.suggestedDate)) >
        toleranceDays;

    const patch: Record<string, unknown> = {};
    // The week and the grid-facing dates track the candidate on every row,
    // dismissed ones included: keeping them current never re-opens anything.
    if (current.periodId !== candidate.periodId) {
      patch.periodId = candidate.periodId;
    }
    if (current.horizonDate !== candidate.horizonDate) {
      patch.horizonDate = candidate.horizonDate;
    }
    if ((current.latestOrderDate ?? null) !== candidate.latestOrderDate) {
      patch.latestOrderDate = candidate.latestOrderDate;
    }

    if (current.status === "Dismissed" && !materialChange) {
      // dismissed suppresses a persisting, unchanged need
      if (Object.keys(patch).length > 0) {
        updates.push({ id: current.id, patch });
      }
      continue;
    }

    if (current.status === "Dismissed") patch.status = "Open";
    if (!equals(current.suggestedQuantity, candidate.suggestedQuantity)) {
      patch.suggestedQuantity = candidate.suggestedQuantity;
    }
    if (current.suggestedDate !== candidate.suggestedDate) {
      patch.suggestedDate = candidate.suggestedDate;
    }
    if (current.isASAP !== candidate.isASAP) patch.isASAP = candidate.isASAP;
    if (current.requiresManualAction !== candidate.requiresManualAction) {
      patch.requiresManualAction = candidate.requiresManualAction;
    }
    if ((current.supplierId ?? null) !== candidate.supplierId) {
      patch.supplierId = candidate.supplierId;
    }
    if ((current.policyName ?? null) !== candidate.policyName) {
      patch.policyName = candidate.policyName;
    }
    if ((current.reason ?? null) !== candidate.reason) {
      patch.reason = candidate.reason;
    }
    if (
      !jsonEquals(
        current.triggerValues ?? null,
        candidate.triggerValues ?? null
      )
    ) {
      patch.triggerValues = candidate.triggerValues;
    }
    if (
      !current.assigneeOverridden &&
      (current.assignee ?? null) !== candidate.assignee
    ) {
      patch.assignee = candidate.assignee;
    }

    if (Object.keys(patch).length > 0) {
      updates.push({ id: current.id, patch });
    }
  }

  const deleteIds = existing
    .filter((e) => !keptIds.has(e.id) || !seen.has(keyOf(e)))
    .map((e) => e.id);

  return { inserts, updates, deleteIds };
}

/**
 * The Postgres type of every column a diff patch can set: the cast each
 * `VALUES` column needs, since a bound parameter arrives untyped. A patch key
 * missing here is a programming error and throws before anything is written.
 */
const PATCH_COLUMN_TYPES: Record<string, string> = {
  periodId: "text",
  horizonDate: "date",
  latestOrderDate: "date",
  status: '"planningActionStatus"',
  suggestedQuantity: "numeric",
  suggestedDate: "date",
  isASAP: "boolean",
  requiresManualAction: "boolean",
  supplierId: "text",
  policyName: "text",
  reason: "text",
  triggerValues: "jsonb",
  assignee: "text"
};

/**
 * Writes one run's diff inside the caller's transaction.
 *
 * The run read the actions before it computed this diff, so a row a planner
 * applied in between still reads as Open or Dismissed here. Every DELETE and
 * UPDATE therefore skips `Actioned` rows itself: without that, the run deleted
 * an applied action (and its claim) or reopened it with a `status: "Open"`
 * patch, offering it to be applied twice.
 *
 * Updates are grouped by the columns they change and sent as one
 * `UPDATE … FROM (VALUES …)` per group and chunk. They were one statement per
 * row — thousands of round trips on the weekly roll of the first period, with
 * the transaction holding a connection of the job pool throughout. Each row
 * keeps its own patch: writing every column would also move a dismissed row's
 * stored quantity, and a changed need would then never cross the tolerance.
 */
export async function writePlanningActionDiff(
  trx: Kysely<DB>,
  args: {
    companyId: string;
    userId: string;
    diff: PlanningActionDiff;
    updatedAt: string;
  }
): Promise<void> {
  const { companyId, userId, diff, updatedAt } = args;

  for (let i = 0; i < diff.deleteIds.length; i += BATCH_SIZE) {
    await trx
      .deleteFrom("planningAction")
      .where("companyId", "=", companyId)
      .where("status", "!=", "Actioned")
      .where("id", "in", diff.deleteIds.slice(i, i + BATCH_SIZE))
      .execute();
  }

  const groups = new Map<string, PlanningActionDiff["updates"]>();
  for (const update of diff.updates) {
    const shape = Object.keys(update.patch).sort().join(",");
    const group = groups.get(shape);
    if (group) group.push(update);
    else groups.set(shape, [update]);
  }

  for (const [shape, rows] of groups) {
    const columns = shape.split(",");
    for (const column of columns) {
      if (!PATCH_COLUMN_TYPES[column]) {
        throw new Error(`No column type for planning action patch "${column}"`);
      }
    }
    // The diff skipped an overridden assignee when it READ the row, but a
    // planner can assign between that read and this write (Assign does not
    // take the run's lock), so the statement re-checks the flag on the row.
    const assignments = sql.join(
      columns.map((column) =>
        column === "assignee"
          ? sql`"assignee" = CASE WHEN t."assigneeOverridden" THEN t."assignee" ELSE v."assignee"::text END`
          : sql`${sql.id(column)} = v.${sql.id(column)}::${sql.raw(
              PATCH_COLUMN_TYPES[column]!
            )}`
      )
    );
    const valueColumns = sql.join(["id", ...columns].map((c) => sql.id(c)));

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const values = sql.join(
        rows.slice(i, i + BATCH_SIZE).map(
          (row) =>
            sql`(${sql.join([
              row.id,
              ...columns.map((column) => {
                const value = row.patch[column] ?? null;
                return column === "triggerValues" && value !== null
                  ? JSON.stringify(value)
                  : value;
              })
            ])})`
        )
      );
      await sql`
        UPDATE "planningAction" AS t
        SET ${assignments}, "updatedBy" = ${userId}, "updatedAt" = ${updatedAt}
        FROM (VALUES ${values}) AS v(${valueColumns})
        WHERE t."id" = v."id"
          AND t."companyId" = ${companyId}
          AND t."status" <> 'Actioned'
      `.execute(trx);
    }
  }

  for (let i = 0; i < diff.inserts.length; i += BATCH_SIZE) {
    const chunk = diff.inserts.slice(i, i + BATCH_SIZE);
    await trx
      .insertInto("planningAction")
      .values(
        chunk.map((candidate) => ({
          companyId,
          itemId: candidate.itemId,
          locationId: candidate.locationId,
          periodId: candidate.periodId,
          type: candidate.type,
          suggestedQuantity: candidate.suggestedQuantity,
          suggestedDate: candidate.suggestedDate,
          horizonDate: candidate.horizonDate,
          latestOrderDate: candidate.latestOrderDate,
          isASAP: candidate.isASAP,
          purchaseOrderLineId: candidate.purchaseOrderLineId,
          jobId: candidate.jobId,
          requiresManualAction: candidate.requiresManualAction,
          supplierId: candidate.supplierId,
          policyName: candidate.policyName,
          reason: candidate.reason,
          triggerValues: candidate.triggerValues
            ? JSON.stringify(candidate.triggerValues)
            : null,
          assignee: candidate.assignee,
          createdBy: userId
        }))
      )
      .execute();
  }
}

// ──────────────────────────────────────────────────────────────
// Orchestrator
// ──────────────────────────────────────────────────────────────

type RpcPlanningRow =
  Database["public"]["Functions"]["get_purchasing_planning"]["Returns"][number];
type ProductionPlanningRow =
  Database["public"]["Functions"]["get_production_planning"]["Returns"][number];

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

export async function generatePlanningActions(
  client: SupabaseClient<Database>,
  db: Kysely<DB>,
  args: { companyId: string; userId: string }
): Promise<{ inserted: number; updated: number; deleted: number }> {
  const { companyId, userId } = args;

  const timeZone = await getCompanyTimeZone(db, companyId);
  const todayDate = datetime.today(timeZone).toString();
  const weekStart = startOfWeek(datetime.today(timeZone), "en-US").toString();

  const [settings, locations, periodRows] = await Promise.all([
    db
      .selectFrom("companySettings")
      .select(["rescheduleToleranceDays"])
      .where("id", "=", companyId)
      .executeTakeFirst(),
    db
      .selectFrom("location")
      .select(["id"])
      .where("companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("period")
      .select(["id", "startDate"])
      .where("periodType", "=", "Week")
      .where("startDate", ">=", weekStart)
      .orderBy("startDate", "asc")
      .limit(WEEKS_TO_PLAN)
      .execute()
  ]);

  const toleranceDays = Number(settings?.rescheduleToleranceDays ?? 7);
  const periods = periodRows.map((p) => ({
    id: p.id,
    startDate: toIsoDate(p.startDate as unknown as string | Date)!
  }));
  const periodIds = periods.map((p) => p.id);
  const periodIdSet = new Set(periodIds);
  const periodById = new Map(periods.map((p) => [p.id, p]));

  if (periods.length === 0 || locations.length === 0) {
    return { inserted: 0, updated: 0, deleted: 0 };
  }

  // Every read below is independent of the others, so they run together in
  // two groups instead of one after another (they were six waits in a row).
  // Two groups, not one: the resolver alone takes five Kysely reads from the
  // shared process pool, so a bounded group leaves connections for the run's
  // other work — the PostgREST views ride alongside it.
  const [resolveAssignee, openPoLines, openJobs] = await Promise.all([
    loadResponsibleEmployeeResolver(db, companyId),
    // ── open supply (real documents change actions target)
    fetchAll<Database["public"]["Views"]["openPurchaseOrderLines"]["Row"]>(() =>
      client
        .from("openPurchaseOrderLines")
        .select("*")
        .eq("companyId", companyId)
        .order("id")
    ),
    fetchAll<Database["public"]["Views"]["openProductionOrders"]["Row"]>(() =>
      client
        .from("openProductionOrders")
        .select("*")
        .eq("companyId", companyId)
        .order("id")
    )
  ]);
  if (openPoLines.error) throw openPoLines.error;
  if (openJobs.error) throw openJobs.error;
  const poLineRows = openPoLines.data ?? [];
  const jobRows = openJobs.data ?? [];

  // ── demand per (item, location, period): actual + forecast + projection
  //    (net of consumption), the same union the planning RPCs read; on-hand;
  //    the open jobs' status and good-unit quantity, and the open PO lines'
  //    conversion factor, which the openProductionOrders / openPurchaseOrderLines
  //    views do not expose — one read each of the company's open documents
  //    (the views' own filters), no id list.
  const [
    demandActuals,
    demandForecasts,
    demandProjections,
    inventoryRows,
    openJobRows,
    poLineFactorRows
  ] = await Promise.all([
    db
      .selectFrom("demandActual")
      .select(["itemId", "locationId", "periodId", "actualQuantity"])
      .where("companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("demandForecast")
      .select(["itemId", "locationId", "periodId", "forecastQuantity"])
      .where("companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("demandProjection")
      .select([
        "itemId",
        "locationId",
        "periodId",
        "forecastQuantity",
        "consumedQuantity"
      ])
      .where("companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("itemStockQuantities")
      .select(["itemId", "locationId", "quantityOnHand"])
      .where("companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("job")
      .select(["id", "status", "quantity", "quantityReceivedToInventory"])
      .where("companyId", "=", companyId)
      .where("status", "in", ["Planned", "Ready", "In Progress", "Paused"])
      .execute(),
    // Only the lines bought in a unit other than the inventory unit: every
    // other line's factor is 1, the default below.
    db
      .selectFrom("purchaseOrderLine as pol")
      .innerJoin("purchaseOrder as po", "po.id", "pol.purchaseOrderId")
      .select(["pol.id", "pol.conversionFactor"])
      .where("pol.companyId", "=", companyId)
      .where("po.status", "in", [
        "To Receive",
        "To Receive and Invoice",
        "Planned"
      ])
      .where("pol.receivedComplete", "=", false)
      .where("pol.conversionFactor", "!=", 1)
      .execute()
  ]);

  const demandByItemLocation = new Map<string, Map<string, number>>();
  const addDemand = (
    itemId: string | null,
    locationId: string | null,
    periodId: string | null,
    quantity: number | null
  ) => {
    if (!itemId || !locationId || !periodId) return;
    if (!periodIdSet.has(periodId)) return;
    const key = `${itemId}${KEY_SEP}${locationId}`;
    const byPeriod = demandByItemLocation.get(key) ?? new Map<string, number>();
    byPeriod.set(
      periodId,
      (byPeriod.get(periodId) ?? 0) + (Number(quantity) || 0)
    );
    demandByItemLocation.set(key, byPeriod);
  };
  for (const row of demandActuals) {
    addDemand(row.itemId, row.locationId, row.periodId, row.actualQuantity);
  }
  for (const row of demandForecasts) {
    addDemand(row.itemId, row.locationId, row.periodId, row.forecastQuantity);
  }
  for (const row of demandProjections) {
    addDemand(
      row.itemId,
      row.locationId,
      row.periodId,
      Math.max(
        (Number(row.forecastQuantity) || 0) -
          (Number(row.consumedQuantity) || 0),
        0
      )
    );
  }

  const onHandByItemLocation = new Map<string, number>();
  for (const row of inventoryRows) {
    if (row.itemId && row.locationId) {
      onHandByItemLocation.set(
        `${row.itemId}${KEY_SEP}${row.locationId}`,
        Number(row.quantityOnHand) || 0
      );
    }
  }

  const jobById = new Map<
    string,
    {
      status: Database["public"]["Enums"]["jobStatus"];
      quantity: number;
      quantityReceivedToInventory: number;
    }
  >();
  for (const row of openJobRows) {
    if (!row.status) continue;
    jobById.set(row.id, {
      status: row.status,
      quantity: Number(row.quantity) || 0,
      quantityReceivedToInventory: Number(row.quantityReceivedToInventory) || 0
    });
  }

  const conversionFactorByLineId = new Map(
    poLineFactorRows.map((row) => [row.id, Number(row.conversionFactor)])
  );

  const openOrdersByItemLocation = new Map<string, OpenSupplyOrder[]>();
  const pushOrder = (key: string, order: OpenSupplyOrder) => {
    const list = openOrdersByItemLocation.get(key) ?? [];
    list.push(order);
    openOrdersByItemLocation.set(key, list);
  };
  // A Planned purchase order is released once, for whichever of its lines
  // needs it first — every line's Release carries that date.
  const releaseByPurchaseOrder = new Map<string, PlannedOrderRelease>();
  for (const line of poLineRows) {
    if (line.status !== "Planned" || !line.purchaseOrderId) continue;
    if ((Number(line.quantityToReceive) || 0) <= 0) continue;
    const dueDate = purchaseOrderLineArrivalDate(line, todayDate);
    const leadTime = Number(line.leadTime) || 0;
    releaseByPurchaseOrder.set(
      line.purchaseOrderId,
      earlierRelease(releaseByPurchaseOrder.get(line.purchaseOrderId), {
        date: releaseByDate(dueDate, leadTime),
        dueDate,
        leadTime
      })
    );
  }

  for (const line of poLineRows) {
    if (!line.id || !line.itemId || !line.locationId) continue;
    const quantity = Number(line.quantityToReceive) || 0;
    if (quantity <= 0) continue;
    // the same arrival date the projection buckets this line on
    const dueDate = purchaseOrderLineArrivalDate(line, todayDate);
    pushOrder(`${line.itemId}${KEY_SEP}${line.locationId}`, {
      purchaseOrderLineId: line.id,
      quantity,
      dueDate,
      requiresManualAction: isCommittedPurchaseOrderStatus(line.status),
      dateIsPromised: Boolean(line.promisedDate),
      supplierId: line.supplierId,
      conversionFactor: conversionFactorByLineId.get(line.id) ?? 1,
      release:
        line.status === "Planned" && line.purchaseOrderId
          ? (releaseByPurchaseOrder.get(line.purchaseOrderId) ?? null)
          : null
    });
  }
  for (const job of jobRows) {
    if (!job.id || !job.itemId || !job.locationId) continue;
    const details = jobById.get(job.id);
    // The view's quantityToReceive is productionQuantity (quantity + scrap)
    // less received. A change action is applied to `job.quantity`, the good
    // units, so the order is measured in those: on the view's figure every
    // job with a scrap allowance read as over-supplied, got a Decrease to its
    // own quantity, and got it again after it was applied.
    const quantity = details
      ? Math.max(details.quantity - details.quantityReceivedToInventory, 0)
      : Number(job.quantityToReceive) || 0;
    if (quantity <= 0) continue;
    // the same date the projection buckets this job on — an undated job is
    // supply there, so it is supply here too
    const dueDate = jobCompletionDate(job, todayDate);
    const leadTime = Number(job.leadTime) || 0;
    pushOrder(`${job.itemId}${KEY_SEP}${job.locationId}`, {
      jobId: job.id,
      quantity,
      dueDate,
      requiresManualAction: isCommittedJobStatus(details?.status),
      release:
        details?.status === "Planned"
          ? { date: releaseByDate(dueDate, leadTime), dueDate, leadTime }
          : null
    });
  }

  // ── planning rows (projections + reorder params) per location
  const candidates: PlanningActionCandidate[] = [];

  for (const location of locations) {
    // Paged like every other read in the run: a bare RPC call stops at
    // PostgREST's max_rows, and an item missing from these rows has no
    // candidates — the diff below would then DELETE its existing actions,
    // dismissals and assignee overrides included. `id` is the item id, unique
    // per row, so the pages neither overlap nor skip.
    const [purchasing, production] = await Promise.all([
      fetchAll<RpcPlanningRow>(() =>
        client
          .rpc("get_purchasing_planning", {
            company_id: companyId,
            location_id: location.id,
            periods: periodIds
          })
          .order("id")
      ),
      fetchAll<ProductionPlanningRow>(() =>
        client
          .rpc("get_production_planning", {
            company_id: companyId,
            location_id: location.id,
            periods: periodIds
          })
          .order("id")
      )
    ]);
    if (purchasing.error) throw new Error(purchasing.error.message);
    if (production.error) throw new Error(production.error.message);

    const process = (
      row: RpcPlanningRow | ProductionPlanningRow,
      kind: "Order" | "Make"
    ) => {
      const itemLocationKey = `${row.id}${KEY_SEP}${location.id}`;
      const openOrders = openOrdersByItemLocation.get(itemLocationKey) ?? [];

      // change actions against real open documents
      const demandMap =
        demandByItemLocation.get(itemLocationKey) ?? new Map<string, number>();
      const demandPeriods = periods
        .filter((p) => (demandMap.get(p.id) ?? 0) > 0)
        .map((p) => ({
          periodId: p.id,
          startDate: p.startDate,
          quantity: demandMap.get(p.id) ?? 0
        }));

      const coverageInput = {
        onHand: onHandByItemLocation.get(itemLocationKey) ?? 0,
        demandPeriods,
        openOrders,
        periods,
        policyFloor: policyFloorFor(row)
      };
      const orderRules = orderSizingRules(
        row.supersessionMode === "Stock Only"
          ? "Stock Only"
          : row.reorderingPolicy,
        row
      );
      const leadTimeDays = Number(row.leadTime) || 0;
      const changeActions = deriveChangeActions({
        ...coverageInput,
        toleranceDays,
        todayDate,
        orderRules,
        leadTimeDays
      });

      // new-supply suggestions from the shared sizing (same math as the grid),
      // sized on the projection with every open order counted from the week
      // it is needed: every Expedite above done, and an order late within the
      // tolerance counted as on time, as the reschedule check judged it
      let sizing: ChangeCandidate[] = [];
      if (row.supersessionMode === "Stock Only") {
        const shortfall = Math.max(0, Number(row.quantityToOrder) || 0);
        const firstPeriod = periods[0];
        if (shortfall > 0 && firstPeriod) {
          const startDate = parseDate(firstPeriod.startDate)
            .subtract({ days: Number(row.leadTime) || 0 })
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
              requiresManualAction: false,
              supplierId:
                kind === "Order"
                  ? ((row as RpcPlanningRow).preferredSupplierId ?? null)
                  : null,
              policyName: "Stock Only",
              reason: "Below the minimum reserve for a superseded item",
              triggerValues: {
                projectedStock: Number(row.quantityOnHand) || 0,
                reorderPoint: Number(row.minimumReserveQuantity) || 0,
                leadTime: Number(row.leadTime) || 0
              }
            }
          ];
        }
      } else {
        const projections = projectionsWithExpedites({
          projections: periods.map((_, i) => {
            const value = row[`week${i + 1}` as keyof typeof row];
            return Number(value) || 0;
          }),
          periods,
          changeActions,
          openOrders,
          firstNeedPeriods: firstNeedPeriodByOrder(coverageInput, {
            toleranceDays,
            todayDate,
            leadTimeDays
          })
        });
        sizing = computePlanningOrders({
          reorderingPolicy: row.reorderingPolicy,
          periods,
          projections,
          todayDate,
          params: {
            reorderPoint: Number(row.reorderPoint) || 0,
            reorderQuantity: Number(row.reorderQuantity) || 0,
            minimumOrderQuantity: Number(row.minimumOrderQuantity) || 0,
            maximumOrderQuantity: Number(row.maximumOrderQuantity) || 0,
            orderMultiple: Number(row.orderMultiple) || 0,
            lotSize: Number(row.lotSize) || 0,
            maximumInventoryQuantity: Number(row.maximumInventoryQuantity) || 0,
            demandAccumulationPeriod: Number(row.demandAccumulationPeriod) || 1,
            demandAccumulationSafetyStock:
              Number(row.demandAccumulationSafetyStock) || 0,
            leadTime: Number(row.leadTime) || 0
          }
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
          requiresManualAction: false,
          supplierId:
            kind === "Order"
              ? ((row as RpcPlanningRow).preferredSupplierId ?? null)
              : null,
          policyName: order.policyName,
          reason: null,
          triggerValues: order.triggerValues
        }));
      }

      const merged = convertOrdersToIncreases({
        sizingCandidates: sizing,
        openOrders,
        changeActions,
        toleranceDays,
        todayDate,
        maximumPerOrder: orderRules.maximum,
        leadTimeDays
      });

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
          !candidate.purchaseOrderLineId &&
          !candidate.jobId;
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

      const assignee = resolveAssignee(row.id, location.id);
      for (const action of [
        ...aggregated.values(),
        ...passthrough,
        ...changeActions,
        ...releaseActions
      ]) {
        if (!action.periodId || !periodById.has(action.periodId)) continue;
        candidates.push({
          ...action,
          // Persist boundary: every source above is float arithmetic.
          suggestedQuantity: round(action.suggestedQuantity),
          itemId: row.id,
          locationId: location.id,
          assignee
        });
      }
    };

    for (const row of purchasing.data ?? []) process(row, "Order");
    for (const row of production.data ?? []) process(row, "Make");
  }

  // ── diff-write. One transaction holds a per-company advisory lock across
  // the read and the write: two runs for one company can overlap (the cron
  // racing a route-triggered run), and both reading "no row" for a natural
  // key then inserting fails the second on planningAction_natural_key_idx —
  // which rolls back the whole write. Under the lock the second run reads
  // the first run's rows and updates them in place instead.
  const diff = await db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`planning-actions:${companyId}`}, 0))`.execute(
      trx
    );

    const existingRows = await trx
      .selectFrom("planningAction")
      .select([
        "id",
        "itemId",
        "locationId",
        "periodId",
        "type",
        "status",
        "suggestedQuantity",
        "suggestedDate",
        "horizonDate",
        "latestOrderDate",
        "isASAP",
        "purchaseOrderLineId",
        "jobId",
        "requiresManualAction",
        "supplierId",
        "policyName",
        "reason",
        "triggerValues",
        "assignee",
        "assigneeOverridden"
      ])
      .where("companyId", "=", companyId)
      .where("status", "!=", "Actioned")
      .execute();

    const existing: ExistingPlanningAction[] = existingRows.map((row) => ({
      ...row,
      type: row.type as PlanningActionType,
      status: row.status as "Open" | "Dismissed",
      suggestedQuantity: Number(row.suggestedQuantity),
      suggestedDate: toIsoDate(row.suggestedDate as unknown as string | Date)!,
      horizonDate: toIsoDate(row.horizonDate as unknown as string | Date)!,
      latestOrderDate: row.latestOrderDate
        ? toIsoDate(row.latestOrderDate as unknown as string | Date)
        : null,
      triggerValues: row.triggerValues ?? null
    }));

    const diff = diffPlanningActions({
      existing,
      candidates,
      periods,
      toleranceDays
    });

    await writePlanningActionDiff(trx, {
      companyId,
      userId,
      diff,
      updatedAt: datetime.timestamp()
    });

    return diff;
  });

  logger.info("planning actions written", {
    companyId,
    inserted: diff.inserts.length,
    updated: diff.updates.length,
    deleted: diff.deleteIds.length
  });

  return {
    inserted: diff.inserts.length,
    updated: diff.updates.length,
    deleted: diff.deleteIds.length
  };
}
