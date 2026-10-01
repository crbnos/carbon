// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge, cn } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import {
  LuSettings,
  LuSquareUser,
  LuTriangleAlert,
  LuWrench
} from "react-icons/lu";
import type { maintenanceSeverity } from "~/services/models";

type MaintenanceSeverityProps = {
  severity?: (typeof maintenanceSeverity)[number] | null;
  className?: string;
};

function MaintenanceSeverity({
  severity,
  className
}: MaintenanceSeverityProps) {
  switch (severity) {
    case "Preventive":
      return (
        <Badge
          variant="outline"
          className={cn(className, "inline-flex items-center gap-1")}
        >
          <LuSettings />
          <Trans>Preventive</Trans>
        </Badge>
      );
    case "Operator Performed":
      return (
        <Badge
          variant="blue"
          className={cn(className, "inline-flex items-center gap-1")}
        >
          <LuSquareUser />
          <Trans>Operator Performed</Trans>
        </Badge>
      );
    case "Support Required":
      return (
        <Badge
          variant="yellow"
          className={cn(className, "inline-flex items-center gap-1")}
        >
          <LuWrench />
          <Trans>Support Required</Trans>
        </Badge>
      );
    case "OEM Required":
      return (
        <Badge
          variant="red"
          className={cn(className, "inline-flex items-center gap-1")}
        >
          <LuTriangleAlert />
          <Trans>OEM Required</Trans>
        </Badge>
      );
    default:
      return null;
  }
}

export default MaintenanceSeverity;
