import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";
import type { z } from "zod";
import { JOB_STATUS_COLOR_MAP } from "~/modules/production/ui/Jobs/JobStatus";
import { SALES_STATUS_COLOR_MAP } from "../SalesOrder/SalesStatus";
import type { jobOperationValidator } from "./shared";

type StatusColor =
  | "gray"
  | "yellow"
  | "orange"
  | "blue"
  | "green"
  | "red"
  | "purple";

type LineStatusInput = {
  quantityOrdered: number;
  quantityShipped: number;
  jobStatus: Database["public"]["Enums"]["jobStatus"];
  jobOperations: z.infer<typeof jobOperationValidator>;
  salesOrderStatus: Database["public"]["Enums"]["salesOrderStatus"];
};

function getLineStatus({
  quantityOrdered,
  quantityShipped,
  jobStatus,
  jobOperations,
  salesOrderStatus
}: LineStatusInput): { color: StatusColor; label: string } {
  if (
    ["Draft", "Needs Approval", "Completed", "Cancelled", "Invoiced"].includes(
      salesOrderStatus
    )
  ) {
    return {
      color: SALES_STATUS_COLOR_MAP[salesOrderStatus] ?? "gray",
      label: salesOrderStatus
    };
  }

  if (quantityOrdered > 0 && quantityOrdered === quantityShipped) {
    return { color: "blue", label: "Shipped" };
  }

  if (quantityShipped > 0) {
    return { color: "orange", label: "Partially Shipped" };
  }

  if (!jobStatus || ["Draft", "Ready", "Planned"].includes(jobStatus)) {
    return { color: "yellow", label: "Planned" };
  }

  if (
    ["In Progress", "Paused"].includes(jobStatus) ||
    jobOperations?.some((op) => ["In Progress", "Done"].includes(op.status))
  ) {
    return { color: "orange", label: "In Progress" };
  }

  return {
    color: JOB_STATUS_COLOR_MAP[jobStatus] ?? "gray",
    label: jobStatus === "Ready" ? "Released" : jobStatus
  };
}

export function PortalLineStatus(props: LineStatusInput) {
  const { color, label } = getLineStatus(props);
  return (
    <Status color={color} disableTooltip>
      {label}
    </Status>
  );
}
