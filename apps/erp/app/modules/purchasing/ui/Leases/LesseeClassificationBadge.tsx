// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback } from "react";

/** A lessee classification's name on screen. */
export function useLesseeClassificationLabel() {
  const { t } = useLingui();
  return useCallback(
    (value: string) => {
      switch (value) {
        case "Finance":
          return t`Finance`;
        case "Short-Term":
          return t`Short-Term`;
        default:
          return t`Operating`;
      }
    },
    [t]
  );
}

/** What a lessee classification means for the books. */
export function useLesseeClassificationDescription() {
  const { t } = useLingui();
  return useCallback(
    (value: string) => {
      switch (value) {
        case "Finance":
          return t`You effectively buy the asset. Interest and amortization of the right-of-use asset are booked separately each month.`;
        case "Short-Term":
          return t`Twelve months or less. Nothing goes on the balance sheet; each invoice is expensed.`;
        default:
          return t`The right-of-use asset and the lease liability are on the balance sheet, and one straight-line lease cost is booked each month.`;
      }
    },
    [t]
  );
}

/** The classification badge, with a tooltip saying what it means. */
export function LesseeClassificationBadge({ value }: { value: string }) {
  const label = useLesseeClassificationLabel();
  const description = useLesseeClassificationDescription();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="w-fit">
          <Badge variant={value === "Finance" ? "orange" : "secondary"}>
            {label(value)}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{description(value)}</p>
      </TooltipContent>
    </Tooltip>
  );
}
