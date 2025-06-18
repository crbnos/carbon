import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import type { ProductionPlanningItem } from "~/modules/production";

export function ItemReorderPolicy({
  reorderingPolicy,
  className,
}: {
  reorderingPolicy: Database["public"]["Enums"]["itemReorderingPolicy"];
  className?: string;
}) {
  switch (reorderingPolicy) {
    case "Manual Reorder":
      return (
        <Status color="gray" className={className}>
          Manual
        </Status>
      );
    case "Demand-Based Reorder":
      return (
        <Status color="blue" className={className}>
          Demand-Based{" "}
        </Status>
      );
    case "Fixed Reorder Quantity":
      return (
        <Status color="green" className={className}>
          Fixed Reorder
        </Status>
      );
    case "Maximum Quantity":
      return (
        <Status color="purple" className={className}>
          Max Quantity
        </Status>
      );
  }
}

export function getReorderPolicyDescription(
  itemPlanning: ProductionPlanningItem
) {
  const reorderPoint = itemPlanning.reorderPoint;
  switch (itemPlanning.reorderingPolicy) {
    case "Manual Reorder":
      return "Manually reorder the item";
    case "Demand-Based Reorder":
      const demandAccumulationPeriod = itemPlanning.demandAccumulationPeriod;
      return `Order to a minimum of ${demandAccumulationPeriod} days of stock`;
    case "Fixed Reorder Quantity":
      const reorderQuantity = itemPlanning.reorderQuantity;
      return `When stock is below ${reorderPoint}, order ${reorderQuantity} units`;
    case "Maximum Quantity":
      const maximumInventoryQuantity = itemPlanning.maximumInventoryQuantity;
      return `When stock is below ${reorderPoint}, order up to ${maximumInventoryQuantity} units`;
  }
}

export function getOrdersFromProductionPlanning(
  itemPlanning: ProductionPlanningItem,
  periods: { startDate: string; id: string }[]
): {
  startDate: string;
  dueDate: string;
  quantity: number;
  isASAP: boolean;
}[] {
  if (itemPlanning.reorderingPolicy === "Manual Reorder") {
    return [];
  }

  const orders: {
    startDate: string;
    dueDate: string;
    quantity: number;
    isASAP: boolean;
  }[] = [];

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
    reorderQuantity,
  } = itemPlanning;

  const todaysDate = today(getLocalTimeZone());
  let orderedQuantity = 0;

  switch (itemPlanning.reorderingPolicy) {
    case "Demand-Based Reorder":
      // Process periods in chunks of demandAccumulationPeriod
      for (let i = 0; i < periods.length; i += demandAccumulationPeriod) {
        const currentPeriod = periods[i];

        // Get the projection for this period
        const periodKey = `week${i + 1}` as keyof ProductionPlanningItem;
        const projection = (itemPlanning[periodKey] as number) || 0;

        // If projection plus ordered quantity is below safety stock, create order
        if (projection + orderedQuantity < demandAccumulationSafetyStock) {
          let remainingQuantityNeeded =
            demandAccumulationSafetyStock - (projection + orderedQuantity);
          let dayOffset = 0;

          while (remainingQuantityNeeded > 0) {
            // Apply lot sizing rules
            let orderQuantity = Math.max(
              Math.min(
                remainingQuantityNeeded,
                lotSize > 0
                  ? lotSize // If lotSize exists, use it as maximum
                  : maximumOrderQuantity > 0
                  ? maximumOrderQuantity
                  : Infinity
              ),
              minimumOrderQuantity
            );

            if (orderMultiple > 0) {
              orderQuantity =
                Math.ceil(orderQuantity / orderMultiple) * orderMultiple;
            }

            if (lotSize > 0) {
              orderQuantity = Math.min(lotSize, orderQuantity);
            }

            const dueDate = parseDate(currentPeriod.startDate).add({
              days: dayOffset,
            });
            const startDate = dueDate.subtract({ days: leadTime });

            orders.push({
              startDate: startDate.toString(),
              dueDate: dueDate.toString(),
              quantity: orderQuantity,
              isASAP: startDate.compare(todaysDate) < 0,
            });

            orderedQuantity += orderQuantity;
            remainingQuantityNeeded -= orderQuantity;
            dayOffset++;
          }
        }
      }

      return orders;
    case "Fixed Reorder Quantity":
      for (let i = 0; i < periods.length; i++) {
        const period = periods[i];
        const periodKey = `week${i + 1}` as keyof ProductionPlanningItem;
        const projectedQuantity = (itemPlanning[periodKey] as number) || 0;

        // Check if we need to order based on reorder point
        let remainingQuantityNeeded =
          reorderPoint - (projectedQuantity + orderedQuantity);

        let day = 0;
        while (remainingQuantityNeeded > 0 && day < 5) {
          const dueDate = parseDate(period.startDate).add({ days: day });
          const startDate = dueDate.subtract({
            days: leadTime,
          });

          orders.push({
            startDate: startDate.toString(),
            dueDate: dueDate.toString(),
            quantity: reorderQuantity,
            isASAP: startDate.compare(todaysDate) < 0,
          });
          day++;
          orderedQuantity += reorderQuantity;
          remainingQuantityNeeded =
            reorderPoint - (projectedQuantity + orderedQuantity);
        }
      }

      return orders;
    case "Maximum Quantity":
      for (let i = 0; i < periods.length; i++) {
        const period = periods[i];
        const periodKey = `week${i + 1}` as keyof ProductionPlanningItem;
        const projectedQuantity = (itemPlanning[periodKey] as number) || 0;

        // Check if we need to order based on reorder point
        let remainingQuantityNeeded =
          reorderPoint - (projectedQuantity + orderedQuantity);

        let day = 0;
        while (remainingQuantityNeeded > 0 && day < 5) {
          const dueDate = parseDate(period.startDate).add({ days: day });
          const startDate = dueDate.subtract({
            days: leadTime,
          });

          // Calculate required quantity up to maximum inventory
          const requiredQuantity =
            maximumInventoryQuantity - (projectedQuantity + orderedQuantity);

          // Adjust quantity based on order constraints
          let orderQuantity = Math.max(minimumOrderQuantity, requiredQuantity);

          // Round to nearest multiple if specified
          if (orderMultiple && orderMultiple > 1) {
            orderQuantity =
              Math.ceil(orderQuantity / orderMultiple) * orderMultiple;
          }

          // Only apply lot size if it's greater than 0
          if (lotSize > 0) {
            orderQuantity = Math.ceil(orderQuantity / lotSize) * lotSize;
          }

          // Apply maximum order quantity only if it's greater than 0
          if (maximumOrderQuantity > 0) {
            orderQuantity = Math.min(orderQuantity, maximumOrderQuantity);
          }

          orders.push({
            startDate: startDate.toString(),
            dueDate: dueDate.toString(),
            quantity: orderQuantity,
            isASAP:
              startDate.compare(todaysDate) < 0 &&
              projectedQuantity + orderedQuantity < 0,
          });
          day++;
          orderedQuantity += orderQuantity;
          remainingQuantityNeeded =
            reorderPoint - (projectedQuantity + orderedQuantity);
        }
      }
      return orders;
    default:
      return orders;
  }
}
