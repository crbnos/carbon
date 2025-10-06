import { cn, HStack } from "@carbon/react";
import type { JobOperationParameter } from "~/services/types";

import { LuActivity } from "react-icons/lu";

export function ParametersListItem({
  parameter,
  operationId,
  className,
}: {
  parameter: JobOperationParameter;
  operationId?: string;
  className: string;
}) {
  const { key, value } = parameter;

  if (!operationId) return null;
  return (
    <div className={cn("border-b p-6 hover:bg-muted/30", className)}>
      <div className="flex flex-1 justify-between items-center w-full">
        <HStack spacing={4} className="w-2/3">
          <HStack spacing={4} className="flex-1">
            <div className="bg-muted border rounded-full flex items-center justify-center p-2">
              <LuActivity />
            </div>
            <p className="text-foreground text-sm font-medium">{key}</p>
          </HStack>
        </HStack>
        <div className="flex items-center justify-end gap-2">
          <p
            className={cn(
              "text-foreground",
              value?.length > 8
                ? "text-sm"
                : "text-2xl font-semibold tracking-tight"
            )}
          >
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}
