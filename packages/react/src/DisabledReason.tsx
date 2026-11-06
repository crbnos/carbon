// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./Tooltip";
import { cn } from "./utils/cn";
import { reactNodeToString } from "./utils/react";

/** First reason whose condition holds, or undefined when nothing blocks. */
function getDisabledReason(
  checks: ReadonlyArray<readonly [blocked: boolean, reason: string]>
): string | undefined {
  return checks.find(([blocked]) => blocked)?.[1];
}

type DisabledReasonProps = {
  reason?: ReactNode;
  className?: string;
  children: ReactNode;
};

// A disabled <button> fires no pointer events, so the focusable span carries
// the tooltip and gives keyboard users a tab stop to read it. It is a group
// named by the reason, so the reason is read with the control it blocks.
function DisabledReason({ reason, className, children }: DisabledReasonProps) {
  if (!reason) return <>{children}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="group"
          aria-label={
            typeof reason === "string"
              ? reason
              : reactNodeToString(reason) || undefined
          }
          className={cn("inline-flex", className)}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

export { DisabledReason, getDisabledReason };
