import { BsExclamationSquareFill } from "react-icons/bs";
import { HighPriorityIcon } from "~/assets/icons/HighPriorityIcon";
import { LowPriorityIcon } from "~/assets/icons/LowPriorityIcon";
import { MediumPriorityIcon } from "~/assets/icons/MediumPriorityIcon";
import type { changeOrderPriority } from "../../items.models";

type ChangeOrderPriorityProps = {
  priority?: (typeof changeOrderPriority)[number] | null;
  className?: string;
};

function ChangeOrderPriority({
  priority,
  className
}: ChangeOrderPriorityProps) {
  switch (priority) {
    case "Low":
      return (
        <div className={`flex gap-1 items-center ${className ?? ""}`}>
          <LowPriorityIcon />
          <span>{priority}</span>
        </div>
      );
    case "Medium":
      return (
        <div className={`flex gap-1 items-center ${className ?? ""}`}>
          <MediumPriorityIcon />
          <span>{priority}</span>
        </div>
      );
    case "High":
      return (
        <div className={`flex gap-1 items-center ${className ?? ""}`}>
          <HighPriorityIcon />
          <span>{priority}</span>
        </div>
      );
    case "Critical":
      return (
        <div className={`flex gap-1 items-center ${className ?? ""}`}>
          <BsExclamationSquareFill className="text-red-500" />
          <span>{priority}</span>
        </div>
      );
    default:
      return null;
  }
}

export default ChangeOrderPriority;
