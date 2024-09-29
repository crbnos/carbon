import { cn } from "@carbon/react";
import { BsExclamationSquareFill } from "react-icons/bs";
import { LuCheckCircle, LuXCircle } from "react-icons/lu";
import { AlmostDoneIcon } from "~/assets/icons/AlmostDoneIcon";
import { HighPriorityIcon } from "~/assets/icons/HighPriorityIcon";
import { InProgressStatusIcon } from "~/assets/icons/InProgressStatusIcon";
import { LowPriorityIcon } from "~/assets/icons/LowPriorityIcon";
import { MediumPriorityIcon } from "~/assets/icons/MediumPriorityIcon";
import { TodoStatusIcon } from "~/assets/icons/TodoStatusIcon";
import type { Operation } from "~/services/jobs";

export function StatusIcon({
  status,
}: {
  status: Operation["operationStatus"];
}) {
  switch (status) {
    case "Ready":
    case "Todo":
      return <TodoStatusIcon className="text-foreground" />;
    case "Waiting":
    case "Canceled":
      return <LuXCircle className="text-muted-foreground" />;
    case "Done":
      return <LuCheckCircle className="text-blue-600" />;
    case "In Progress":
      return <AlmostDoneIcon />;
    case "Paused":
      return <InProgressStatusIcon />;
    default:
      return null;
  }
}

export function DeadlineIcon({
  deadlineType,
  overdue,
}: {
  deadlineType: Operation["jobDeadlineType"];
  overdue: boolean;
}) {
  switch (deadlineType) {
    case "ASAP":
      return <BsExclamationSquareFill className="text-red-500" />;
    case "Hard Deadline":
      return <HighPriorityIcon className={cn(overdue ? "text-red-500" : "")} />;
    case "Soft Deadline":
      return (
        <MediumPriorityIcon className={cn(overdue ? "text-red-500" : "")} />
      );
    case "No Deadline":
      return <LowPriorityIcon />;
    default:
      return null;
  }
}
