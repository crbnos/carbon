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
  const leadTime = itemPlanning.leadTime;
  const todaysDate = today(getLocalTimeZone());

  switch (itemPlanning.reorderingPolicy) {
    case "Demand-Based Reorder":
      return orders;
    case "Fixed Reorder Quantity":
      const reorderPoint = itemPlanning.reorderPoint;
      const reorderQuantity = itemPlanning.reorderQuantity;
      let orderedQuantity = 0;
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
          const startDate = parseDate(period.startDate).subtract({
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
      return orders;
    default:
      return orders;
  }
}
