// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComponentProps, ReactNode } from "react";
import {
  LuCircleAlert,
  LuCircleCheck,
  LuCircleDashed,
  LuCircleSlash,
  LuClock,
  LuLoaderCircle,
  LuStar
} from "react-icons/lu";
import { Badge } from "./Badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "./Tooltip";
import { cn } from "./utils/cn";

type StatusProps = ComponentProps<"div"> & {
  color?: "green" | "orange" | "red" | "yellow" | "blue" | "gray" | "purple";
  tooltip?: ReactNode;
  disableTooltip?: boolean;
  /**
   * Show the status as its icon alone, in the status colour, with the label
   * in the tooltip. For places that have no width for the pill — a dense table
   * row, a narrow drawer — where the status is context, not the headline. The
   * tooltip is the only place the label is readable, so it is always on.
   */
  iconOnly?: boolean;
};

const getStatusIcon = (color: string) => {
  switch (color) {
    case "green":
      return <LuCircleCheck />;
    case "orange":
      return <LuCircleAlert />;
    case "red":
      return <LuCircleSlash />;
    case "yellow":
      return <LuClock />;
    case "blue":
      return <LuLoaderCircle />;
    case "purple":
      return <LuStar />;
    case "gray":
    default:
      return <LuCircleDashed />;
  }
};

const Status = ({
  color = "gray",
  children,
  tooltip,
  disableTooltip,
  iconOnly = false,
  className,
  ...props
}: StatusProps) => {
  const badge = (
    <Badge
      variant={color}
      className={cn(
        "inline-flex items-center gap-1",
        iconOnly && "shrink-0 px-1.5",
        className
      )}
      aria-label={
        iconOnly && typeof children === "string" ? children : undefined
      }
      {...props}
    >
      {getStatusIcon(color)}
      {!iconOnly && children}
    </Badge>
  );

  if (disableTooltip && !iconOnly) return badge;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent>
        <span>{tooltip ?? children}</span>
      </TooltipContent>
    </Tooltip>
  );
};

export { Status };
