// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Reorder-quantity sizing used by the MRP engine (@carbon/planning) when it
// writes Order / Make planning actions; the planning pages list those actions
// rather than sizing again. The math mirrors the SQL
// `calculate_quantity_to_order` (20260324120000_planning-quantity-to-order.sql).
// A parity test pins this module against hand-computed SQL results
// (planning-sizing.test.ts) — do NOT "improve" the math here without updating
// the SQL copy too.
//
// Pure and clock-free: `todayDate` is injected by the caller
// (datetime.today(companyTimeZone)) so this module never reads a timezone. No
// React, no DB, no app imports.

import { RoundingMode, round } from "@carbon/database/precision";
import { parseDate } from "@internationalized/date";

export type PlanningSizingParams = {
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

export type PlanningOrderSuggestion = {
  periodId: string;
  startDate: string;
  dueDate: string;
  quantity: number;
  isASAP: boolean;
  policyName: string;
  triggerValues: {
    projectedStock?: number;
    safetyStock?: number;
    reorderPoint?: number;
    reorderQuantity?: number;
    lotSize?: number;
    leadTime?: number;
  };
};

export type ComputePlanningOrdersInput = {
  reorderingPolicy: string;
  periods: { id: string; startDate: string }[];
  /** Per-period projected on-hand (week1..weekN), same order as `periods`. */
  projections: number[];
  /** ISO calendar date (YYYY-MM-DD). Caller supplies "today" — keeps this pure. */
  todayDate: string;
  params: PlanningSizingParams;
};

/** Away-from-zero ceil to the next multiple (float-artifact-immune). */
const ceilToMultiple = (value: number, multiple: number): number =>
  round(value / multiple, 0, RoundingMode.Up) * multiple;

/** Whole-unit ceil. */
const ceilUnits = (value: number): number => round(value, 0, RoundingMode.Up);

/** Integer floor of a non-negative integer division (a, b integers, b > 0). */
const intFloorDiv = (a: number, b: number): number => (a - (a % b)) / b;

/** Weekly planning periods. */
const DAYS_IN_PERIOD = 7;

export type PlannedOrderSplit = {
  quantity: number;
  /** Days after the week's first order this one is due. */
  dayOffset: number;
};

/**
 * One order per batch: an order larger than the batch size (`lotSize`) is
 * made in full batches with the remainder last, due dates spread evenly across
 * the week. A batch size of 0, or an order that fits in one batch, is one
 * order. How Demand-Based Reorder splits its order.
 */
export function lotSizeBatches(
  quantity: number,
  lotSize: number
): PlannedOrderSplit[] {
  if (!(lotSize > 0) || quantity <= lotSize) {
    return [{ quantity, dayOffset: 0 }];
  }
  const numberOfBatches = ceilUnits(quantity / lotSize);
  return Array.from({ length: numberOfBatches }, (_, batch) => ({
    quantity: Math.min(lotSize, quantity - batch * lotSize),
    // integer floor — mirrors the original Math.floor without a raw-rounding call
    dayOffset: intFloorDiv(batch * DAYS_IN_PERIOD, numberOfBatches)
  }));
}

export type OrderSizingParams = Pick<
  PlanningSizingParams,
  | "reorderPoint"
  | "reorderQuantity"
  | "minimumOrderQuantity"
  | "maximumOrderQuantity"
  | "orderMultiple"
  | "lotSize"
>;

/**
 * How ONE order of a reordering policy is sized — the same rules
 * `computePlanningOrders` applies, stated once so what happens after sizing
 * keeps them:
 * - `perOrder`: the quantity one order holds when a need takes several —
 *   the batch size (Demand-Based Reorder), the fixed reorder quantity, or the
 *   maximum order quantity (Maximum Quantity). 0: one order of any size.
 * - `daily`: several orders in a week fall one per day (Fixed Reorder
 *   Quantity, Maximum Quantity), not spread across it (batches).
 * - `maximum`: the most one order may hold. 0: no limit.
 * - `minimum` / `multiples`: the least an order holds, and what it is a whole
 *   multiple of.
 *
 * MRP keeps one Order / Make action per item and week, so the orders a week
 * needs are summed into it; the planning pages split it back by `perOrder`
 * (`splitIntoOrders`). An Increase may not grow an order past `maximum`, and
 * a Decrease keeps `minimum` and `multiples` (`reducedOrderQuantity`).
 * Stock Only, Manual Reorder and an unknown policy size by none of them.
 */
export function orderSizingRules(
  policyName: string | null | undefined,
  params: OrderSizingParams
): {
  perOrder: number;
  daily: boolean;
  maximum: number;
  minimum: number;
  multiples: number[];
} {
  const lotSize = Number(params.lotSize) || 0;
  const maximumOrderQuantity = Number(params.maximumOrderQuantity) || 0;
  const minimumOrderQuantity = Number(params.minimumOrderQuantity) || 0;
  const orderMultiple = Number(params.orderMultiple) || 0;
  switch (policyName) {
    case "Demand-Based Reorder": {
      const limits = [lotSize, maximumOrderQuantity].filter((n) => n > 0);
      return {
        perOrder: lotSize,
        daily: false,
        maximum: limits.length > 0 ? Math.min(...limits) : 0,
        minimum: minimumOrderQuantity,
        multiples: [orderMultiple]
      };
    }
    case "Fixed Reorder Quantity": {
      const reorderQuantity = Number(params.reorderQuantity) || 0;
      // as computePlanningOrders: no reorder quantity orders the reorder point
      const fixed =
        reorderQuantity > 0
          ? reorderQuantity
          : Number(params.reorderPoint) || 0;
      return {
        perOrder: fixed,
        daily: true,
        maximum: fixed,
        minimum: 0,
        multiples: [fixed]
      };
    }
    case "Maximum Quantity":
      return {
        perOrder: maximumOrderQuantity,
        daily: true,
        maximum: maximumOrderQuantity,
        minimum: minimumOrderQuantity,
        // as computePlanningOrders: a multiple of 1 is no rule
        multiples: [orderMultiple > 1 ? orderMultiple : 0, lotSize]
      };
    default:
      return {
        perOrder: 0,
        daily: false,
        maximum: 0,
        minimum: 0,
        multiples: []
      };
  }
}

/**
 * A week's summed Order / Make quantity split back into the orders its policy
 * sizes: full orders of `perOrder` with the remainder last, one per day
 * (`daily`) or spread across the week (batches).
 */
export function splitIntoOrders(
  quantity: number,
  rules: Pick<ReturnType<typeof orderSizingRules>, "perOrder" | "daily">
): PlannedOrderSplit[] {
  const split = lotSizeBatches(quantity, rules.perOrder);
  if (!rules.daily) return split;
  return split.map((order, index) => ({
    ...order,
    dayOffset: Math.min(index, DAYS_IN_PERIOD - 1)
  }));
}

/**
 * What an open order may be reduced to when only `required` of it is needed:
 * at least the policy's minimum and a whole multiple of each of its multiples.
 * Never more than `current`, the order as it stands.
 */
export function reducedOrderQuantity(
  required: number,
  current: number,
  rules: Pick<ReturnType<typeof orderSizingRules>, "minimum" | "multiples">
): number {
  let quantity = Math.max(required, rules.minimum);
  for (const multiple of rules.multiples) {
    if (multiple > 0) quantity = ceilToMultiple(quantity, multiple);
  }
  return Math.min(quantity, current);
}

export function computePlanningOrders(
  input: ComputePlanningOrdersInput
): PlanningOrderSuggestion[] {
  const { reorderingPolicy, periods, projections, todayDate, params } = input;
  const {
    demandAccumulationPeriod,
    demandAccumulationSafetyStock,
    leadTime,
    lotSize,
    maximumInventoryQuantity,
    maximumOrderQuantity,
    minimumOrderQuantity,
    orderMultiple,
    reorderPoint,
    reorderQuantity
  } = params;

  const orders: PlanningOrderSuggestion[] = [];

  if (reorderingPolicy === "Manual Reorder") return orders;

  const todaysDate = parseDate(todayDate);
  let orderedQuantity = 0;

  switch (reorderingPolicy) {
    case "Demand-Based Reorder": {
      // Process periods in chunks of demandAccumulationPeriod.
      //
      // End-of-window sizing: only fire an order when the LAST period in the
      // window dips below safety stock, and size it to lift the end-of-window
      // projection back to safety. Mirrors the SQL `calculate_quantity_to_order`
      // DBR branch exactly.
      //
      // A window of at least one week: the form refuses 0, but an import or
      // an API write can store it (or null, which arrives as NaN), and a step
      // of 0 never ends this loop — one such item froze the planning page.
      const windowLength = Math.max(
        1,
        round(Number(demandAccumulationPeriod) || 1, 0, RoundingMode.Down)
      );
      for (let i = 0; i < periods.length; i += windowLength) {
        const windowEnd = Math.min(i + windowLength, periods.length);

        // Track first dip (for the order's trigger date) AND walk end-of-window
        // projection (for sizing).
        let firstDipIndex = -1;
        let endOfWindowProjection = 0;
        for (let j = i; j < windowEnd; j++) {
          const periodProjection = projections[j] || 0;
          const effective = periodProjection + orderedQuantity;
          if (
            firstDipIndex === -1 &&
            effective < demandAccumulationSafetyStock
          ) {
            firstDipIndex = j;
          }
          endOfWindowProjection = effective;
        }

        // Skip the window unless end-of-window is below safety.
        if (endOfWindowProjection >= demandAccumulationSafetyStock) continue;
        // Defensive: fall back to window start so we never emit an undated order.
        if (firstDipIndex === -1) firstDipIndex = i;

        const currentPeriod = periods[firstDipIndex];
        if (!currentPeriod) continue;

        let totalOrderQuantity = Math.max(
          0,
          demandAccumulationSafetyStock - endOfWindowProjection
        );

        // Apply lot sizing rules
        if (maximumOrderQuantity > 0) {
          totalOrderQuantity = Math.min(
            totalOrderQuantity,
            maximumOrderQuantity
          );
        }
        totalOrderQuantity = Math.max(totalOrderQuantity, minimumOrderQuantity);

        if (orderMultiple > 0) {
          totalOrderQuantity = ceilToMultiple(
            totalOrderQuantity,
            orderMultiple
          );
        }

        // One order per batch, due dates spread across the period
        for (const batch of lotSizeBatches(totalOrderQuantity, lotSize)) {
          const dueDate = parseDate(currentPeriod.startDate).add({
            days: batch.dayOffset
          });
          const startDate = dueDate.subtract({ days: leadTime });

          orders.push({
            startDate: startDate.toString(),
            dueDate: dueDate.toString(),
            quantity: batch.quantity,
            periodId: currentPeriod.id,
            isASAP: startDate.compare(todaysDate) < 0,
            policyName: "Demand-Based Reorder",
            triggerValues: {
              projectedStock: endOfWindowProjection,
              safetyStock: demandAccumulationSafetyStock,
              lotSize,
              leadTime
            }
          });
        }

        orderedQuantity += totalOrderQuantity;
      }
      return orders;
    }
    case "Fixed Reorder Quantity": {
      for (let i = 0; i < periods.length; i++) {
        const period = periods[i];
        if (!period) continue;
        const projectedQuantity = projections[i] || 0;

        let remainingQuantityNeeded =
          reorderPoint - (projectedQuantity + orderedQuantity);

        let day = 0;
        let maxIterations = 100; // Safety counter
        while (remainingQuantityNeeded > 0 && day < 5 && maxIterations-- > 0) {
          const dueDate = parseDate(period.startDate).add({ days: day });
          const startDate = dueDate.subtract({ days: leadTime });

          // If reorder quantity is 0, order the same quantity as the reorder point
          const orderQuantity =
            reorderQuantity > 0 ? reorderQuantity : reorderPoint;

          // Both left at 0 on a short item: ordering 0 covers nothing, so the
          // loop emitted an "Order 0" for every short day and week. Nothing to
          // size from — suggest nothing, as Maximum Quantity does.
          if (orderQuantity <= 0) break;

          orders.push({
            startDate: startDate.toString(),
            dueDate: dueDate.toString(),
            quantity: orderQuantity,
            periodId: period.id,
            isASAP: startDate.compare(todaysDate) < 0,
            policyName: "Fixed Reorder Quantity",
            triggerValues: {
              projectedStock: projectedQuantity + orderedQuantity,
              reorderPoint,
              reorderQuantity,
              leadTime
            }
          });
          day++;
          orderedQuantity += orderQuantity;
          remainingQuantityNeeded =
            reorderPoint - (projectedQuantity + orderedQuantity);
        }
      }
      return orders;
    }
    case "Maximum Quantity": {
      for (let i = 0; i < periods.length; i++) {
        const period = periods[i];
        if (!period) continue;
        const projectedQuantity = projections[i] || 0;

        let remainingQuantityNeeded =
          reorderPoint - (projectedQuantity + orderedQuantity);

        let day = 0;
        let maxIterations = 100; // Safety counter
        while (remainingQuantityNeeded > 0 && day < 5 && maxIterations-- > 0) {
          const dueDate = parseDate(period.startDate).add({ days: day });
          const startDate = dueDate.subtract({ days: leadTime });

          // Calculate required quantity up to maximum inventory
          const requiredQuantity =
            maximumInventoryQuantity - (projectedQuantity + orderedQuantity);

          // If reorder quantity is 0, use reorder point as the base order quantity
          let orderQuantity =
            reorderQuantity > 0
              ? Math.max(minimumOrderQuantity, requiredQuantity)
              : reorderPoint;

          // Ensure orderQuantity is positive to prevent infinite loop
          if (orderQuantity <= 0) break;

          // Round to nearest multiple if specified
          if (orderMultiple && orderMultiple > 1) {
            orderQuantity = ceilToMultiple(orderQuantity, orderMultiple);
          }

          // Only apply lot size if it's greater than 0
          if (lotSize > 0) {
            orderQuantity = ceilToMultiple(orderQuantity, lotSize);
          }

          // Apply maximum order quantity only if it's greater than 0
          if (maximumOrderQuantity > 0) {
            orderQuantity = Math.min(orderQuantity, maximumOrderQuantity);
          }

          orders.push({
            startDate: startDate.toString(),
            dueDate: dueDate.toString(),
            quantity: orderQuantity,
            periodId: period.id,
            isASAP:
              startDate.compare(todaysDate) < 0 &&
              projectedQuantity + orderedQuantity < 0,
            policyName: "Maximum Quantity",
            triggerValues: {
              projectedStock: projectedQuantity + orderedQuantity,
              reorderPoint,
              leadTime,
              reorderQuantity
            }
          });
          day++;
          orderedQuantity += orderQuantity;
          remainingQuantityNeeded =
            reorderPoint - (projectedQuantity + orderedQuantity);
        }
      }
      return orders;
    }
    default:
      return orders;
  }
}
