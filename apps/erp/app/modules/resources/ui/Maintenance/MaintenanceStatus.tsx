// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { MAINTENANCE_DISPATCH_STATUS_COLOR_MAP } from "@carbon/utils";
import type { maintenanceDispatchStatus } from "../../resources.models";

type MaintenanceStatusProps = {
  status?: (typeof maintenanceDispatchStatus)[number] | null;
  className?: string;
};

function MaintenanceStatus({ status, className }: MaintenanceStatusProps) {
  if (!status) return null;
  const color = MAINTENANCE_DISPATCH_STATUS_COLOR_MAP[status];
  if (!color) return null;

  return (
    <Status color={color} className={className}>
      {status}
    </Status>
  );
}

export default MaintenanceStatus;
