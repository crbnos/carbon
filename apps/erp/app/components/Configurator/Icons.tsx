import { cn } from "@carbon/react";
import {
  LuAtom,
  LuCalendar,
  LuHash,
  LuList,
  LuToggleLeft,
  LuType,
} from "react-icons/lu";
import type { BatchPropertyDataType } from "./types";

export function ConfiguratorDataTypeIcon({
  type,
  className,
}: {
  type: BatchPropertyDataType;
  className?: string;
}) {
  switch (type) {
    case "numeric":
      return <LuHash className={cn("w-4 h-4 text-blue-600", className)} />;
    case "text":
      return <LuType className={cn("w-4 h-4 text-green-600", className)} />;
    case "boolean":
      return (
        <LuToggleLeft className={cn("w-4 h-4 text-purple-600", className)} />
      );
    case "enum":
    case "list":
      return <LuList className={cn("w-4 h-4 text-orange-600", className)} />;
    case "date":
      return <LuCalendar className={cn("w-4 h-4 text-red-600", className)} />;
    case "material":
      return <LuAtom className={cn("w-4 h-4 text-yellow-600", className)} />;
    default:
      return null;
  }
}
