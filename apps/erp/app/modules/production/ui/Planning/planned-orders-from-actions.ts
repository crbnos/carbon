// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure helpers that turn the persisted MRP worklist into the order drawer's
// suggested orders. No JSX, no lingui — unit-tested by
// apps/erp/test/planned-orders-from-actions.test.ts.
//
// The planning action is the source of truth for a suggestion (spec §P1.8).
// The drawer and the grid's Order / Make button used to size orders again in
// the browser from the weekly projections, and missed what MRP does after
// sizing: it moves expedited supply, folds a shortfall into an open order as
// an Increase, and sums each week into one action. The two lists then
// disagreed, and ordering from the drawer bought the Increase's quantity a
// second time.

import type { Database, Json } from "@carbon/database";
import {
  equals,
  type OrderSizingParams,
  orderSizingRules,
  plannedOrderWeekIndex,
  RoundingMode,
  round,
  splitIntoOrders
} from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { z } from "zod";
import type {
  ProductionOrder,
  RefusedPlanningOrder
} from "~/modules/production/production.models";
import type { PlannedOrder } from "~/modules/purchasing/purchasing.models";
import { planningRowKey } from "./planning-action-scope";

type NewSupplyActionFields = {
  id: string;
  type: Database["public"]["Enums"]["planningActionType"];
  status: Database["public"]["Enums"]["planningActionStatus"];
  purchaseOrderLineId: string | null;
  jobId: string | null;
  periodId: string;
  suggestedQuantity: number;
  suggestedDate: string;
  latestOrderDate: string | null;
  isASAP: boolean;
  supplierId: string | null;
  policyName: string | null;
  reason: string | null;
  triggerValues: Json | null;
};

/**
 * The item's open suggestions for NEW supply of one kind: an Order (buy) or a
 * Make (job) with no order or job behind it. A dismissed suggestion is the
 * planner's "no", so it never seeds the drawer.
 */
export function openNewSupplyActions<A extends NewSupplyActionFields>(
  actions: A[] | undefined,
  type: "Order" | "Make"
): A[] {
  return (actions ?? []).filter(
    (action) =>
      action.type === type &&
      action.status === "Open" &&
      !action.purchaseOrderLineId &&
      !action.jobId
  );
}

/** The item's sizing fields, as the planning grid row carries them. */
export type ItemOrderSizing = {
  [K in keyof OrderSizingParams]?: number | null;
};

/**
 * An action's orders. MRP sums the orders a week needs into one action (one
 * per item and week), so it is split back into the orders its policy sized
 * (`splitIntoOrders` by the action's own `policyName`): Demand-Based Reorder
 * one per batch spread across the week, Fixed Reorder Quantity one of that
 * quantity per day, Maximum Quantity one of at most the maximum order
 * quantity per day.
 */
function ordersOf(
  action: NewSupplyActionFields,
  item: ItemOrderSizing,
  todayDate?: string
) {
  const startDate = action.latestOrderDate ?? action.suggestedDate;
  const rules = orderSizingRules(action.policyName, {
    reorderPoint: Number(item.reorderPoint) || 0,
    reorderQuantity: Number(item.reorderQuantity) || 0,
    minimumOrderQuantity: Number(item.minimumOrderQuantity) || 0,
    maximumOrderQuantity: Number(item.maximumOrderQuantity) || 0,
    orderMultiple: Number(item.orderMultiple) || 0,
    lotSize: Number(item.lotSize) || 0
  });
  return splitIntoOrders(Number(action.suggestedQuantity), rules).map(
    (batch) => {
      const orderStart = parseDate(startDate)
        .add({ days: batch.dayOffset })
        .toString();
      return {
        quantity: batch.quantity,
        startDate: orderStart,
        dueDate: parseDate(action.suggestedDate)
          .add({ days: batch.dayOffset })
          .toString(),
        isASAP: isOrderASAP(action, orderStart, todayDate)
      };
    }
  );
}

/**
 * A planned order the suggestions stand for: one of the row's item, location
 * and type, in the common segment (`getRowPlannedOrders`).
 */
export type SuggestablePlannedOrder = {
  id: string;
  status: string;
  periodId: string;
  quantity: number | string;
  dueDate: string;
  releaseDate: string;
  splitIndex?: number | null;
};

/** One of the planning page's weeks, in order; the first holds today. */
export type PlanningWeek = { id: string; startDate: string; endDate: string };

/** A planning action of the row, as far as it names a planned order. */
export type RowPlanningAction = {
  type: string;
  status: string;
  plannedOrderId?: string | null;
};

/** Where a week's planned orders come from. */
type PlannedOrderContext = {
  plannedOrders?: SuggestablePlannedOrder[];
  /** Every action of the row: a Cancel on a planned order leaves it out. */
  rowActions?: RowPlanningAction[];
  weeks?: PlanningWeek[];
  /** Today on the location's calendar (else the first week's start). */
  todayDate?: string;
};

/**
 * The planned orders MRP is cancelling. MRP leaves a held order it cancels
 * out of its week's Order / Make total, so offering it would order it again.
 * A dismissed Cancel counts too: the dismissal does not put the order back in
 * the total.
 */
function plannedOrdersBeingCancelled(
  actions: RowPlanningAction[] | undefined
): Set<string> {
  return new Set(
    (actions ?? []).flatMap((action) =>
      action.type === "Cancel" &&
      (action.status === "Open" || action.status === "Dismissed") &&
      action.plannedOrderId
        ? [action.plannedOrderId]
        : []
    )
  );
}

/**
 * The unconverted planned orders of an action's week, in the order MRP split
 * them: by due date, then `splitIndex`. A planned order counts in the week
 * `plannedOrderWeekIndex` gives it (overdue in the first week, else the week
 * of its due date) — MRP's own rule — and not in its stored week. One MRP is
 * cancelling is left out. An action whose week is not on the page has none.
 */
function plannedOrdersOfWeek(
  action: NewSupplyActionFields,
  context: PlannedOrderContext
): SuggestablePlannedOrder[] {
  // the page's weeks in date order, so the first is the one holding today
  const weeks = [...(context.weeks ?? [])].sort((a, b) =>
    a.startDate.localeCompare(b.startDate)
  );
  const index = weeks.findIndex((week) => week.id === action.periodId);
  if (index < 0) return [];
  const today = context.todayDate ?? weeks[0].startDate;
  const cancelled = plannedOrdersBeingCancelled(context.rowActions);
  return (context.plannedOrders ?? [])
    .filter(
      (order) =>
        (order.status === "Planned" || order.status === "Firm") &&
        !cancelled.has(order.id) &&
        plannedOrderWeekIndex(order.dueDate, weeks, today) === index
    )
    .sort(
      (a, b) =>
        a.dueDate.localeCompare(b.dueDate) ||
        (a.splitIndex ?? 0) - (b.splitIndex ?? 0) ||
        a.id.localeCompare(b.id)
    );
}

/**
 * An action's orders: one per unconverted planned order of its week when
 * they add up to the action, else the action split by its policy
 * (`ordersOf`). When they do not add up (an order placed since the run, a
 * planned order changed), the split names no planned order and the order
 * placed converts one by quantity.
 */
function suggestionsOf(
  action: NewSupplyActionFields,
  item: ItemOrderSizing,
  asapToday: string | undefined,
  context: PlannedOrderContext
): {
  quantity: number;
  startDate: string;
  dueDate: string;
  isASAP: boolean;
  plannedOrderId?: string;
}[] {
  const week = plannedOrdersOfWeek(action, context);
  const total = week.reduce((sum, order) => sum + Number(order.quantity), 0);
  if (week.length === 0 || !equals(total, Number(action.suggestedQuantity))) {
    return ordersOf(action, item, asapToday);
  }
  return week.map((order) => ({
    quantity: Number(order.quantity),
    startDate: order.releaseDate,
    dueDate: order.dueDate,
    isASAP: isOrderASAP(action, order.releaseDate, asapToday),
    plannedOrderId: order.id
  }));
}

/**
 * Whether an order must start at once: its own start date has passed, judged
 * against today on the page. MRP stores one flag per week (any of the week's
 * orders) as of its run, so every batch of the week became an ASAP job, and a
 * job raised after its start had passed could still be a Soft Deadline.
 * Maximum Quantity also requires the stock to be short, which only the run
 * knows. Without today the stored flag is all there is.
 */
function isOrderASAP(
  action: Pick<NewSupplyActionFields, "isASAP" | "policyName">,
  orderStart: string,
  todayDate: string | undefined
): boolean {
  if (!todayDate) return action.isASAP;
  // ISO dates order as strings
  const late = orderStart < todayDate;
  return action.policyName === "Maximum Quantity"
    ? late && action.isASAP
    : late;
}

/**
 * The job suggestions of each open Make action, in the item's own units, each
 * with the action's policy attribution for the chart's order popover: one per
 * Make planned order of the action's week (its quantity, dates and
 * `plannedOrderId`), else the jobs the action's policy sized.
 */
export function productionOrdersFromActions(
  actions: NewSupplyActionFields[],
  context: {
    /** The item's sizing fields. */
    item?: ItemOrderSizing;
    /** Today on the location's calendar, to judge each job's ASAP and the
     *  week an overdue planned order counts in. */
    todayDate?: string;
    /** The row's Make planned orders (none outside the common segment). */
    plannedOrders?: SuggestablePlannedOrder[];
    /** Every planning action of the row. */
    rowActions?: RowPlanningAction[];
    /** The page's weeks: a planned order counts in the week of its due date. */
    weeks?: PlanningWeek[];
  } = {}
): ProductionOrder[] {
  return actions.flatMap((action) =>
    suggestionsOf(action, context.item ?? {}, context.todayDate, context).map(
      (batch) => ({
        startDate: batch.startDate,
        dueDate: batch.dueDate,
        periodId: action.periodId,
        quantity: batch.quantity,
        isASAP: batch.isASAP,
        planningActionId: action.id,
        plannedOrderId: batch.plannedOrderId,
        policyName: action.policyName ?? undefined,
        reason: action.reason ?? undefined,
        triggerValues: triggerValuesOf(action.triggerValues)
      })
    )
  );
}

/**
 * The purchase suggestions of each open Order action: one per Buy planned
 * order of the action's week (its quantity, dates and `plannedOrderId`), else
 * the orders the action's policy sized. Quantities are in inventory units
 * there; each order is in the supplier's purchase units, rounded up to a
 * whole unit.
 */
export function plannedOrdersFromActions(
  actions: NewSupplyActionFields[],
  context: {
    /** Inventory units in one purchase unit, from the chosen supplier part. */
    conversionFactor: number;
    /** The item's sizing fields, in inventory units. */
    item?: ItemOrderSizing;
    /** The supplier chosen for the row; the action's own supplier otherwise. */
    supplierId?: string | null;
    itemReadableId?: string;
    description?: string;
    unitOfMeasureCode?: string;
    /** The row's Buy planned orders (none outside the common segment). */
    plannedOrders?: SuggestablePlannedOrder[];
    /** Every planning action of the row. */
    rowActions?: RowPlanningAction[];
    /** The page's weeks: a planned order counts in the week of its due date. */
    weeks?: PlanningWeek[];
    /** Today on the location's calendar: the week an overdue planned order
     *  counts in. A purchase order has no ASAP. */
    todayDate?: string;
  }
): PlannedOrder[] {
  const { conversionFactor } = context;
  return actions.flatMap((action) =>
    suggestionsOf(action, context.item ?? {}, undefined, context).map(
      (batch) => ({
        startDate: batch.startDate,
        dueDate: batch.dueDate,
        periodId: action.periodId,
        quantity:
          conversionFactor > 0
            ? round(batch.quantity / conversionFactor, 0, RoundingMode.Up)
            : batch.quantity,
        supplierId: context.supplierId ?? action.supplierId ?? undefined,
        planningActionId: action.id,
        plannedOrderId: batch.plannedOrderId,
        itemReadableId: context.itemReadableId,
        description: context.description,
        unitOfMeasureCode: context.unitOfMeasureCode,
        policyName: action.policyName ?? undefined,
        reason: action.reason ?? undefined,
        triggerValues: triggerValuesOf(action.triggerValues)
      })
    )
  );
}

/** MRP writes the policy's trigger values as a flat object of numbers. */
function triggerValuesOf(value: Json | null): PlannedOrder["triggerValues"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const numbers: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number") numbers[key] = entry;
  }
  return numbers;
}

const supplierPartsValidator = z.array(
  z.object({ supplierId: z.string(), conversionFactor: z.number() })
);

/**
 * Inventory units in one purchase unit for the chosen supplier, read from the
 * planning row's supplier parts; 1 when the supplier has no part for the item.
 */
export function supplierConversionFactor(
  suppliers: unknown,
  supplierId: string | null | undefined
): number {
  const parts = supplierPartsValidator.safeParse(suppliers);
  return (
    parts.data?.find((part) => part.supplierId === supplierId)
      ?.conversionFactor ?? 1
  );
}

/** A planning row's orders Make / Order refused for starting in the past
 *  (`refusedOrders`), as they were sent: a refused row keeps its edits, and a
 *  row the planner added has no suggestion to come back from. */
export function refusedOrdersOfRow<O>(
  row: { id: string; planningSegmentId?: string | null; orders: O[] },
  refused: RefusedPlanningOrder[] | null | undefined
): O[] {
  return (refused ?? []).flatMap((order) => {
    if (
      order.itemId !== row.id ||
      order.planningSegmentId !== (row.planningSegmentId ?? "")
    ) {
      return [];
    }
    const sent = row.orders[order.index];
    return sent ? [sent] : [];
  });
}

/** The drafts a bulk Make / Order leaves: each row's refused orders, and no
 *  draft for a row with none, so its drawer re-seeds from the suggestions. */
export function draftsOfRefusedOrders<O>(
  rows: { id: string; planningSegmentId?: string | null; orders: O[] }[],
  refused: RefusedPlanningOrder[] | null | undefined
): Record<string, O[]> {
  return Object.fromEntries(
    rows.flatMap((row) => {
      const orders = refusedOrdersOfRow(row, refused);
      return orders.length > 0 ? [[planningRowKey(row), orders]] : [];
    })
  );
}

/** The drafts without this row's, so its drawer re-seeds from the suggestions.
 *  The same object when the row has none. */
export function withoutRowDraft<O>(
  drafts: Record<string, O[]>,
  row: { id: string; planningSegmentId?: string | null }
): Record<string, O[]> {
  const key = planningRowKey(row);
  if (!(key in drafts)) return drafts;
  const { [key]: _dropped, ...rest } = drafts;
  return rest;
}
