import {
  HiArrowPath,
  HiBoltSlash,
  HiBugAnt,
  HiCheckCircle,
  HiFire,
  HiNoSymbol,
  HiPauseCircle,
  HiRectangleStack,
} from "react-icons/hi2";

import { Spinner, cn } from "@carbon/react";
import assertNever from "assert-never";
import { LuSnowflake, LuXCircle } from "react-icons/lu";

export type GanttTaskStatus =
  | "PENDING"
  | "EXECUTING"
  | "RETRYING_AFTER_FAILURE"
  | "WAITING_TO_RESUME"
  | "COMPLETED_SUCCESSFULLY"
  | "CANCELED"
  | "COMPLETED_WITH_ERRORS"
  | "INTERRUPTED"
  | "SYSTEM_FAILURE"
  | "PAUSED"
  | "CRASHED";

export const allGanttTaskStatuses = [
  "PENDING",
  "EXECUTING",
  "RETRYING_AFTER_FAILURE",
  "WAITING_TO_RESUME",
  "COMPLETED_SUCCESSFULLY",
  "CANCELED",
  "COMPLETED_WITH_ERRORS",
  "CRASHED",
  "INTERRUPTED",
  "SYSTEM_FAILURE",
] as GanttTaskStatus[];

const taskRunStatusDescriptions: Record<GanttTaskStatus, string> = {
  PENDING: "Task is waiting to be executed",
  EXECUTING: "Task is currently being executed",
  RETRYING_AFTER_FAILURE: "Task is being reattempted after a failure",
  WAITING_TO_RESUME: "Task has been frozen and is waiting to be resumed",
  COMPLETED_SUCCESSFULLY: "Task has been successfully completed",
  CANCELED: "Task has been canceled",
  COMPLETED_WITH_ERRORS: "Task has failed with errors",
  INTERRUPTED: "Task has failed because it was interrupted",
  SYSTEM_FAILURE: "Task has failed due to a system failure",
  PAUSED: "Task has been paused by the user",
  CRASHED: "Task has crashed and won't be retried",
};

export const QUEUED_STATUSES: GanttTaskStatus[] = ["PENDING"];

export const RUNNING_STATUSES: GanttTaskStatus[] = [
  "EXECUTING",
  "RETRYING_AFTER_FAILURE",
  "WAITING_TO_RESUME",
];

export const FINISHED_STATUSES: GanttTaskStatus[] = [
  "COMPLETED_SUCCESSFULLY",
  "CANCELED",
  "COMPLETED_WITH_ERRORS",
  "INTERRUPTED",
  "SYSTEM_FAILURE",
  "CRASHED",
];

export function descriptionForGanttTaskStatus(status: GanttTaskStatus): string {
  return taskRunStatusDescriptions[status];
}

export function GanttTaskStatusCombo({
  status,
  className,
  iconClassName,
}: {
  status: GanttTaskStatus;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span className={cn("flex items-center gap-1", className)}>
      <GanttTaskStatusIcon
        status={status}
        className={cn("h-4 w-4", iconClassName)}
      />
      <GanttTaskStatusLabel status={status} />
    </span>
  );
}

export function GanttTaskStatusLabel({ status }: { status: GanttTaskStatus }) {
  return (
    <span className={runStatusClassNameColor(status)}>
      {runStatusTitle(status)}
    </span>
  );
}

export function GanttTaskStatusIcon({
  status,
  className,
}: {
  status: GanttTaskStatus;
  className: string;
}) {
  switch (status) {
    case "PENDING":
      return (
        <HiRectangleStack
          className={cn(runStatusClassNameColor(status), className)}
        />
      );
    case "EXECUTING":
      return (
        <Spinner
          className={cn(runStatusClassNameColor(status), "w-2 h-2", className)}
        />
      );
    case "WAITING_TO_RESUME":
      return (
        <LuSnowflake
          className={cn(runStatusClassNameColor(status), className)}
        />
      );
    case "RETRYING_AFTER_FAILURE":
      return (
        <HiArrowPath
          className={cn(runStatusClassNameColor(status), className)}
        />
      );
    case "PAUSED":
      return (
        <HiPauseCircle
          className={cn(runStatusClassNameColor(status), className)}
        />
      );
    case "CANCELED":
      return (
        <HiNoSymbol
          className={cn(runStatusClassNameColor(status), className)}
        />
      );
    case "INTERRUPTED":
      return (
        <HiBoltSlash
          className={cn(runStatusClassNameColor(status), className)}
        />
      );
    case "COMPLETED_SUCCESSFULLY":
      return (
        <HiCheckCircle
          className={cn(runStatusClassNameColor(status), className)}
        />
      );
    case "COMPLETED_WITH_ERRORS":
      return (
        <LuXCircle className={cn(runStatusClassNameColor(status), className)} />
      );
    case "SYSTEM_FAILURE":
      return (
        <HiBugAnt className={cn(runStatusClassNameColor(status), className)} />
      );
    case "CRASHED":
      return (
        <HiFire className={cn(runStatusClassNameColor(status), className)} />
      );

    default: {
      assertNever(status);
    }
  }
}

export function runStatusClassNameColor(status: GanttTaskStatus): string {
  switch (status) {
    case "PENDING":
      return "text-gray-500";
    case "EXECUTING":
    case "RETRYING_AFTER_FAILURE":
      return "text-pending";
    case "WAITING_TO_RESUME":
      return "text-blue-300";
    case "PAUSED":
      return "text-orange-300";
    case "CANCELED":
      return "text-gray-500";
    case "INTERRUPTED":
      return "text-red-500";
    case "COMPLETED_SUCCESSFULLY":
      return "text-success";
    case "COMPLETED_WITH_ERRORS":
      return "text-red-500";
    case "SYSTEM_FAILURE":
      return "text-red-500";
    case "CRASHED":
      return "text-red-500";
    default: {
      assertNever(status);
    }
  }
}

export function runStatusTitle(status: GanttTaskStatus): string {
  switch (status) {
    case "PENDING":
      return "Queued";
    case "EXECUTING":
      return "Executing";
    case "WAITING_TO_RESUME":
      return "Frozen";
    case "RETRYING_AFTER_FAILURE":
      return "Reattempting";
    case "PAUSED":
      return "Paused";
    case "CANCELED":
      return "Canceled";
    case "INTERRUPTED":
      return "Interrupted";
    case "COMPLETED_SUCCESSFULLY":
      return "Completed";
    case "COMPLETED_WITH_ERRORS":
      return "Failed";
    case "SYSTEM_FAILURE":
      return "System failure";
    case "CRASHED":
      return "Crashed";
    default: {
      assertNever(status);
    }
  }
}
