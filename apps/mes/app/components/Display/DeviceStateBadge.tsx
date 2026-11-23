// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { Badge } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";

type MachineState = Database["public"]["Enums"]["machineState"];

/** The live state an OEE device reports for the work center's machine. */
export function DeviceStateBadge({
  state,
  className
}: {
  state: MachineState;
  className?: string;
}) {
  const { t } = useLingui();
  const display: Record<
    MachineState,
    { variant: "green" | "outline" | "red"; label: string }
  > = {
    Running: { variant: "green", label: t`Running` },
    Idle: { variant: "outline", label: t`Idle` },
    Down: { variant: "red", label: t`Down` },
    Offline: { variant: "outline", label: t`Offline` }
  };
  const { variant, label } = display[state];
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}
