// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, Status } from "@carbon/react";
import { ASSEMBLY_STEP_STATUS_COLOR_MAP } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { LuCircleCheck, LuCircleDashed, LuClock } from "react-icons/lu";
import { assemblyStepStatuses } from "../../production.models";

export type AssemblyStepStatusValue = (typeof assemblyStepStatuses)[number];

export function normalizeStepStatus(
  status: string | null | undefined
): AssemblyStepStatusValue {
  return assemblyStepStatuses.find((value) => value === status) ?? "Todo";
}

export function useStepStatusLabel() {
  const { t } = useLingui();
  return (status: AssemblyStepStatusValue) => {
    switch (status) {
      case "Review":
        return t`Review`;
      case "Done":
        return t`Done`;
      default:
        return t`Todo`;
    }
  };
}

export function AssemblyStepStatus({
  status
}: {
  status: AssemblyStepStatusValue;
}) {
  const label = useStepStatusLabel();
  return (
    <Status color={ASSEMBLY_STEP_STATUS_COLOR_MAP[status]}>
      {label(status)}
    </Status>
  );
}

// Same glyph per color as <Status>, tinted, for dense rows where a pill won't fit.
const statusIcons = {
  Todo: { Icon: LuCircleDashed, className: "text-muted-foreground" },
  Review: { Icon: LuClock, className: "text-yellow-500" },
  Done: { Icon: LuCircleCheck, className: "text-emerald-500" }
} as const;

export function AssemblyStepStatusIcon({
  status,
  className
}: {
  status: AssemblyStepStatusValue;
  className?: string;
}) {
  const { Icon, className: hue } = statusIcons[status];
  return <Icon aria-hidden className={cn("size-4 shrink-0", hue, className)} />;
}
