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
  type OrderSizingParams,
  orderSizingRules,
  RoundingMode,
  round,
  splitIntoOrders
} from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { z } from "zod";
import type { ProductionOrder } from "~/modules/production/production.models";
import type { PlannedOrder } from "~/modules/purchasing/purchasing.models";

type NewSupplyActionFields = {
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
 * The job suggestions of each open Make action — the jobs its policy sized —
 * in the item's own units, each with the action's policy attribution for the
 * chart's order popover.
 */
export function productionOrdersFromActions(
  actions: NewSupplyActionFields[],
  context: {
    /** The item's sizing fields. */
    item?: ItemOrderSizing;
    /** Today on the location's calendar, to judge each job's ASAP. */
    todayDate?: string;
  } = {}
): ProductionOrder[] {
  return actions.flatMap((action) =>
    ordersOf(action, context.item ?? {}, context.todayDate).map((batch) => ({
      startDate: batch.startDate,
      dueDate: batch.dueDate,
      periodId: action.periodId,
      quantity: batch.quantity,
      isASAP: batch.isASAP,
      policyName: action.policyName ?? undefined,
      reason: action.reason ?? undefined,
      triggerValues: triggerValuesOf(action.triggerValues)
    }))
  );
}

/**
 * The purchase suggestions of each open Order action — the orders its policy
 * sized. The action's quantity is in inventory units; each order is in the
 * supplier's purchase units, rounded up to a whole unit.
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
  }
): PlannedOrder[] {
  const { conversionFactor } = context;
  return actions.flatMap((action) =>
    ordersOf(action, context.item ?? {}).map((batch) => ({
      startDate: batch.startDate,
      dueDate: batch.dueDate,
      periodId: action.periodId,
      quantity:
        conversionFactor > 0
          ? round(batch.quantity / conversionFactor, 0, RoundingMode.Up)
          : batch.quantity,
      supplierId: context.supplierId ?? action.supplierId ?? undefined,
      itemReadableId: context.itemReadableId,
      description: context.description,
      unitOfMeasureCode: context.unitOfMeasureCode,
      policyName: action.policyName ?? undefined,
      reason: action.reason ?? undefined,
      triggerValues: triggerValuesOf(action.triggerValues)
    }))
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
