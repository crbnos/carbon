import { cn } from "@carbon/react";
import { BsExclamationSquareFill } from "react-icons/bs";
import { HighPriorityIcon } from "~/assets/icons/HighPriorityIcon";
import { LowPriorityIcon } from "~/assets/icons/LowPriorityIcon";
import { MediumPriorityIcon } from "~/assets/icons/MediumPriorityIcon";
import type { deadlineTypes } from "../../production.models";

export function getDeadlineIcon(
  deadlineType: (typeof deadlineTypes)[number],
  overdue: boolean
) {
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
  }
}

export function getDeadlineText(deadlineType: (typeof deadlineTypes)[number]) {
  switch (deadlineType) {
    case "ASAP":
      return "ASAP";
    case "Hard Deadline":
      return "Hard deadline";
    case "Soft Deadline":
      return "Soft deadline";
    case "No Deadline":
      return "No deadline";
  }
}
