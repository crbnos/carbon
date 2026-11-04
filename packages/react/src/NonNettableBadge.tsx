// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { Badge } from "./Badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "./Tooltip";
import { cn } from "./utils/cn";

/**
 * Marks a storage unit whose stock is not usable supply (a quarantine or hold
 * unit): MRP and planning do not count it, and picking does not take from it.
 */
export function NonNettableBadge({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="orange" className={cn("shrink-0", className)}>
          <Trans>Non-nettable</Trans>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <Trans>
          Not usable stock. MRP and planning do not count it, and picking does
          not take from it.
        </Trans>
      </TooltipContent>
    </Tooltip>
  );
}
