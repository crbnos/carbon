// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, TruncatedTooltipText } from "@carbon/react";
import type { ReactNode } from "react";

// First column of the quote line Costing / Pricing grids. Wide enough for the
// label and its badge; anything longer ellipsizes instead of wrapping.
export const costRowLabelCellClass =
  "min-w-[280px] w-[300px] max-w-[300px] border-r border-border";

type CostRowLabelProps = {
  label: ReactNode;
  /** Inline help right after the label. */
  info?: ReactNode;
  /** Badge or control pinned to the right of the cell. */
  badge?: ReactNode;
  className?: string;
};

export function CostRowLabel({
  label,
  info,
  badge,
  className
}: CostRowLabelProps) {
  return (
    <div className={cn("flex w-full min-w-0 items-center gap-2", className)}>
      <TruncatedTooltipText tooltip={label} className="block min-w-0 truncate">
        {label}
      </TruncatedTooltipText>
      {info && <span className="flex shrink-0 items-center">{info}</span>}
      {badge && (
        <span className="ml-auto flex shrink-0 items-center">{badge}</span>
      )}
    </div>
  );
}
