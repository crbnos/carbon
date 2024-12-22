import { cn } from "@carbon/react";
import { LuHash, LuList, LuToggleLeft, LuType } from "react-icons/lu";

export function ConfiguratorDataTypeIcon({
  type,
  className,
}: {
  type: "numeric" | "text" | "boolean" | "list";
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
    case "list":
      return <LuList className={cn("w-4 h-4 text-orange-600", className)} />;
    default:
      return null;
  }
}
