import { Badge, cn } from "@carbon/react";
import {
  LuCalendarClock,
  LuRefreshCcwDot,
  LuShieldX,
  LuTriangleAlert
} from "react-icons/lu";
import type { maintenanceSource } from "../../resources.models";

type MaintenanceSourceProps = {
  source?: (typeof maintenanceSource)[number] | null;
  className?: string;
};

function MaintenanceSource({ source, className }: MaintenanceSourceProps) {
  switch (source) {
    case "Scheduled":
      return (
        <Badge
          variant="outline"
          className={cn(className, "inline-flex items-center gap-1")}
        >
          <LuCalendarClock />
          {source}
        </Badge>
      );
    case "Reactive":
      return (
        <Badge
          variant="orange"
          className={cn(className, "inline-flex items-center gap-1")}
        >
          <LuRefreshCcwDot />
          {source}
        </Badge>
      );
    case "Non-Conformance":
      return (
        <Badge
          variant="gray"
          className={cn(className, "inline-flex items-center gap-1")}
        >
          <LuShieldX />
          {source}
        </Badge>
      );

    default:
      return null;
  }
}

export default MaintenanceSource;
