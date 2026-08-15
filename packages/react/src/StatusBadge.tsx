import type { CanonicalStatusState } from "@carbon/utils";
import type { HTMLAttributes } from "react";
import {
  LuBan,
  LuCircleAlert,
  LuCircleCheck,
  LuCircleDashed,
  LuCircleHelp,
  LuLoaderCircle,
  LuOctagonAlert
} from "react-icons/lu";

import type { BadgeProps } from "./Badge";
import { Badge } from "./Badge";
import { cn } from "./utils/cn";

export type { CanonicalStatus, CanonicalStatusState } from "@carbon/utils";

const statusConfig: Record<
  CanonicalStatusState,
  {
    label: string;
    variant: BadgeProps["variant"];
    icon: typeof LuCircleCheck;
  }
> = {
  normal: { label: "Normal", variant: "green", icon: LuCircleCheck },
  "in-progress": {
    label: "In progress",
    variant: "blue",
    icon: LuLoaderCircle
  },
  completed: { label: "Completed", variant: "green", icon: LuCircleCheck },
  warning: { label: "Warning", variant: "yellow", icon: LuCircleAlert },
  blocked: { label: "Blocked", variant: "orange", icon: LuOctagonAlert },
  critical: { label: "Critical", variant: "red", icon: LuOctagonAlert },
  cancelled: { label: "Cancelled", variant: "gray", icon: LuBan },
  unknown: { label: "Unknown", variant: "gray", icon: LuCircleHelp }
};

export interface StatusBadgeProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  state?: CanonicalStatusState;
  label?: string;
}

export function StatusBadge({
  state = "unknown",
  label,
  className,
  ...props
}: StatusBadgeProps) {
  const config = statusConfig[state] ?? {
    label: "Unknown",
    variant: "gray" as const,
    icon: LuCircleDashed
  };
  const visibleLabel =
    state === "unknown" && label
      ? `Unknown · ${label}`
      : (label ?? config.label);
  const Icon = config.icon;

  return (
    <Badge
      variant={config.variant}
      className={cn("gap-1", className)}
      role="status"
      aria-label={`Status: ${visibleLabel}`}
      {...props}
    >
      <Icon aria-hidden="true" className="size-3 shrink-0" />
      <span>{visibleLabel}</span>
    </Badge>
  );
}
