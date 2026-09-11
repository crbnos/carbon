// Reorder-quantity sizing shared by the MRP engine (@carbon/ee/planning) and the
// client planning calculator (ItemReorderPolicy.tsx). Ported 1:1 from the client
// `calculateOrders` four-policy math, which itself mirrors the SQL
// `calculate_quantity_to_order` (20260324120000_planning-quantity-to-order.sql).
// A parity test pins this module against hand-computed SQL results
// (planning-sizing.test.ts) — do NOT "improve" the math here without updating
// all three copies together.
//
// Pure and clock-free: `todayDate` is injected by the caller (client: local
// today; server: datetime.today(companyTimeZone)) so this module never reads a
// timezone. No React, no DB, no app imports.

import { parseDate } from "@internationalized/date";
import { RoundingMode, round } from "./precision";

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
      for (let i = 0; i < periods.length; i += demandAccumulationPeriod) {
        const windowEnd = Math.min(
          i + demandAccumulationPeriod,
          periods.length
        );

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

        // If we have a lot size and need to split orders
        if (lotSize > 0 && totalOrderQuantity > lotSize) {
          const numberOfBatches = ceilUnits(totalOrderQuantity / lotSize);
          const daysInPeriod = 7; // Weekly periods

          for (let batch = 0; batch < numberOfBatches; batch++) {
            const batchQuantity = Math.min(
              lotSize,
              totalOrderQuantity - batch * lotSize
            );

            // Spread due dates evenly across the period (integer floor —
            // mirrors the original Math.floor without a raw-rounding call)
            const dueDateOffset = intFloorDiv(
              batch * daysInPeriod,
              numberOfBatches
            );
            const dueDate = parseDate(currentPeriod.startDate).add({
              days: dueDateOffset
            });
            const startDate = dueDate.subtract({ days: leadTime });

            orders.push({
              startDate: startDate.toString(),
              dueDate: dueDate.toString(),
              quantity: batchQuantity,
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
        } else {
          // Single order for the period
          const orderQuantity =
            lotSize > 0
              ? Math.min(totalOrderQuantity, lotSize)
              : totalOrderQuantity;

          const dueDate = parseDate(currentPeriod.startDate);
          const startDate = dueDate.subtract({ days: leadTime });

          orders.push({
            startDate: startDate.toString(),
            dueDate: dueDate.toString(),
            quantity: orderQuantity,
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
