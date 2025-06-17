import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";
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
  switch (itemPlanning.reorderingPolicy) {
    case "Manual Reorder":
      return "Manually reorder the item";
    case "Demand-Based Reorder":
      return "Demand-Based";
    case "Fixed Reorder Quantity":
      const reorderPoint = itemPlanning.reorderPoint;
      const reorderQuantity = itemPlanning.reorderQuantity;

      const orderMultiple = itemPlanning.orderMultiple;
      const minimumOrderQuantity = Math.min(
        itemPlanning.minimumOrderQuantity ?? 0,
        reorderQuantity
      );
      const maximumOrderQuantity = Math.min(
        itemPlanning.maximumOrderQuantity ?? 0,
        reorderQuantity
      );

      return "Fixed Reorder Quantity";
    case "Maximum Quantity":
      return "Max Quantity";
  }
}
