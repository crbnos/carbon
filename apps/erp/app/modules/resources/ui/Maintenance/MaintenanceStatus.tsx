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
