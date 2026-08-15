import type { RiskLevel } from "@carbon/utils";
import type { HTMLAttributes } from "react";
import {
  LuCircleCheck,
  LuCircleHelp,
  LuGauge,
  LuShieldAlert,
  LuTriangleAlert
} from "react-icons/lu";

import type { BadgeProps } from "./Badge";
import { Badge } from "./Badge";
import { cn } from "./utils/cn";

export type { RiskLevel } from "@carbon/utils";

const riskConfig: Record<
  RiskLevel,
  {
    label: string;
    variant: BadgeProps["variant"];
    icon: typeof LuGauge;
  }
> = {
  high: { label: "High risk", variant: "red", icon: LuShieldAlert },
  medium: { label: "Medium risk", variant: "orange", icon: LuTriangleAlert },
  low: { label: "Low risk", variant: "yellow", icon: LuGauge },
  none: {
    label: "No current risk",
    variant: "green",
    icon: LuCircleCheck
  },
  unknown: { label: "Unknown risk", variant: "gray", icon: LuCircleHelp }
};

export interface RiskIndicatorProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  level?: RiskLevel;
  label?: string;
}

export function RiskIndicator({
  level = "unknown",
  label,
  className,
  ...props
}: RiskIndicatorProps) {
  const config = riskConfig[level] ?? riskConfig.unknown;
  const visibleLabel =
    level === "unknown" && label
      ? `Unknown risk · ${label}`
      : (label ?? config.label);
  const Icon = config.icon;

  return (
    <Badge
      variant={config.variant}
      className={cn("gap-1", className)}
      role="status"
      aria-label={`Risk: ${visibleLabel}`}
      {...props}
    >
      <Icon aria-hidden="true" className="size-3 shrink-0" />
      <span>{visibleLabel}</span>
    </Badge>
  );
}
