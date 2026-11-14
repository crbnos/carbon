// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans, useLingui } from "@lingui/react/macro";
import { Badge } from "./Badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "./Tooltip";
import { cn } from "./utils/cn";

/**
 * Marks a storage unit whose stock is not usable supply (a quarantine or hold
 * unit): MRP and planning do not count it, and picking does not take from it.
 */
export function NonNettableBadge({ className }: { className?: string }) {
  const { t } = useLingui();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="orange"
          role="note"
          aria-label={t`Non-nettable`}
          tabIndex={0}
          className={cn(
            "shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className
          )}
        >
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
