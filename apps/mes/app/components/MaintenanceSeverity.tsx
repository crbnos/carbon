import { Badge, cn } from "@carbon/react";
import {
  LuSettings,
  LuSquareUser,
  LuTriangleAlert,
  LuWrench
} from "react-icons/lu";
import type { maintenanceSeverity } from "~/services/models";

type MaintenanceSeverityProps = {
  severity?: (typeof maintenanceSeverity)[number] | null;
  className?: string;
};

function MaintenanceSeverity({
  severity,
  className
}: MaintenanceSeverityProps) {
  switch (severity) {
    case "Preventive":
      return (
        <Badge
          variant="outline"
          className={cn(className, "inline-flex items-center gap-1")}
        >
          <LuSettings />
          {severity}
        </Badge>
      );
    case "Operator Performed":
      return (
        <Badge
          variant="blue"
          className={cn(className, "inline-flex items-center gap-1")}
        >
          <LuSquareUser />
          {severity}
        </Badge>
      );
    case "Support Required":
      return (
        <Badge
          variant="yellow"
          className={cn(className, "inline-flex items-center gap-1")}
        >
          <LuWrench />
          {severity}
        </Badge>
      );
    case "OEM Required":
      return (
        <Badge
          variant="red"
          className={cn(className, "inline-flex items-center gap-1")}
        >
          <LuTriangleAlert />
          {severity}
        </Badge>
      );
    default:
      return null;
  }
}

export default MaintenanceSeverity;
