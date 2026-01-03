import type { Database } from "@carbon/database";
import { Badge, cn } from "@carbon/react";
import {
  LuCalendar,
  LuCircleCheck,
  LuCircleX,
  LuTriangleAlert
} from "react-icons/lu";

type MaintenanceOeeImpactProps = {
  oeeImpact?: Database["public"]["Enums"]["oeeImpact"] | null;
  className?: string;
};

function MaintenanceOeeImpact({
  oeeImpact,
  className
}: MaintenanceOeeImpactProps) {
  switch (oeeImpact) {
    case "Down":
      return (
        <Badge
          variant="red"
          className={cn(className, "inline-flex items-center gap-1")}
        >
          <LuCircleX className="h-3 w-3" />
          Down
        </Badge>
      );
    case "Planned":
      return (
        <Badge
          variant="secondary"
          className={cn(className, "inline-flex items-center gap-1")}
        >
          <LuCalendar className="h-3 w-3" />
          Planned
        </Badge>
      );
    case "Impact":
      return (
        <Badge
          variant="yellow"
          className={cn(className, "inline-flex items-center gap-1")}
        >
          <LuTriangleAlert className="h-3 w-3" />
          Impact
        </Badge>
      );
    case "No Impact":
      return (
        <Badge
          variant="blue"
          className={cn(className, "inline-flex items-center gap-1")}
        >
          <LuCircleCheck className="h-3 w-3" />
          No Impact
        </Badge>
      );
    default:
      return null;
  }
}

export default MaintenanceOeeImpact;
