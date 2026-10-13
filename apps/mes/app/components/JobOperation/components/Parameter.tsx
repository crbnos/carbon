// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, HStack } from "@carbon/react";
import { LuActivity } from "react-icons/lu";
import type { JobOperationParameter } from "~/services/types";

export function ParametersListItem({
  parameter,
  operationId,
  className
}: {
  parameter: JobOperationParameter;
  operationId?: string;
  className: string;
}) {
  const { key, value } = parameter;

  if (!operationId) return null;
  return (
    <div
      className={cn(
        "border-b p-6 hover:bg-muted/30 max-md:px-4 max-md:py-3",
        className
      )}
    >
      {/* Phones: the key takes its own width, and a value that does not fit
          beside it drops below as a whole, so an ID stays on 1 line. */}
      <div className="flex flex-1 justify-between items-center w-full max-md:flex-wrap max-md:gap-x-4 max-md:gap-y-1">
        <HStack spacing={4} className="w-2/3 max-md:w-auto max-md:min-w-0">
          <HStack spacing={4} className="flex-1">
            <div className="bg-muted border rounded-full flex items-center justify-center p-2">
              <LuActivity />
            </div>
            <p className="text-foreground text-sm font-medium">{key}</p>
          </HStack>
        </HStack>
        <div className="flex items-center justify-end gap-2 max-md:ml-auto">
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
