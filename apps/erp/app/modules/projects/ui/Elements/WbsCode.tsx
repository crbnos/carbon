// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuPin, LuTriangleAlert } from "react-icons/lu";
import type { ElementWbsCode } from "../../projects.models";

/**
 * An element's WBS code in muted tabular figures. A pin marks a code stored
 * on the element (a contract WBS code); a warning marks a code another
 * element also has.
 */
export function WbsCode({
  wbs,
  minChars,
  className
}: {
  wbs: ElementWbsCode;
  /** The widest code of the list, so the names line up. */
  minChars?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-sm text-muted-foreground tabular-nums",
        className
      )}
      style={minChars ? { minWidth: `${minChars + 2}ch` } : undefined}
    >
      {wbs.code}
      {wbs.duplicate ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <LuTriangleAlert className="size-3 text-amber-500" />
          </TooltipTrigger>
          <TooltipContent>
            <Trans>Another element has this WBS code</Trans>
          </TooltipContent>
        </Tooltip>
      ) : wbs.pinned ? (
        <LuPin className="size-3" aria-label="Pinned" />
      ) : null}
    </span>
  );
}
