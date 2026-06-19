import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";
import { hasIncompleteJobs } from "@carbon/utils";

type SalesOrderStatusProps = {
  status?: Database["public"]["Enums"]["salesOrderStatus"] | null;
  jobs?: Array<{
    salesOrderLineId: string;
    productionQuantity: number;
    quantityComplete: number;
    status: string;
  }>;
  lines?: Array<{
    id: string;
    methodType: "Purchase to Order" | "Make to Order" | "Pull from Inventory";
    saleQuantity: number;
  }>;
  disableTooltip?: boolean;
};

export const SALES_STATUS_COLOR_MAP: Record<
  Database["public"]["Enums"]["salesOrderStatus"],
  "gray" | "yellow" | "orange" | "blue" | "green" | "red"
> = {
  Draft: "gray",
  Cancelled: "red",
  Closed: "red",
  "To Ship and Invoice": "orange",
  "To Ship": "orange",
  "To Invoice": "blue",
  Confirmed: "blue",
  "Needs Approval": "yellow",
  "In Progress": "yellow",
  Invoiced: "gray",
  Completed: "green"
} as const;

const SalesStatus = ({
  status,
  jobs,
  lines,
  disableTooltip
}: SalesOrderStatusProps) => {
  if (!status) return null;

  // Check if the order has incomplete jobs
  const isManufacturing =
    jobs !== undefined &&
    lines !== undefined &&
    hasIncompleteJobs({ jobs, lines });

  if (isManufacturing && !(status === "Closed" || status === "Cancelled")) {
    return (
      <Status color="yellow" tooltip={status} disableTooltip={disableTooltip}>
        In Progress
      </Status>
    );
  }

  const color = SALES_STATUS_COLOR_MAP[status];
  if (!color) return null;

  return (
    <Status color={color} disableTooltip={disableTooltip}>
      {status}
    </Status>
  );
};

export default SalesStatus;
